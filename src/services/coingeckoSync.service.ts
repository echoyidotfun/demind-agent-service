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
    this.prisma = prismaClient || new PrismaClient();
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

    for (const batch of this.chunkArray(coinsList, this.BATCH_SIZE)) {
      try {
        await this.prisma.$transaction(async (tx) => {
          for (const coin of batch) {
            if (!coin.id || !coin.symbol || !coin.name) {
              console.warn(
                `CoinGeckoService: Skipping coin with missing id, symbol, or name: ${JSON.stringify(
                  coin
                )}`
              );
              continue;
            }

            await tx.cgCoinsIndex.upsert({
              where: { id: coin.id },
              update: {
                symbol: coin.symbol,
                name: coin.name,
                updatedAt: new Date(),
              },
              create: { id: coin.id, symbol: coin.symbol, name: coin.name },
            });

            const redisInfoKey = `cg:info:${coin.id}`;
            await redis.set(
              redisInfoKey,
              JSON.stringify({ symbol: coin.symbol, name: coin.name }),
              { ex: 60 * 60 * 24 * 7 }
            );

            if (coin.platforms) {
              for (const [platformId, contractAddress] of Object.entries(
                coin.platforms
              )) {
                if (platformId && contractAddress) {
                  await tx.cgCoinPlatform.upsert({
                    where: {
                      cgId_platformId_contractAddress: {
                        cgId: coin.id,
                        platformId,
                        contractAddress,
                      },
                    },
                    update: {},
                    create: { cgId: coin.id, platformId, contractAddress },
                  });
                  const redisPlatformKey = `cg:${platformId}:${contractAddress.toLowerCase()}`;
                  await redis.set(redisPlatformKey, coin.id, {
                    ex: 60 * 60 * 24 * 7,
                  });
                  platformEntriesCount++;
                }
              }
            }
            processedCount++;
          }
        });
        console.log(
          `CoinGeckoService: Processed batch. Total coins: ${processedCount}, Total platforms: ${platformEntriesCount}`
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

  // 获取代币详细信息 (懒加载)
  async getCoinDetailsAndStore(
    cgId: string,
    maxStalenessHours: number = 2
  ): Promise<CgCoinDetails | null> {
    if (!cgId) {
      console.warn(
        "CoinGeckoService: getCoinDetailsAndStore called with invalid cgId."
      );
      return null;
    }

    const redisKey = `cg:details:${cgId}`;
    const cacheDurationSeconds = maxStalenessHours * 60 * 60;
    const now = new Date();

    // 1. Try fetching from Redis first
    try {
      const cachedDetailsString = await redis.get<string>(redisKey, false); // Get as raw string
      if (cachedDetailsString) {
        const cachedDetails = JSON.parse(cachedDetailsString) as CgCoinDetails;
        // Optional: Add a timestamp within the cached object to double-check staleness if needed,
        // but TTL is generally sufficient for this layer.
        // Ensure all date fields are proper Date objects after parsing
        if (cachedDetails.dataFetchedAt)
          cachedDetails.dataFetchedAt = new Date(cachedDetails.dataFetchedAt);
        if (cachedDetails.athDateUsd)
          cachedDetails.athDateUsd = new Date(cachedDetails.athDateUsd);
        if (cachedDetails.atlDateUsd)
          cachedDetails.atlDateUsd = new Date(cachedDetails.atlDateUsd);
        if (cachedDetails.cgLastUpdated)
          cachedDetails.cgLastUpdated = new Date(cachedDetails.cgLastUpdated);

        console.log(
          `CoinGeckoService: Returning details for ${cgId} from Redis cache.`
        );
        return cachedDetails;
      }
    } catch (error) {
      console.error(
        `CoinGeckoService: Redis error fetching details for ${cgId} from key ${redisKey}:`,
        error
      );
    }

    // 2. Try fetching from Database and check staleness
    try {
      const dbDetails = await this.prisma.cgCoinDetails.findUnique({
        where: { cgId },
      });

      if (dbDetails?.dataFetchedAt) {
        const stalenessDb =
          (now.getTime() - new Date(dbDetails.dataFetchedAt).getTime()) /
          (1000 * 60 * 60);

        if (stalenessDb < maxStalenessHours) {
          try {
            await redis.set(redisKey, JSON.stringify(dbDetails), {
              ex: cacheDurationSeconds,
            });
          } catch (redisSetError) {
            console.error(
              `CoinGeckoService: Failed to cache DB details to Redis for ${cgId}:`,
              redisSetError
            );
          }
          return dbDetails;
        }
      }
    } catch (dbError) {
      console.error(
        `CoinGeckoService: DB error fetching existing details for ${cgId}:`,
        dbError
      );
    }

    // 3. Fetch from API if not in Redis or DB is stale/missing
    console.log(`CoinGeckoService: Fetching new details from API for ${cgId}`);
    const apiDetails = await this.coingeckoClient.getCoinDetailsFromApi(cgId);

    if (!apiDetails || !apiDetails.id) {
      console.log(`CoinGeckoService: No details found from API for ${cgId}.`);
      return null;
    }

    // 4. Store new data in DB and cache in Redis
    try {
      const processedData = this.mapApiDetailToDbSchema(apiDetails);
      const newDbDetails = await this.prisma.cgCoinDetails.upsert({
        where: { cgId },
        update: { ...processedData, dataFetchedAt: now },
        create: { cgId, ...processedData, dataFetchedAt: now },
      });

      try {
        await redis.set(redisKey, JSON.stringify(newDbDetails), {
          ex: cacheDurationSeconds,
        });
      } catch (redisSetError) {
        console.error(
          `CoinGeckoService: Failed to cache new API details to Redis for ${cgId}:`,
          redisSetError
        );
      }
      return newDbDetails;
    } catch (error) {
      console.error(
        `CoinGeckoService: Error upserting API details for coin ${cgId}:`,
        error
      );
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
    const cacheDurationSeconds = 60 * 60; // 1 hour

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
          const details = await this.getCoinDetailsAndStore(trendItem.id, 1);
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
}
