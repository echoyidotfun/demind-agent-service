import { prisma } from "../lib/db/client";
import { DeFiLlamaClient } from "../lib/apiClients/defiLlamaClient";
import { redis } from "../lib/kv/client";

export class DeFiLlamaSyncService {
  private defiLlamaClient: DeFiLlamaClient;
  private readonly BATCH_SIZE = 500; // 批量处理大小

  // 添加EVM兼容链白名单（全部使用小写）
  private readonly EVM_CHAINS = new Set([
    // 主流EVM兼容链
    "ethereum",
    "bsc",
    "polygon",
    "arbitrum",
    "optimism",
    "avalanche",
    "base",
    "sonic",
    "berachain",
    "zksync",
    "zksync era",
    "fantom",
    "cronos",
    "gnosis",
    "moonbeam",
    "moonriver",
    "rootstock",
    "linea",
    "kava",
    "metis",
    "celo",
    "blast",
    "scroll",
    "mode",
    "mantle",
    "manta",
    "fraxtal",
    "unichain",
    "polygon zkevm",
    "sei",
    "swellchain",
    "taiko",
    "multi-chain", // 保留Multi-Chain标记的协议
  ]);

  constructor() {
    this.defiLlamaClient = new DeFiLlamaClient();
  }

  /**
   * 将数组分成指定大小的批次
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * 检查协议是否支持至少一个EVM兼容链
   */
  private isEVMCompatible(protocol: any): boolean {
    // 如果chain字段是EVM兼容链 (忽略大小写)
    if (protocol.chain && this.EVM_CHAINS.has(protocol.chain.toLowerCase())) {
      return true;
    }

    // 如果chains数组中包含至少一个EVM兼容链
    if (
      protocol.chains &&
      Array.isArray(protocol.chains) &&
      protocol.chains.length > 0
    ) {
      return protocol.chains.some((chain: string) =>
        this.EVM_CHAINS.has(chain.toLowerCase())
      );
    }

    return false;
  }

  async syncProtocols() {
    console.log("开始同步 DeFi 协议数据...");
    let successCount = 0;
    let errorCount = 0;
    let skippedInactiveCount = 0;
    let skippedNonEVMCount = 0;
    let protocolsFromApi = 0;
    let updatedCount = 0;
    let newCount = 0;

    try {
      const protocols = await this.defiLlamaClient.getProtocols();
      protocolsFromApi = protocols.length;
      console.log(`从 API 获取到 ${protocolsFromApi} 个协议，准备批量处理...`);

      if (protocolsFromApi === 0) {
        console.log("没有从 API 获取到协议数据，跳过同步。");
        return;
      }

      // 过滤掉非活跃协议并处理字段
      const activeProtocols = protocols.filter(
        (protocol) => !protocol.deadFrom
      );
      console.log(
        `过滤后剩余 ${activeProtocols.length} 个活跃协议，${
          protocols.length - activeProtocols.length
        } 个非活跃协议将被跳过。`
      );
      skippedInactiveCount = protocols.length - activeProtocols.length;

      // 进一步过滤，只保留EVM兼容链的协议
      const evmProtocols = activeProtocols.filter((protocol) =>
        this.isEVMCompatible(protocol)
      );
      console.log(
        `进一步过滤后剩余 ${evmProtocols.length} 个EVM兼容协议，${
          activeProtocols.length - evmProtocols.length
        } 个非EVM协议将被跳过。`
      );
      skippedNonEVMCount = activeProtocols.length - evmProtocols.length;

      // 获取所有已存在的协议ID，用于判断是新增还是更新
      const existingProtocolIds = new Set(
        (
          await prisma.protocol.findMany({
            select: { id: true },
          })
        ).map((p) => p.id)
      );

      console.log(`数据库中已存在 ${existingProtocolIds.size} 个协议记录`);

      // 将协议数据分批处理
      const protocolChunks = this.chunkArray(evmProtocols, this.BATCH_SIZE);
      console.log(
        `将 ${evmProtocols.length} 个EVM兼容协议分为 ${protocolChunks.length} 批进行处理`
      );

      for (let i = 0; i < protocolChunks.length; i++) {
        const chunk = protocolChunks[i];
        console.log(
          `处理第 ${i + 1}/${protocolChunks.length} 批协议数据 (${
            chunk.length
          } 个协议)...`
        );

        // 分离新增协议和已存在协议
        const newProtocols = chunk.filter(
          (p) => !existingProtocolIds.has(p.id)
        );
        const existingProtocols = chunk.filter((p) =>
          existingProtocolIds.has(p.id)
        );

        // 处理新协议 - 插入全部字段
        if (newProtocols.length > 0) {
          const createOperations = newProtocols.map((protocol) => {
            // 处理地址字段，如果是 chain:address 格式则提取实际地址部分
            let processedAddress = protocol.address;
            if (protocol.address && protocol.address.includes(":")) {
              processedAddress = protocol.address.split(":")[1];
            }

            // 处理chain字段，转换为小写
            const chainValue = protocol.chain
              ? protocol.chain.toLowerCase()
              : null;

            // 处理chains数组，转换为小写
            const chainsArray = protocol.chains
              ? protocol.chains.map((chain: string) => chain.toLowerCase())
              : [];

            return prisma.protocol.create({
              data: {
                id: protocol.id,
                name: protocol.name,
                slug: protocol.slug,
                address: processedAddress,
                symbol: protocol.symbol ?? null,
                description: protocol.description ?? null,
                chain: chainValue,
                logo: protocol.logo ?? null,
                audits: protocol.audits ?? null,
                auditLinks: protocol.audit_links || [],
                github: protocol.github ? protocol.github[0] : null,
                category: protocol.category ?? null,
                chains: chainsArray,
                tvl: protocol.tvl ?? null,
                change1h: protocol.change_1h ?? null,
                change1d: protocol.change_1d ?? null,
                change7d: protocol.change_7d ?? null,
                mcap: protocol.mcap ?? null,
                twitter: protocol.twitter ?? null,
                url: protocol.url ?? null,
              },
            });
          });

          try {
            // 将新建操作包装在一个事务中
            const results = await prisma.$transaction(createOperations);
            successCount += results.length;
            newCount += results.length;
          } catch (transactionError) {
            errorCount += newProtocols.length;
            console.error(
              `第 ${i + 1} 批新增协议数据事务写入失败:`,
              transactionError
            );
          }
        }

        // 处理已存在协议 - 只更新动态字段
        if (existingProtocols.length > 0) {
          const updateOperations = existingProtocols.map((protocol) => {
            return prisma.protocol.update({
              where: { id: protocol.id },
              data: {
                // 只更新动态数据字段
                tvl: protocol.tvl ?? null,
                change1h: protocol.change_1h ?? null,
                change1d: protocol.change_1d ?? null,
                change7d: protocol.change_7d ?? null,
                mcap: protocol.mcap ?? null,
                updatedAt: new Date(), // 更新时间戳
              },
            });
          });

          try {
            // 将更新操作包装在一个事务中
            const results = await prisma.$transaction(updateOperations);
            successCount += results.length;
            updatedCount += results.length;
          } catch (transactionError) {
            errorCount += existingProtocols.length;
            console.error(
              `第 ${i + 1} 批更新协议数据事务写入失败:`,
              transactionError
            );
          }
        }
      }

      if (errorCount > 0) {
        console.warn(
          `DeFi 协议数据同步部分完成: ${successCount} 个成功 (${newCount} 个新增, ${updatedCount} 个更新), ${errorCount} 个失败, ${skippedInactiveCount} 个非活跃协议被跳过, ${skippedNonEVMCount} 个非EVM协议被跳过 (总共 ${protocolsFromApi} 个).`
        );
        // 如果全部失败，则抛出异常
        if (successCount === 0) {
          throw new Error(
            `所有协议数据同步均失败 (${errorCount}/${evmProtocols.length})`
          );
        }
      } else {
        console.log(
          `DeFi 协议数据同步完成: ${successCount} 个协议已成功处理 (${newCount} 个新增, ${updatedCount} 个更新), ${skippedInactiveCount} 个非活跃协议被跳过, ${skippedNonEVMCount} 个非EVM协议被跳过.`
        );
      }
    } catch (apiError) {
      console.error("从 DeFiLlama API 获取协议数据失败:", apiError);
      throw apiError; // 重新抛出以便调用者知道
    }

    // 尝试更新 Redis 缓存，即使部分数据库写入失败
    if (successCount > 0) {
      try {
        const protocolsForCache = await prisma.protocol.findMany({
          select: {
            id: true,
            name: true,
            slug: true,
            tvl: true,
            category: true,
          },
        });
        await redis.set(
          "defillama:protocols:list",
          JSON.stringify(protocolsForCache),
          { ex: 3600 }
        );
        console.log(
          `协议列表已成功更新到 Redis 缓存 (${protocolsForCache.length} 个).`
        );
      } catch (redisError) {
        console.error("更新 Redis 缓存 (protocols:list) 失败:", redisError);
        // Redis 缓存失败不应阻止整个同步流程
      }
    }

    // 如果所有操作都失败，则抛出异常
    if (errorCount === protocolsFromApi && protocolsFromApi > 0) {
      throw new Error(
        `所有协议数据写入操作均失败 (${errorCount}/${protocolsFromApi})`
      );
    }
  }

  async syncPools() {
    console.log("开始同步资金池数据...");
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let skippedNonEVMCount = 0;
    let poolsFromApi = 0;
    let updatedCount = 0;
    let newCount = 0;

    try {
      // 首先获取所有已存在的协议 slug，用于验证外键约束
      const existingProtocolSlugs = await prisma.protocol.findMany({
        select: {
          slug: true,
        },
      });
      const validProtocolSlugs = new Set(
        existingProtocolSlugs.map((protocol) => protocol.slug)
      );
      console.log(
        `从数据库获取到 ${validProtocolSlugs.size} 个有效协议 slug，用于外键验证。`
      );

      // 获取所有已存在的资金池ID，用于判断是新增还是更新
      const existingPoolIds = new Set(
        (
          await prisma.pool.findMany({
            select: { id: true },
          })
        ).map((p) => p.id)
      );
      console.log(`数据库中已存在 ${existingPoolIds.size} 个资金池记录`);

      const pools = await this.defiLlamaClient.getPools();
      poolsFromApi = pools.length;
      console.log(`从 API 获取到 ${poolsFromApi} 个资金池，准备批量处理...`);

      if (poolsFromApi === 0) {
        console.log("没有从 API 获取到资金池数据，跳过同步。");
        return;
      }

      // 筛选有效的资金池（协议存在于数据库中）
      const validPools = pools.filter((pool) =>
        validProtocolSlugs.has(pool.project)
      );
      const invalidPools = pools.filter(
        (pool) => !validProtocolSlugs.has(pool.project)
      );
      skippedCount = invalidPools.length;

      console.log(
        `筛选后: ${validPools.length} 个有效资金池，${skippedCount} 个因协议不存在而跳过。`
      );

      // 进一步过滤，只保留EVM兼容链的资金池（忽略大小写）
      const evmPools = validPools.filter((pool) =>
        this.EVM_CHAINS.has(pool.chain.toLowerCase())
      );
      skippedNonEVMCount = validPools.length - evmPools.length;
      console.log(
        `进一步过滤后: ${evmPools.length} 个EVM兼容资金池，${skippedNonEVMCount} 个非EVM资金池被跳过。`
      );

      // 将有效资金池分批处理
      const poolChunks = this.chunkArray(evmPools, this.BATCH_SIZE);
      console.log(
        `将 ${evmPools.length} 个有效资金池分为 ${poolChunks.length} 批进行处理`
      );

      for (let i = 0; i < poolChunks.length; i++) {
        const chunk = poolChunks[i];
        console.log(
          `处理第 ${i + 1}/${poolChunks.length} 批资金池数据 (${
            chunk.length
          } 个资金池)...`
        );

        // 分离新增资金池和已存在资金池
        const newPools = chunk.filter((p) => !existingPoolIds.has(p.pool));
        const existingPools = chunk.filter((p) => existingPoolIds.has(p.pool));

        // 处理新增资金池 - 批量插入资金池和关联token
        if (newPools.length > 0) {
          try {
            // 1. 批量创建资金池
            const poolCreateData = newPools.map((pool) => ({
              id: pool.pool,
              chain: pool.chain.toLowerCase(),
              project: pool.project,
              symbol: pool.symbol,
              tvlUsd: pool.tvlUsd,
              apyBase: pool.apyBase,
              apyReward: pool.apyReward,
              apy: pool.apy,
              rewardTokens: pool.rewardTokens
                ? JSON.stringify(pool.rewardTokens)
                : null,
              stablecoin: pool.stablecoin || false,
              ilRisk: pool.ilRisk,
              exposure: pool.exposure,
              poolMeta: pool.poolMeta,
            }));

            // 批量创建资金池
            await prisma.$transaction(async (prismaClient) => {
              await prismaClient.pool.createMany({
                data: poolCreateData,
                skipDuplicates: true,
              });
            });

            // 2. 收集所有需要创建的PoolToken记录
            const allPoolTokensToCreate: {
              poolId: string;
              tokenAddress: string;
              chain: string;
            }[] = [];
            newPools.forEach((pool) => {
              if (
                pool.underlyingTokens &&
                Array.isArray(pool.underlyingTokens) &&
                pool.underlyingTokens.length > 0
              ) {
                pool.underlyingTokens.forEach((tokenAddress) => {
                  // 确保tokenAddress是有效的非空字符串
                  if (
                    tokenAddress &&
                    typeof tokenAddress === "string" &&
                    tokenAddress.trim() !== ""
                  ) {
                    allPoolTokensToCreate.push({
                      poolId: pool.pool,
                      tokenAddress: tokenAddress.trim(), // 去除可能的空格
                      chain: pool.chain.toLowerCase(),
                    });
                  } else {
                    console.warn(
                      `跳过无效的tokenAddress: ${tokenAddress}，对应资金池ID: ${pool.pool}`
                    );
                  }
                });
              }
            });

            // 3. 如果有token记录需要创建，批量创建
            if (allPoolTokensToCreate.length > 0) {
              console.log(
                `批量创建 ${allPoolTokensToCreate.length} 个底层代币关联记录`
              );

              // 校验每条记录是否包含所有必需字段
              const validRecords = allPoolTokensToCreate.filter((record) => {
                const isValid =
                  record.poolId && record.tokenAddress && record.chain;
                if (!isValid) {
                  console.warn(`发现无效记录: ${JSON.stringify(record)}`);
                }
                return isValid;
              });

              console.log(`过滤后有 ${validRecords.length} 条有效记录`);

              // 分批处理token创建，避免一次性处理过多记录
              const tokenBatchSize = 1000;
              const tokenBatches = this.chunkArray(
                validRecords,
                tokenBatchSize
              );

              for (const tokenBatch of tokenBatches) {
                try {
                  await prisma.poolToken.createMany({
                    data: tokenBatch,
                    skipDuplicates: true,
                  });
                } catch (error) {
                  console.error(`创建PoolToken批次失败:`, error);

                  // 尝试逐个创建以隔离问题记录
                  if (tokenBatch.length < 50) {
                    console.log(
                      `尝试逐个创建${tokenBatch.length}个记录以识别问题...`
                    );
                    for (const record of tokenBatch) {
                      try {
                        await prisma.poolToken.create({ data: record });
                      } catch (singleError) {
                        console.error(
                          `单条记录创建失败: ${JSON.stringify(record)}`,
                          singleError
                        );
                      }
                    }
                  }
                }
              }
            }

            successCount += newPools.length;
            newCount += newPools.length;
          } catch (transactionError) {
            errorCount += newPools.length;
            console.error(
              `第 ${i + 1} 批新增资金池数据批量写入失败:`,
              transactionError
            );
          }
        }

        // 处理已存在资金池 - 只更新动态字段（tvl和apy相关），不更新底层代币
        if (existingPools.length > 0) {
          try {
            // 批量更新资金池基本信息
            const updateOperations = existingPools.map((pool) =>
              prisma.pool.update({
                where: { id: pool.pool },
                data: {
                  tvlUsd: pool.tvlUsd,
                  apyBase: pool.apyBase,
                  apyReward: pool.apyReward,
                  apy: pool.apy,
                  updatedAt: new Date(),
                },
              })
            );

            // 将更新操作包装在一个事务中
            await prisma.$transaction(updateOperations);
            successCount += existingPools.length;
            updatedCount += existingPools.length;
          } catch (transactionError) {
            errorCount += existingPools.length;
            console.error(
              `第 ${i + 1} 批更新资金池数据事务写入失败:`,
              transactionError
            );
          }
        }
      }

      if (invalidPools.length > 0) {
        console.warn(
          `跳过了 ${invalidPools.length} 个资金池，因为它们的协议 (project) 在数据库中不存在:`
        );
        const groupedByProject: Record<string, number> = {};
        invalidPools.forEach((pool) => {
          if (!groupedByProject[pool.project]) {
            groupedByProject[pool.project] = 0;
          }
          groupedByProject[pool.project]++;
        });

        Object.entries(groupedByProject)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10) // 只显示前10个最常见的缺失协议
          .forEach(([project, count]) => {
            console.warn(`  - 协议 "${project}" 缺失: ${count} 个资金池`);
          });
      }

      if (errorCount > 0) {
        console.warn(
          `资金池数据同步部分完成: ${successCount} 个成功 (${newCount} 个新增, ${updatedCount} 个更新), ${errorCount} 个失败, ${skippedCount} 个跳过, ${skippedNonEVMCount} 个非EVM链跳过 (总共 ${poolsFromApi} 个).`
        );
      } else {
        console.log(
          `资金池数据同步完成: ${successCount} 个资金池已成功处理 (${newCount} 个新增, ${updatedCount} 个更新), ${skippedCount} 个因协议缺失跳过, ${skippedNonEVMCount} 个因非EVM链跳过.`
        );
      }
    } catch (apiError) {
      console.error("从 DeFiLlama API 获取资金池数据失败:", apiError);
      throw apiError;
    }

    if (successCount > 0) {
      try {
        const highYieldPools = await prisma.pool.findMany({
          where: { apy: { gt: 0 } },
          orderBy: { apy: "desc" },
          take: 100,
          select: {
            id: true,
            chain: true,
            project: true,
            symbol: true,
            tvlUsd: true,
            apy: true,
          },
        });
        await redis.set(
          "defillama:pools:high-yield",
          JSON.stringify(highYieldPools),
          { ex: 3600 }
        );
        console.log(
          `高收益资金池列表已成功更新到 Redis 缓存 (${highYieldPools.length} 个).`
        );
      } catch (redisError) {
        console.error("更新 Redis 缓存 (pools:high-yield) 失败:", redisError);
      }
    }

    // 如果所有操作都失败且有资金池需要处理，则抛出异常
    if (
      errorCount === poolsFromApi - skippedCount - skippedNonEVMCount &&
      poolsFromApi - skippedCount - skippedNonEVMCount > 0
    ) {
      throw new Error(
        `所有资金池数据写入操作均失败 (${errorCount}/${
          poolsFromApi - skippedCount - skippedNonEVMCount
        })`
      );
    }
  }

  async syncStablecoins() {
    console.log("开始同步稳定币数据...");
    let successCount = 0;
    let errorCount = 0;
    let stablecoinsFromApi = 0;

    try {
      const stablecoins = await this.defiLlamaClient.getStablecoins();
      stablecoinsFromApi = stablecoins.length;
      console.log(
        `从 API 获取到 ${stablecoinsFromApi} 个稳定币，准备批量处理...`
      );

      if (stablecoinsFromApi === 0) {
        console.log("没有从 API 获取到稳定币数据，跳过同步。");
        return;
      }

      // 将稳定币数据分批处理
      const stablecoinChunks = this.chunkArray(stablecoins, this.BATCH_SIZE);
      console.log(
        `将 ${stablecoinsFromApi} 个稳定币分为 ${stablecoinChunks.length} 批进行处理`
      );

      for (let i = 0; i < stablecoinChunks.length; i++) {
        const chunk = stablecoinChunks[i];
        console.log(
          `处理第 ${i + 1}/${stablecoinChunks.length} 批稳定币数据 (${
            chunk.length
          } 个稳定币)...`
        );

        const upsertOperations = chunk.map((coin) => {
          // 处理chains数组，转换为小写
          const chainsArray = coin.chains
            ? coin.chains.map((chain: string) => chain.toLowerCase())
            : [];

          const coinData = {
            name: coin.name,
            symbol: coin.symbol,
            geckoId: coin.gecko_id,
            pegType: coin.pegType,
            pegMechanism: coin.pegMechanism,
            circulating: coin.circulating?.peggedUSD || 0,
            price: coin.price,
            chains: chainsArray,
          };
          return prisma.stablecoin.upsert({
            where: { id: coin.id },
            update: coinData,
            create: { id: coin.id, ...coinData },
          });
        });

        try {
          const results = await prisma.$transaction(upsertOperations);
          successCount += results.length;
        } catch (transactionError) {
          errorCount += chunk.length;
          console.error(
            `第 ${i + 1} 批稳定币数据事务写入失败:`,
            transactionError
          );
          // 继续处理下一批
        }
      }

      if (errorCount > 0) {
        console.warn(
          `稳定币数据同步部分完成: ${successCount} 个成功, ${errorCount} 个失败 (总共 ${stablecoinsFromApi} 个).`
        );
      } else {
        console.log(`稳定币数据同步完成: ${successCount} 个稳定币已成功同步.`);
      }
    } catch (apiError) {
      console.error("从 DeFiLlama API 获取稳定币数据失败:", apiError);
      throw apiError;
    }

    if (successCount > 0) {
      try {
        const stablecoinsForCache = await prisma.stablecoin.findMany({
          select: {
            id: true,
            name: true,
            symbol: true,
            circulating: true,
            price: true,
          },
        });
        await redis.set(
          "defillama:stablecoins:list",
          JSON.stringify(stablecoinsForCache),
          { ex: 3600 }
        );
        console.log(
          `稳定币列表已成功更新到 Redis 缓存 (${stablecoinsForCache.length} 个).`
        );
      } catch (redisError) {
        console.error("更新 Redis 缓存 (stablecoins:list) 失败:", redisError);
      }
    }

    // 如果所有操作都失败，则抛出异常
    if (errorCount === stablecoinsFromApi && stablecoinsFromApi > 0) {
      throw new Error(
        `所有稳定币数据写入操作均失败 (${errorCount}/${stablecoinsFromApi})`
      );
    }
  }

  async syncPoolChart(poolId: string) {
    console.log(`开始同步资金池 ${poolId} 的历史数据...`);
    let successCount = 0;
    let errorCount = 0;
    let chartDataLength = 0;
    let filteredDataLength = 0;

    try {
      // 计算7天前的日期作为截止点
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      console.log(`将只保留 ${sevenDaysAgo.toISOString()} 之后的数据`);

      const chartData = await this.defiLlamaClient.getPoolChart(poolId);
      chartDataLength = chartData.length;

      if (chartDataLength === 0) {
        console.log(`资金池 ${poolId} 没有历史图表数据，跳过同步。`);
        return;
      }

      // 过滤只保留最近7天的数据
      const recentChartData = chartData.filter(
        (point) => new Date(point.timestamp) >= sevenDaysAgo
      );
      filteredDataLength = recentChartData.length;

      console.log(
        `获取到 ${chartDataLength} 个历史数据点，过滤后保留 ${filteredDataLength} 个近7日数据点`
      );

      // 删除该池子7天前的旧数据
      const deletedOldData = await prisma.poolChart.deleteMany({
        where: {
          poolId,
          timestamp: { lt: sevenDaysAgo },
        },
      });

      console.log(`已删除 ${deletedOldData.count} 条7天前的旧数据`);

      // 分批处理历史数据
      const chartDataChunks = this.chunkArray(recentChartData, 100);
      console.log(
        `将 ${filteredDataLength} 个近期历史数据点分为 ${chartDataChunks.length} 批进行处理`
      );

      for (let i = 0; i < chartDataChunks.length; i++) {
        const chunk = chartDataChunks[i];
        try {
          // 使用批量创建代替逐条创建
          const createManyResult = await prisma.poolChart.createMany({
            data: chunk.map((point) => ({
              poolId,
              timestamp: new Date(point.timestamp),
              tvlUsd: point.tvlUsd,
              apy: point.apy,
              apyBase: point.apyBase,
              apyReward: point.apyReward,
            })),
            skipDuplicates: true,
          });

          successCount += createManyResult.count;
        } catch (dbError) {
          errorCount += chunk.length;
          console.error(
            `资金池 ${poolId} 的历史数据批次 ${i + 1}/${
              chartDataChunks.length
            } 写入失败: `,
            dbError
          );
        }
      }

      if (errorCount > 0) {
        console.warn(
          `资金池 ${poolId} 历史数据同步部分完成: ${successCount} 个成功 (来自 ${filteredDataLength} 个近7日数据点), ${errorCount} 个失败.`
        );
      } else {
        console.log(
          `资金池 ${poolId} 历史数据同步完成: ${successCount} 个数据点已同步 (来自 ${filteredDataLength} 个近7日数据点).`
        );
      }

      try {
        // 保存到Redis也只保存近7天数据
        await redis.set(
          `defillama:poolchart:${poolId}`,
          JSON.stringify(recentChartData),
          { ex: 86400 }
        );
        console.log(`资金池 ${poolId} 近7日历史数据已成功更新到 Redis 缓存。`);
      } catch (redisError) {
        console.error(
          `更新资金池 ${poolId} 历史数据的 Redis 缓存失败:`,
          redisError
        );
      }
    } catch (error) {
      console.error(`同步资金池 ${poolId} 历史数据失败 (整体错误):`, error);
      // syncPoolChart 的错误不应阻止 syncAll 继续其他池子
    }
  }

  async syncAll() {
    console.log("--- 开始完整数据同步 ---");
    let protocolsSuccess = false;
    let poolsSuccess = false;
    let stablecoinsSuccess = false;

    // 同步协议数据
    try {
      await this.syncProtocols();
      protocolsSuccess = true;
    } catch (error) {
      console.error("协议数据同步失败:", error);
      // 继续执行后续步骤
    }

    // 同步资金池数据
    try {
      await this.syncPools();
      poolsSuccess = true;
    } catch (error) {
      console.error("资金池数据同步失败:", error);
      // 继续执行后续步骤
    }

    // 同步稳定币数据
    try {
      await this.syncStablecoins();
      stablecoinsSuccess = true;
    } catch (error) {
      console.error("稳定币数据同步失败:", error);
      // 继续执行后续步骤
    }

    if (poolsSuccess) {
      console.log("--- 开始同步重点池子历史数据 ---");
      let topPoolsToSync: { id: string }[] = [];
      try {
        topPoolsToSync = await prisma.pool.findMany({
          where: {
            tvlUsd: { gt: 1_000_000 },
            apy: { gt: 5 },
          },
          orderBy: { apy: "desc" },
          take: 10,
          select: { id: true },
        });
        console.log(`计划同步 ${topPoolsToSync.length} 个重点池子的历史数据.`);
      } catch (dbReadError) {
        console.error("获取重点同步池列表失败:", dbReadError);
      }

      for (const pool of topPoolsToSync) {
        await this.syncPoolChart(pool.id);
      }
    } else {
      console.log("跳过同步重点池子历史数据，因为资金池同步失败。");
    }

    // 输出同步结果摘要
    console.log("--- 完整数据同步完成 ---");
    console.log(`协议数据: ${protocolsSuccess ? "成功" : "失败"}`);
    console.log(`资金池数据: ${poolsSuccess ? "成功" : "失败"}`);
    console.log(`稳定币数据: ${stablecoinsSuccess ? "成功" : "失败"}`);

    // 如果所有主要同步都失败，则返回错误状态
    if (!protocolsSuccess && !poolsSuccess && !stablecoinsSuccess) {
      throw new Error("所有主要数据同步任务均失败");
    }
  }
}
