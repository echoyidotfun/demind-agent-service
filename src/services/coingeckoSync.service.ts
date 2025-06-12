// src/lib/coingecko/service.ts

import {
  PrismaClient,
  CgCoinDetails,
  Prisma,
  CgCoinsIndex,
} from "@prisma/client";
import { redis } from "../lib/kv/redisClient";
import {
  CoingeckoClient,
  ApiCoinDetail,
  TrendingCoinItem,
  CoinListItem,
} from "../lib/apiClients/coingeckoClient";
import { prisma as globalPrismaClient } from "../lib/db/prismaClient"; // Import the global prisma instance

interface BasicCoinInfo {
  cgId: string;
  name: string;
  symbol: string;
}

export class CoinGeckoService {
  private prisma: PrismaClient;
  public coingeckoClient: CoingeckoClient;
  private readonly BATCH_SIZE = 100; // Batch size for DB operations

  constructor(
    prismaClient?: PrismaClient,
    coingeckoClientInstance?: CoingeckoClient
  ) {
    this.prisma = prismaClient || globalPrismaClient; // Use globalPrismaClient as default
    this.coingeckoClient = coingeckoClientInstance || new CoingeckoClient();
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  // 同步 CoinGecko 代币列表到数据库和 Redis
  async syncCoinsListAndPlatforms(): Promise<void> {
    console.log(
      "CoinGeckoService: Starting sync of coins list and platforms..."
    );
    const coinsList = await this.coingeckoClient.getCoinsList(true);
    console.log(
      `CoinGeckoService: Retrieved ${coinsList.length} coins from API.`
    );

    if (coinsList.length === 0) {
      console.log(
        "CoinGeckoService: No coins retrieved from API. Skipping sync."
      );
      return;
    }

    let processedCount = 0;
    let platformEntriesCount = 0;

    const coinsListChunks = this.chunkArray(coinsList, this.BATCH_SIZE);

    for (let i = 0; i < coinsListChunks.length; i++) {
      const batch = coinsListChunks[i];

      const coinIndexUpsertPromises: Prisma.PrismaPromise<any>[] = [];
      const platformUpsertPromises: Prisma.PrismaPromise<any>[] = [];
      const redisPromises: Promise<any>[] = [];

      for (const coin of batch) {
        if (!coin.id || !coin.symbol || !coin.name) {
          console.warn(
            `CoinGeckoService: Skipping coin with missing id, symbol, or name: ${JSON.stringify(
              coin
            )}`
          );
          continue;
        }

        coinIndexUpsertPromises.push(
          this.prisma.cgCoinsIndex.upsert({
            where: { id: coin.id },
            update: {
              symbol: coin.symbol,
              name: coin.name,
              updatedAt: new Date(),
            },
            create: { id: coin.id, symbol: coin.symbol, name: coin.name },
          })
        );

        redisPromises.push(
          redis.set(
            `cg:info:${coin.id}`,
            JSON.stringify({ symbol: coin.symbol, name: coin.name }),
            { ex: 60 * 60 * 24 * 7 }
          )
        );

        if (coin.platforms) {
          for (const [platformId, contractAddress] of Object.entries(
            coin.platforms
          )) {
            if (platformId && contractAddress) {
              const contractAddressLower = contractAddress.toLowerCase();
              platformUpsertPromises.push(
                this.prisma.cgCoinPlatform.upsert({
                  where: {
                    cgId_platformId_contractAddress: {
                      cgId: coin.id,
                      platformId,
                      contractAddress: contractAddressLower,
                    },
                  },
                  update: {},
                  create: {
                    cgId: coin.id,
                    platformId,
                    contractAddress: contractAddressLower,
                  },
                })
              );
              redisPromises.push(
                redis.set(`cg:${platformId}:${contractAddressLower}`, coin.id, {
                  ex: 60 * 60 * 24 * 7,
                })
              );
              platformEntriesCount++; // Count platforms prepared for this batch
            }
          }
        }
        processedCount++; // Count coins prepared for this batch
      }

      try {
        // Execute DB operations in a transaction
        await this.prisma.$transaction([
          ...coinIndexUpsertPromises,
          ...platformUpsertPromises,
        ]);

        // Execute Redis operations after successful DB transaction
        await Promise.all(redisPromises);

        console.log(
          `CoinGeckoService: Processed batch ${i + 1}/${
            coinsListChunks.length
          } of coin list. Total coins: ${processedCount}, Total platforms: ${platformEntriesCount}`
        );
      } catch (error) {
        console.error(
          "CoinGeckoService: Error processing batch in syncCoinsListAndPlatforms:",
          error
        );
      }
    }
    console.log(
      `CoinGeckoService: Sync of coins list and platforms completed. Processed ${processedCount} coins and ${platformEntriesCount} platform entries.`
    );
  }

  // Modified to return BasicCoinInfo
  async findCgInfoByPlatformContract(
    platformId: string,
    contractAddress: string
  ): Promise<BasicCoinInfo | null> {
    if (!platformId || !contractAddress) {
      console.warn(
        "CoinGeckoService: findCgInfoByPlatformContract called with invalid platformId or contractAddress."
      );
      return null;
    }

    const contractAddressLower = contractAddress.toLowerCase();
    const redisPlatformKey = `cg:${platformId}:${contractAddressLower}`;
    let cgId: string | null = null;

    try {
      cgId = await redis.get<string>(redisPlatformKey, false);
    } catch (error) {
      console.error(
        `CoinGeckoService: Redis error fetching cgId from ${redisPlatformKey}:`,
        error
      );
    }

    if (!cgId) {
      try {
        const platformRecord = await this.prisma.cgCoinPlatform.findFirst({
          where: { platformId, contractAddress: contractAddressLower },
          select: { cgId: true },
        });

        if (platformRecord?.cgId) {
          cgId = platformRecord.cgId;
          try {
            await redis.set(redisPlatformKey, cgId, { ex: 60 * 60 * 24 * 7 });
          } catch (error) {
            console.error(
              `CoinGeckoService: Redis error setting cgId to ${redisPlatformKey}:`,
              error
            );
          }
        }
      } catch (error) {
        console.error(
          `CoinGeckoService: DB error fetching platform record for ${platformId}/${contractAddressLower}:`,
          error
        );
      }
    }

    if (!cgId) {
      return null;
    }

    const redisInfoKey = `cg:info:${cgId}`;

    try {
      const basicInfo = await redis.get<{ symbol: string; name: string }>(
        redisInfoKey,
        true
      );

      if (basicInfo && basicInfo.name && basicInfo.symbol) {
        return { cgId, name: basicInfo.name, symbol: basicInfo.symbol };
      }
    } catch (error) {
      console.error(
        `CoinGeckoService: Redis error fetching info from ${redisInfoKey}:`,
        error
      );
    }

    try {
      const coinIndexRecord = await this.prisma.cgCoinsIndex.findUnique({
        where: { id: cgId },
        select: { name: true, symbol: true },
      });

      if (coinIndexRecord) {
        const { name, symbol } = coinIndexRecord;
        try {
          await redis.set(redisInfoKey, JSON.stringify({ name, symbol }), {
            ex: 60 * 60 * 24 * 7,
          });
        } catch (error) {
          console.error(
            `CoinGeckoService: Redis error setting to ${redisInfoKey}:`,
            error
          );
        }
        return { cgId, name, symbol };
      }
    } catch (error) {
      console.error(
        `CoinGeckoService: DB error fetching from CgCoinsIndex for ${cgId}:`,
        error
      );
    }

    return { cgId, name: "Unknown", symbol: "Unknown" };
  }

  /**
   * 从缓存中获取代币详情
   */
  private async getCoinDetailsFromCache(
    cgId: string
  ): Promise<CgCoinDetails | null> {
    const redisKey = `cg:details:${cgId}`;
    try {
      const cachedDetailsString = await redis.get<string>(redisKey, false);
      if (cachedDetailsString) {
        const cachedDetails = JSON.parse(cachedDetailsString) as CgCoinDetails;
        // 确保日期字段正确解析
        if (cachedDetails.dataFetchedAt)
          cachedDetails.dataFetchedAt = new Date(cachedDetails.dataFetchedAt);
        if (cachedDetails.athDateUsd)
          cachedDetails.athDateUsd = new Date(cachedDetails.athDateUsd);
        if (cachedDetails.atlDateUsd)
          cachedDetails.atlDateUsd = new Date(cachedDetails.atlDateUsd);
        if (cachedDetails.cgLastUpdated)
          cachedDetails.cgLastUpdated = new Date(cachedDetails.cgLastUpdated);

        return cachedDetails;
      }
    } catch (error) {
      console.error(`Redis error fetching details for ${cgId}:`, error);
    }
    return null;
  }

  /**
   * 设置代币详情缓存
   */
  private async setCoinDetailsCache(
    cgId: string,
    details: CgCoinDetails
  ): Promise<void> {
    const redisKey = `cg:details:${cgId}`;
    const cacheDurationSeconds = 12 * 60 * 60; // 12小时缓存
    try {
      await redis.set(redisKey, JSON.stringify(details), {
        ex: cacheDurationSeconds,
      });
    } catch (error) {
      console.error(`Failed to cache details to Redis for ${cgId}:`, error);
    }
  }

  /**
   * 获取币种详情并存储到数据库
   */
  async getCoinDetailsAndStore(cgId: string): Promise<CgCoinDetails | null> {
    console.log(`Getting coin details for: ${cgId}`);

    // 1. 先检查数据库中是否已存在该币种基本信息
    const existingCoin = await this.prisma.cgCoinsIndex.findUnique({
      where: { id: cgId },
    });

    // 如果币种基本信息不存在，需要先创建基本记录
    if (!existingCoin) {
      try {
        // 尝试通过API获取币种基本信息
        const coinsList = await this.coingeckoClient.getCoinsList(true);
        const coinInfo = coinsList?.find((coin) => coin.id === cgId);

        if (coinInfo) {
          // 如果API中找到了该币种，先创建基本信息记录
          await this.prisma.cgCoinsIndex.create({
            data: {
              id: cgId,
              name: coinInfo.name,
              symbol: coinInfo.symbol,
            },
          });
          console.log(`Created basic coin record for: ${cgId}`);
        } else {
          console.error(`Cannot find basic information for coin: ${cgId}`);
          return null;
        }
      } catch (error) {
        console.error(`Error creating basic record for coin: ${cgId}`, error);
        return null;
      }
    }

    try {
      // 2. 检查缓存
      const cachedDetails = await this.getCoinDetailsFromCache(cgId);
      if (cachedDetails) {
        console.log(`Cache hit for coin details: ${cgId}`);
        return cachedDetails;
      }

      // 3. 查询数据库
      const dbDetails = await this.prisma.cgCoinDetails.findUnique({
        where: { cgId },
      });

      // 检查是否需要更新（超过12小时）
      const now = new Date();
      const updateThreshold = new Date(now.getTime() - 12 * 60 * 60 * 1000); // 12小时

      if (dbDetails && dbDetails.dataFetchedAt > updateThreshold) {
        console.log(`Recent DB record found for ${cgId}, using it`);
        await this.setCoinDetailsCache(cgId, dbDetails);
        return dbDetails;
      }

      // 4. 从API获取新数据
      console.log(`Fetching new data from API for ${cgId}`);
      const apiDetails = await this.coingeckoClient.getCoinDetailsFromApi(cgId);
      if (!apiDetails) {
        console.log(
          `No API details available for ${cgId}, using DB record if available`
        );
        if (dbDetails) {
          await this.setCoinDetailsCache(cgId, dbDetails);
        }
        return dbDetails;
      }

      // 4. Store new data in DB and cache in Redis
      try {
        const processedData = this.mapApiDetailToDbSchema(apiDetails);
        const newDbDetails = await this.prisma.cgCoinDetails.upsert({
          where: { cgId },
          create: {
            ...processedData,
            dataFetchedAt: now,
            coin: {
              connect: { id: cgId },
            },
          },
          update: {
            ...processedData,
            dataFetchedAt: now,
          },
        });

        console.log(`Updated DB and cache for coin ${cgId}`);
        await this.setCoinDetailsCache(cgId, newDbDetails);
        return newDbDetails;
      } catch (error: any) {
        console.error(
          `CoinGeckoService: Error upserting API details for coin ${cgId}:`,
          error
        );

        // 如果是外键约束错误，并且我们有API数据，尝试返回处理后的数据而不是null
        if (error.code === "P2003" && apiDetails) {
          console.log(
            `Returning processed API data for ${cgId} without DB storage due to foreign key error`
          );
          const processedData = this.mapApiDetailToDbSchema(apiDetails);
          // 添加必要字段以匹配CgCoinDetails类型
          const fakeDbDetails = {
            ...processedData,
            cgId,
            dataFetchedAt: now,
          } as CgCoinDetails;

          await this.setCoinDetailsCache(cgId, fakeDbDetails);
          return fakeDbDetails;
        }

        // 如果数据库中有记录，返回数据库记录
        if (dbDetails) {
          console.log(
            `Returning existing DB record for ${cgId} after upsert error`
          );
          await this.setCoinDetailsCache(cgId, dbDetails);
          return dbDetails;
        }

        return null;
      }
    } catch (error) {
      console.error(`Error in getCoinDetailsAndStore for ${cgId}:`, error);
      return null;
    }
  }

  // Defines the type for the object returned by mapApiDetailToDbSchema, ensuring compatibility with Prisma's input types.
  private mapApiDetailToDbSchema(
    apiDetail: ApiCoinDetail
  ): Omit<Prisma.CgCoinDetailsUncheckedCreateInput, "cgId" | "dataFetchedAt"> {
    const getDateFromString = (dateStr?: string | null): Date | null =>
      dateStr ? new Date(dateStr) : null;

    const handleJsonInput = (data: any): Prisma.InputJsonValue => {
      if (data === null || data === undefined)
        return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
      if (
        typeof data === "object" ||
        typeof data === "string" ||
        typeof data === "number" ||
        typeof data === "boolean" ||
        Array.isArray(data)
      ) {
        return data as Prisma.InputJsonValue;
      }
      console.warn(
        "CoinGeckoService: Unexpected data type for JSON field, defaulting to JsonNull:",
        data
      );
      return Prisma.JsonNull as unknown as Prisma.InputJsonValue; // Default to JsonNull if type is not directly usable
    };

    const handleDecimalInput = (value?: number | null): string | null => {
      if (value === null || value === undefined) return null;
      return String(value); // Prisma's Decimal can be created from a string
    };

    return {
      name: apiDetail.name || "",
      symbol: apiDetail.symbol || "",
      assetPlatformId: apiDetail.asset_platform_id || null,
      descriptionEn: apiDetail.description?.en || null,
      imageThumbUrl: apiDetail.image?.thumb || null,
      imageSmallUrl: apiDetail.image?.small || null,
      imageLargeUrl: apiDetail.image?.large || null,
      categories: handleJsonInput(apiDetail.categories),
      linksHomepage: apiDetail.links?.homepage?.[0] || null,
      linksWhitepaperUrl: apiDetail.links?.whitepaper || null,
      linksTwitterScreenName: apiDetail.links?.twitter_screen_name || null,
      linksTelegramChannelId:
        apiDetail.links?.telegram_channel_identifier || null,
      linksGithubRepos: apiDetail.links?.repos_url?.github?.[0] || null,
      linksSubredditUrl: apiDetail.links?.subreddit_url || null,
      sentimentVotesUpPercentage:
        apiDetail.sentiment_votes_up_percentage || 0.0,
      watchlistPortfolioUsers: apiDetail.watchlist_portfolio_users || 0,
      marketCapRank: apiDetail.market_cap_rank || null,
      currentPriceUsd: handleDecimalInput(
        apiDetail.market_data?.current_price?.usd
      ),
      marketCapUsd: handleDecimalInput(apiDetail.market_data?.market_cap?.usd),
      fullyDilutedValuationUsd: handleDecimalInput(
        apiDetail.market_data?.fully_diluted_valuation?.usd
      ),
      totalVolumeUsd: handleDecimalInput(
        apiDetail.market_data?.total_volume?.usd
      ),
      athUsd: handleDecimalInput(apiDetail.market_data?.ath?.usd),
      athDateUsd: getDateFromString(apiDetail.market_data?.ath_date?.usd),
      atlUsd: handleDecimalInput(apiDetail.market_data?.atl?.usd),
      atlDateUsd: getDateFromString(apiDetail.market_data?.atl_date?.usd),
      circulatingSupply: handleDecimalInput(
        apiDetail.market_data?.circulating_supply
      ),
      totalSupply: handleDecimalInput(apiDetail.market_data?.total_supply),
      maxSupply: handleDecimalInput(apiDetail.market_data?.max_supply),
      priceChangePercentage24hUsd: handleDecimalInput(
        apiDetail.market_data?.price_change_percentage_24h
      ),
      priceChangePercentage7dUsd: handleDecimalInput(
        apiDetail.market_data?.price_change_percentage_7d
      ),
      priceChangePercentage14dUsd: handleDecimalInput(
        apiDetail.market_data?.price_change_percentage_14d
      ),
      priceChangePercentage30dUsd: handleDecimalInput(
        apiDetail.market_data?.price_change_percentage_30d
      ),
      priceChangePercentage60dUsd: handleDecimalInput(
        apiDetail.market_data?.price_change_percentage_60d
      ),
      priceChangePercentage200dUsd: handleDecimalInput(
        apiDetail.market_data?.price_change_percentage_200d
      ),
      priceChangePercentage1yUsd: handleDecimalInput(
        apiDetail.market_data?.price_change_percentage_1y
      ),
      cgLastUpdated: getDateFromString(apiDetail.last_updated),
    };
  }

  async syncTrendingCoinsCacheAndDetails(): Promise<TrendingCoinItem[]> {
    console.log(
      "CoinGeckoService: Starting to sync trending coins cache and details..."
    );
    const trendingCoins = await this.coingeckoClient.getTrendingCoins();

    if (!trendingCoins || trendingCoins.length === 0) {
      console.log(
        "CoinGeckoService: No trending coins retrieved from API. Skipping sync."
      );
      return [];
    }

    const redisKey = "cg:trending:coins";
    const cacheDurationSeconds = 12 * 60 * 60; // 12 hours

    try {
      await redis.set(redisKey, JSON.stringify(trendingCoins), {
        ex: cacheDurationSeconds,
      });
      console.log(
        `CoinGeckoService: Cached ${
          trendingCoins.length
        } trending coins in Redis for ${cacheDurationSeconds / 3600} hour(s).`
      );
    } catch (error) {
      console.error(
        `CoinGeckoService: Failed to cache trending coins in Redis:`,
        error
      );
    }

    console.log(
      "CoinGeckoService: Fetching and storing details for trending coins..."
    );
    let detailsSyncedCount = 0;
    for (const trendItem of trendingCoins) {
      if (trendItem && trendItem.id) {
        try {
          const details = await this.getCoinDetailsAndStore(trendItem.id);
          if (details) {
            detailsSyncedCount++;
          }
        } catch (error) {
          console.error(
            `CoinGeckoService: Error syncing details for trending coin ${trendItem.id}:`,
            error
          );
        }
      }
    }
    console.log(
      `CoinGeckoService: Finished syncing details for trending coins. Synced/updated details for ${detailsSyncedCount} coins.`
    );
    return trendingCoins;
  }

  // New method to get trending coins from cache only
  async getTrendingCoinsFromCache(): Promise<TrendingCoinItem[] | null> {
    const redisKey = "cg:trending:coins";
    try {
      const cachedData = await redis.get<TrendingCoinItem[]>(redisKey, true); // true to parse JSON
      if (cachedData) {
        console.log(
          `CoinGeckoService: Retrieved ${cachedData.length} trending coins from Redis cache.`
        );
        return cachedData;
      }
      console.log("CoinGeckoService: Trending coins cache miss or empty.");
      return null;
    } catch (error) {
      console.error(
        "CoinGeckoService: Error fetching trending coins from Redis cache:",
        error
      );
      return null;
    }
  }

  /**
   * 获取指定CoinGecko ID的代币在各区块链上的合约地址
   * @param cgId - CoinGecko代币ID
   * @returns 返回包含区块链ID和合约地址（小写）的对象数组，如果未找到则返回null
   */
  async getCoinPlatformsByCgId(
    cgId: string
  ): Promise<{ blockchainId: string; contractAddress: string }[] | null> {
    if (!cgId) {
      console.warn(
        "CoinGeckoService: getCoinPlatformsByCgId called with empty cgId."
      );
      return null;
    }
    try {
      const platforms = await this.prisma.cgCoinPlatform.findMany({
        where: { cgId },
        select: { platformId: true, contractAddress: true },
      });

      if (!platforms || platforms.length === 0) {
        return null;
      }

      // 转换platformId为blockchainId，并确保contractAddress为小写
      return platforms.map((platform) => ({
        blockchainId: platform.platformId,
        contractAddress: platform.contractAddress.toLowerCase(),
      }));
    } catch (error) {
      console.error(
        `CoinGeckoService: Error fetching platforms for cgId ${cgId}:`,
        error
      );
      return null;
    }
  }
}
