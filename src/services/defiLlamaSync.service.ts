import { prisma } from "../lib/db/client";
import { DeFiLlamaClient } from "../lib/apiClients/defiLlamaClient";
import { redis } from "../lib/kv/redisClient";

export class DeFiLlamaSyncService {
  private defiLlamaClient: DeFiLlamaClient;
  private readonly BATCH_SIZE = 500; // Batch processing size

  // Whitelist of EVM compatible chains (all lowercase)
  private readonly EVM_CHAINS = new Set([
    // Mainstream EVM compatible chains
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
    "multi-chain", // Keep protocols tagged with Multi-Chain
  ]);

  constructor() {
    this.defiLlamaClient = new DeFiLlamaClient();
  }

  /**
   * Chunks an array into smaller arrays of a specified size.
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Checks if the protocol supports at least one EVM compatible chain.
   */
  private isEVMCompatible(protocol: any): boolean {
    // If the chain field is an EVM compatible chain (case-insensitive)
    if (protocol.chain && this.EVM_CHAINS.has(protocol.chain.toLowerCase())) {
      return true;
    }

    // If the chains array contains at least one EVM compatible chain
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
    console.log("Starting DeFi protocol data synchronization...");
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
      console.log(
        `Fetched ${protocolsFromApi} protocols from API, preparing for batch processing...`
      );

      if (protocolsFromApi === 0) {
        console.log("No protocol data fetched from API, skipping sync.");
        return;
      }

      // Filter out inactive protocols and process fields
      const activeProtocols = protocols.filter(
        (protocol) => !protocol.deadFrom
      );
      console.log(
        `Filtered to ${activeProtocols.length} active protocols. ${
          protocols.length - activeProtocols.length
        } inactive protocols will be skipped.`
      );
      skippedInactiveCount = protocols.length - activeProtocols.length;

      // Further filter to keep only EVM compatible protocols
      const evmProtocols = activeProtocols.filter((protocol) =>
        this.isEVMCompatible(protocol)
      );
      console.log(
        `Further filtered to ${evmProtocols.length} EVM compatible protocols. ${
          activeProtocols.length - evmProtocols.length
        } non-EVM protocols will be skipped.`
      );
      skippedNonEVMCount = activeProtocols.length - evmProtocols.length;

      // Get all existing protocol IDs to determine new vs. update
      const existingProtocolIds = new Set(
        (
          await prisma.protocol.findMany({
            select: { id: true },
          })
        ).map((p) => p.id)
      );

      console.log(
        `Found ${existingProtocolIds.size} protocol records already in the database.`
      );

      // Batch process protocol data
      const protocolChunks = this.chunkArray(evmProtocols, this.BATCH_SIZE);
      console.log(
        `Processing ${evmProtocols.length} EVM compatible protocols in ${protocolChunks.length} batches.`
      );

      for (let i = 0; i < protocolChunks.length; i++) {
        const chunk = protocolChunks[i];
        console.log(
          `Processing batch ${i + 1}/${
            protocolChunks.length
          } of protocol data (${chunk.length} protocols)...`
        );

        // Separate new and existing protocols
        const newProtocols = chunk.filter(
          (p) => !existingProtocolIds.has(p.id)
        );
        const existingProtocols = chunk.filter((p) =>
          existingProtocolIds.has(p.id)
        );

        // Process new protocols - insert all fields
        if (newProtocols.length > 0) {
          const createOperations = newProtocols.map((protocol) => {
            // Process address field, extract actual address if in chain:address format
            let processedAddress = protocol.address;
            if (protocol.address && protocol.address.includes(":")) {
              processedAddress = protocol.address.split(":")[1];
            }

            // Process chain field, convert to lowercase
            const chainValue = protocol.chain
              ? protocol.chain.toLowerCase()
              : null;

            // Process chains array, convert to lowercase
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
            // Wrap create operations in a transaction
            const results = await prisma.$transaction(createOperations);
            successCount += results.length;
            newCount += results.length;
          } catch (transactionError) {
            errorCount += newProtocols.length;
            console.error(
              `Transaction write failed for new protocols batch ${i + 1}:`,
              transactionError
            );
          }
        }

        // Process existing protocols - only update dynamic fields
        if (existingProtocols.length > 0) {
          const updateOperations = existingProtocols.map((protocol) => {
            return prisma.protocol.update({
              where: { id: protocol.id },
              data: {
                // Only update dynamic data fields
                tvl: protocol.tvl ?? null,
                change1h: protocol.change_1h ?? null,
                change1d: protocol.change_1d ?? null,
                change7d: protocol.change_7d ?? null,
                mcap: protocol.mcap ?? null,
                updatedAt: new Date(), // Update timestamp
              },
            });
          });

          try {
            // Wrap update operations in a transaction
            const results = await prisma.$transaction(updateOperations);
            successCount += results.length;
            updatedCount += results.length;
          } catch (transactionError) {
            errorCount += existingProtocols.length;
            console.error(
              `Transaction write failed for updating protocols batch ${i + 1}:`,
              transactionError
            );
          }
        }
      }

      if (errorCount > 0) {
        console.warn(
          `DeFi protocol data sync partially completed: ${successCount} succeeded (${newCount} new, ${updatedCount} updated), ${errorCount} failed, ${skippedInactiveCount} inactive protocols skipped, ${skippedNonEVMCount} non-EVM protocols skipped (total ${protocolsFromApi}).`
        );
        // If all failed, throw an exception
        if (successCount === 0) {
          throw new Error(
            `All protocol data sync operations failed (${errorCount}/${evmProtocols.length})`
          );
        }
      } else {
        console.log(
          `DeFi protocol data sync completed: ${successCount} protocols processed successfully (${newCount} new, ${updatedCount} updated), ${skippedInactiveCount} inactive protocols skipped, ${skippedNonEVMCount} non-EVM protocols skipped.`
        );
      }
    } catch (apiError) {
      console.error(
        "Failed to fetch protocol data from DeFiLlama API:",
        apiError
      );
      throw apiError; // Re-throw for the caller
    }

    // If all operations failed, throw an exception
    if (errorCount === protocolsFromApi && protocolsFromApi > 0) {
      throw new Error(
        `All protocol data write operations failed (${errorCount}/${protocolsFromApi})`
      );
    }
  }

  async syncPools() {
    console.log("Starting pool data synchronization...");
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let skippedNonEVMCount = 0;
    let poolsFromApi = 0;
    let updatedCount = 0;
    let newCount = 0;

    try {
      // First, get all existing protocol slugs for foreign key constraint validation
      const existingProtocolSlugs = await prisma.protocol.findMany({
        select: {
          slug: true,
        },
      });
      const validProtocolSlugs = new Set(
        existingProtocolSlugs.map((protocol) => protocol.slug)
      );
      console.log(
        `Fetched ${validProtocolSlugs.size} valid protocol slugs from database for foreign key validation.`
      );

      // Get all existing pool IDs to determine new vs. update
      const existingPoolIds = new Set(
        (
          await prisma.pool.findMany({
            select: { id: true },
          })
        ).map((p) => p.id)
      );
      console.log(
        `Found ${existingPoolIds.size} pool records already in the database.`
      );

      const pools = await this.defiLlamaClient.getPools();
      poolsFromApi = pools.length;
      console.log(
        `Fetched ${poolsFromApi} pools from API, preparing for batch processing...`
      );

      if (poolsFromApi === 0) {
        console.log("No pool data fetched from API, skipping sync.");
        return;
      }

      // Filter valid pools (protocol exists in DB)
      const validPools = pools.filter((pool) =>
        validProtocolSlugs.has(pool.project)
      );
      const invalidPools = pools.filter(
        (pool) => !validProtocolSlugs.has(pool.project)
      );
      skippedCount = invalidPools.length;

      console.log(
        `Filtered: ${validPools.length} valid pools, ${skippedCount} skipped due to non-existent protocol.`
      );

      // Further filter to keep only EVM compatible pools (case-insensitive)
      const evmPools = validPools.filter((pool) =>
        this.EVM_CHAINS.has(pool.chain.toLowerCase())
      );
      skippedNonEVMCount = validPools.length - evmPools.length;
      console.log(
        `Further filtered: ${evmPools.length} EVM compatible pools, ${skippedNonEVMCount} non-EVM pools skipped.`
      );

      // Batch process valid pools
      const poolChunks = this.chunkArray(evmPools, this.BATCH_SIZE);
      console.log(
        `Processing ${evmPools.length} valid pools in ${poolChunks.length} batches.`
      );

      for (let i = 0; i < poolChunks.length; i++) {
        const chunk = poolChunks[i];
        console.log(
          `Processing batch ${i + 1}/${poolChunks.length} of pool data (${
            chunk.length
          } pools)...`
        );

        // Separate new and existing pools
        const newPools = chunk.filter((p) => !existingPoolIds.has(p.pool));
        const existingPools = chunk.filter((p) => existingPoolIds.has(p.pool));

        // Process new pools - batch insert pools and associated tokens
        if (newPools.length > 0) {
          try {
            // 1. Batch create pools
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

            // Batch create pools
            await prisma.$transaction(async (prismaClient) => {
              await prismaClient.pool.createMany({
                data: poolCreateData,
                skipDuplicates: true,
              });
            });

            // 2. Collect all PoolToken records to create
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
                  // Ensure tokenAddress is a valid non-empty string
                  if (
                    tokenAddress &&
                    typeof tokenAddress === "string" &&
                    tokenAddress.trim() !== ""
                  ) {
                    allPoolTokensToCreate.push({
                      poolId: pool.pool,
                      tokenAddress: tokenAddress.trim(), // Trim whitespace
                      chain: pool.chain.toLowerCase(),
                    });
                  } else {
                    console.warn(
                      `Skipping invalid tokenAddress: ${tokenAddress} for pool ID: ${pool.pool}`
                    );
                  }
                });
              }
            });

            // 3. If there are token records to create, batch create them
            if (allPoolTokensToCreate.length > 0) {
              console.log(
                `Batch creating ${allPoolTokensToCreate.length} underlying token association records.`
              );

              // Validate each record for required fields
              const validRecords = allPoolTokensToCreate.filter((record) => {
                const isValid =
                  record.poolId && record.tokenAddress && record.chain;
                if (!isValid) {
                  console.warn(
                    `Found invalid record: ${JSON.stringify(record)}`
                  );
                }
                return isValid;
              });

              console.log(`Filtered to ${validRecords.length} valid records.`);

              // Batch process token creation to avoid too many records at once
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
                  console.error(`Failed to create PoolToken batch:`, error);

                  // Try creating one by one to isolate the problematic record
                  if (tokenBatch.length < 50) {
                    console.log(
                      `Attempting to create ${tokenBatch.length} records one by one to identify the issue...`
                    );
                    for (const record of tokenBatch) {
                      try {
                        await prisma.poolToken.create({ data: record });
                      } catch (singleError) {
                        console.error(
                          `Failed to create single record: ${JSON.stringify(
                            record
                          )}`,
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
              `Batch write failed for new pools batch ${i + 1}:`,
              transactionError
            );
          }
        }

        // Process existing pools - only update dynamic fields (TVL and APY related), not underlying tokens
        if (existingPools.length > 0) {
          try {
            // Batch update pool basic info
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

            // Wrap update operations in a transaction
            await prisma.$transaction(updateOperations);
            successCount += existingPools.length;
            updatedCount += existingPools.length;
          } catch (transactionError) {
            errorCount += existingPools.length;
            console.error(
              `Transaction write failed for updating pools batch ${i + 1}:`,
              transactionError
            );
          }
        }
      }

      if (invalidPools.length > 0) {
        console.warn(
          `Skipped ${invalidPools.length} pools because their protocol (project) does not exist in the database:`
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
          .slice(0, 10) // Show only top 10 most common missing protocols
          .forEach(([project, count]) => {
            console.warn(`  - Protocol "${project}" missing: ${count} pools`);
          });
      }

      if (errorCount > 0) {
        console.warn(
          `Pool data sync partially completed: ${successCount} succeeded (${newCount} new, ${updatedCount} updated), ${errorCount} failed, ${skippedCount} skipped, ${skippedNonEVMCount} non-EVM chain skipped (total ${poolsFromApi}).`
        );
      } else {
        console.log(
          `Pool data sync completed: ${successCount} pools processed successfully (${newCount} new, ${updatedCount} updated), ${skippedCount} skipped due to missing protocol, ${skippedNonEVMCount} skipped due to non-EVM chain.`
        );
      }
    } catch (apiError) {
      console.error("Failed to fetch pool data from DeFiLlama API:", apiError);
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
          `High-yield pools list successfully updated in Redis cache (${highYieldPools.length}).`
        );
      } catch (redisError) {
        console.error(
          "Failed to update Redis cache (pools:high-yield):",
          redisError
        );
      }
    }

    // If all operations failed and there were pools to process, throw an exception
    if (
      errorCount === poolsFromApi - skippedCount - skippedNonEVMCount &&
      poolsFromApi - skippedCount - skippedNonEVMCount > 0
    ) {
      throw new Error(
        `All pool data write operations failed (${errorCount}/${
          poolsFromApi - skippedCount - skippedNonEVMCount
        })`
      );
    }
  }

  async syncStablecoins() {
    console.log("Starting stablecoin data synchronization...");
    let successCount = 0;
    let errorCount = 0;
    let stablecoinsFromApi = 0;

    try {
      const stablecoins = await this.defiLlamaClient.getStablecoins();
      stablecoinsFromApi = stablecoins.length;
      console.log(
        `Fetched ${stablecoinsFromApi} stablecoins from API, preparing for batch processing...`
      );

      if (stablecoinsFromApi === 0) {
        console.log("No stablecoin data fetched from API, skipping sync.");
        return;
      }

      // Batch process stablecoin data
      const stablecoinChunks = this.chunkArray(stablecoins, this.BATCH_SIZE);
      console.log(
        `Processing ${stablecoinsFromApi} stablecoins in ${stablecoinChunks.length} batches.`
      );

      for (let i = 0; i < stablecoinChunks.length; i++) {
        const chunk = stablecoinChunks[i];
        console.log(
          `Processing batch ${i + 1}/${
            stablecoinChunks.length
          } of stablecoin data (${chunk.length} stablecoins)...`
        );

        const upsertOperations = chunk.map((coin) => {
          // Process chains array, convert to lowercase
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
            `Transaction write failed for stablecoins batch ${i + 1}:`,
            transactionError
          );
          // Continue to next batch
        }
      }

      if (errorCount > 0) {
        console.warn(
          `Stablecoin data sync partially completed: ${successCount} succeeded, ${errorCount} failed (total ${stablecoinsFromApi}).`
        );
      } else {
        console.log(
          `Stablecoin data sync completed: ${successCount} stablecoins successfully synced.`
        );
      }
    } catch (apiError) {
      console.error(
        "Failed to fetch stablecoin data from DeFiLlama API:",
        apiError
      );
      throw apiError;
    }

    // If all operations failed, throw an exception
    if (errorCount === stablecoinsFromApi && stablecoinsFromApi > 0) {
      throw new Error(
        `All stablecoin data write operations failed (${errorCount}/${stablecoinsFromApi})`
      );
    }
  }

  async syncPoolChart(poolId: string) {
    console.log(
      `Starting synchronization of historical data for pool ${poolId}...`
    );
    let successCount = 0;
    let errorCount = 0;
    let chartDataLength = 0;
    let filteredDataLength = 0;

    try {
      // Calculate date 7 days ago as cut-off
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      console.log(`Will only keep data after ${sevenDaysAgo.toISOString()}`);

      const chartData = await this.defiLlamaClient.getPoolChart(poolId);
      chartDataLength = chartData.length;

      if (chartDataLength === 0) {
        console.log(
          `No historical chart data for pool ${poolId}, skipping sync.`
        );
        return;
      }

      // Filter to keep only the last 7 days of data
      const recentChartData = chartData.filter(
        (point) => new Date(point.timestamp) >= sevenDaysAgo
      );
      filteredDataLength = recentChartData.length;

      console.log(
        `Fetched ${chartDataLength} historical data points, filtered to ${filteredDataLength} recent (last 7 days) data points.`
      );

      // Delete old data for this pool older than 7 days
      const deletedOldData = await prisma.poolChart.deleteMany({
        where: {
          poolId,
          timestamp: { lt: sevenDaysAgo },
        },
      });

      console.log(
        `Deleted ${deletedOldData.count} old data points (older than 7 days).`
      );

      // Batch process historical data
      const chartDataChunks = this.chunkArray(recentChartData, 100); // Smaller chunk for chart data
      console.log(
        `Processing ${filteredDataLength} recent historical data points in ${chartDataChunks.length} batches.`
      );

      for (let i = 0; i < chartDataChunks.length; i++) {
        const chunk = chartDataChunks[i];
        try {
          // Use batch create instead of one by one
          const createManyResult = await prisma.poolChart.createMany({
            data: chunk.map((point) => ({
              poolId,
              timestamp: new Date(point.timestamp),
              tvlUsd: point.tvlUsd,
              apy: point.apy,
              apyBase: point.apyBase,
              apyReward: point.apyReward,
            })),
            skipDuplicates: true, // Skip if a record with the same poolId and timestamp already exists
          });

          successCount += createManyResult.count;
        } catch (dbError) {
          errorCount += chunk.length;
          console.error(
            `Failed to write batch ${i + 1}/${
              chartDataChunks.length
            } of historical data for pool ${poolId}: `,
            dbError
          );
        }
      }

      if (errorCount > 0) {
        console.warn(
          `Historical data sync for pool ${poolId} partially completed: ${successCount} succeeded (from ${filteredDataLength} recent data points), ${errorCount} failed.`
        );
      } else {
        console.log(
          `Historical data sync for pool ${poolId} completed: ${successCount} data points synced (from ${filteredDataLength} recent data points).`
        );
      }

      try {
        // Save only recent 7 days data to Redis
        await redis.set(
          `defillama:poolchart:${poolId}`,
          JSON.stringify(recentChartData),
          { ex: 86400 } // Cache for 1 day
        );
        console.log(
          `Recent 7 days historical data for pool ${poolId} successfully updated in Redis cache.`
        );
      } catch (redisError) {
        console.error(
          `Failed to update Redis cache for historical data of pool ${poolId}:`,
          redisError
        );
      }
    } catch (error) {
      console.error(
        `Failed to sync historical data for pool ${poolId} (overall error):`,
        error
      );
      // Errors in syncPoolChart should not stop syncAll from processing other pools
    }
  }

  async syncAll() {
    console.log("--- Starting full data synchronization --- ");
    let protocolsSuccess = false;
    let poolsSuccess = false;
    let stablecoinsSuccess = false;

    // Sync protocol data
    try {
      await this.syncProtocols();
      protocolsSuccess = true;
    } catch (error) {
      console.error("Protocol data synchronization failed:", error);
      // Continue to next steps
    }

    // Sync pool data
    try {
      await this.syncPools();
      poolsSuccess = true;
    } catch (error) {
      console.error("Pool data synchronization failed:", error);
      // Continue to next steps
    }

    // Sync stablecoin data
    try {
      await this.syncStablecoins();
      stablecoinsSuccess = true;
    } catch (error) {
      console.error("Stablecoin data synchronization failed:", error);
      // Continue to next steps
    }

    if (poolsSuccess) {
      console.log("--- Starting historical data sync for priority pools --- ");
      let topPoolsToSync: { id: string }[] = [];
      try {
        topPoolsToSync = await prisma.pool.findMany({
          where: {
            tvlUsd: { gt: 1_000_000 }, // Pools with TVL > $1M
            apy: { gt: 5 }, // APY > 5%
          },
          orderBy: { apy: "desc" },
          take: 10, // Sync top 10 such pools
          select: { id: true },
        });
        console.log(
          `Planning to sync historical data for ${topPoolsToSync.length} priority pools.`
        );
      } catch (dbReadError) {
        console.error(
          "Failed to get list of priority pools for historical data sync:",
          dbReadError
        );
      }

      for (const pool of topPoolsToSync) {
        await this.syncPoolChart(pool.id);
      }
    } else {
      console.log(
        "Skipping historical data sync for priority pools because pool synchronization failed."
      );
    }

    // Output sync result summary
    console.log("--- Full data synchronization finished --- ");
    console.log(
      `Protocol Data Sync: ${protocolsSuccess ? "Success" : "Failed"}`
    );
    console.log(`Pool Data Sync: ${poolsSuccess ? "Success" : "Failed"}`);
    console.log(
      `Stablecoin Data Sync: ${stablecoinsSuccess ? "Success" : "Failed"}`
    );

    // If all major syncs failed, return an error status
    if (!protocolsSuccess && !poolsSuccess && !stablecoinsSuccess) {
      throw new Error("All major data synchronization tasks failed.");
    }
  }
}
