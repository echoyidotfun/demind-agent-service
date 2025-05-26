import { prisma } from "../lib/db/client";
import { DeFiLlamaClient } from "../lib/apiClients/defiLlamaClient";
import { getEmbedding } from "../lib/embedding";
import { redis } from "../lib/kv/client";

export class DeFiLlamaSyncService {
  private defiLlamaClient: DeFiLlamaClient;

  constructor() {
    this.defiLlamaClient = new DeFiLlamaClient();
  }

  // 同步所有协议数据
  async syncProtocols() {
    console.log("开始同步 DeFi 协议数据...");

    try {
      const protocols = await this.defiLlamaClient.getProtocols();

      // 批量插入/更新协议数据
      for (const protocol of protocols) {
        // 为协议描述生成向量嵌入（用于 RAG）
        let descriptionVector = null;
        if (protocol.description) {
          descriptionVector = await getEmbedding(protocol.description);
        }

        await prisma.protocol.upsert({
          where: { id: protocol.id },
          update: {
            name: protocol.name,
            slug: protocol.slug,
            address: protocol.address,
            symbol: protocol.symbol,
            description: protocol.description,
            chain: protocol.chain,
            chains: protocol.chains,
            logo: protocol.logo,
            audits: protocol.audits,
            auditNote: protocol.audit_note,
            geckoId: protocol.gecko_id,
            cmcId: protocol.cmcId,
            category: protocol.category,
            tvl: protocol.tvl,
            change1h: protocol.change_1h,
            change1d: protocol.change_1d,
            change7d: protocol.change_7d,
            mcap: protocol.mcap,
            twitter: protocol.twitter,
            url: protocol.url,
            descriptionVector,
          },
          create: {
            id: protocol.id,
            name: protocol.name,
            slug: protocol.slug,
            address: protocol.address || "",
            symbol: protocol.symbol || "",
            description: protocol.description || "",
            chain: protocol.chain,
            chains: protocol.chains || [],
            logo: protocol.logo || "",
            audits: protocol.audits,
            auditNote: protocol.audit_note,
            geckoId: protocol.gecko_id,
            cmcId: protocol.cmcId,
            category: protocol.category,
            tvl: protocol.tvl,
            change1h: protocol.change_1h,
            change1d: protocol.change_1d,
            change7d: protocol.change_7d,
            mcap: protocol.mcap,
            twitter: protocol.twitter,
            url: protocol.url,
            descriptionVector,
          },
        });
      }

      // 更新缓存中的协议列表
      await redis.set(
        "defillama:protocols:list",
        JSON.stringify(
          protocols.map((p) => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
            tvl: p.tvl,
            category: p.category,
          }))
        ),
        { ex: 3600 }
      ); // 缓存 1 小时

      console.log(`成功同步 ${protocols.length} 个 DeFi 协议`);
    } catch (error) {
      console.error("同步 DeFi 协议数据失败:", error);
      throw error;
    }
  }

  // 同步所有资金池数据
  async syncPools() {
    console.log("开始同步资金池数据...");

    try {
      const pools = await this.defiLlamaClient.getPools();

      // 批量插入/更新池子数据
      for (const pool of pools) {
        await prisma.pool.upsert({
          where: { id: pool.pool },
          update: {
            chain: pool.chain,
            project: pool.project,
            symbol: pool.symbol,
            tvlUsd: pool.tvlUsd,
            apyBase: pool.apyBase,
            apyReward: pool.apyReward,
            apy: pool.apy,
            rewardTokens: pool.rewardTokens
              ? JSON.stringify(pool.rewardTokens)
              : null,
            stablecoin: pool.stablecoin,
            ilRisk: pool.ilRisk,
            exposure: pool.exposure,
            poolMeta: pool.poolMeta,
            underlyingTokens: pool.underlyingTokens
              ? JSON.stringify(pool.underlyingTokens)
              : null,
          },
          create: {
            id: pool.pool,
            chain: pool.chain,
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
            underlyingTokens: pool.underlyingTokens
              ? JSON.stringify(pool.underlyingTokens)
              : null,
          },
        });
      }

      // 缓存高收益的资金池列表，按 APY 降序排序
      const highYieldPools = pools
        .filter((p) => p.apy && p.apy > 0)
        .sort((a, b) => (b.apy || 0) - (a.apy || 0))
        .slice(0, 100)
        .map((p) => ({
          id: p.pool,
          chain: p.chain,
          project: p.project,
          symbol: p.symbol,
          tvlUsd: p.tvlUsd,
          apy: p.apy,
        }));

      await redis.set(
        "defillama:pools:high-yield",
        JSON.stringify(highYieldPools),
        { ex: 3600 }
      ); // 缓存 1 小时

      console.log(`成功同步 ${pools.length} 个资金池`);
    } catch (error) {
      console.error("同步资金池数据失败:", error);
      throw error;
    }
  }

  // 同步特定池子的历史数据
  async syncPoolChart(poolId: string) {
    console.log(`开始同步资金池 ${poolId} 的历史数据...`);

    try {
      const chartData = await this.defiLlamaClient.getPoolChart(poolId);

      // 首先删除旧数据，然后插入新数据
      await prisma.poolChart.deleteMany({
        where: { poolId },
      });

      for (const point of chartData) {
        await prisma.poolChart.create({
          data: {
            poolId,
            timestamp: new Date(point.timestamp),
            tvlUsd: point.tvlUsd,
            apy: point.apy,
            apyBase: point.apyBase,
            apyReward: point.apyReward,
          },
        });
      }

      // 缓存这个池子的历史数据
      await redis.set(
        `defillama:poolchart:${poolId}`,
        JSON.stringify(chartData),
        { ex: 86400 }
      ); // 缓存 24 小时

      console.log(`成功同步资金池 ${poolId} 的 ${chartData.length} 条历史数据`);
    } catch (error) {
      console.error(`同步资金池 ${poolId} 历史数据失败:`, error);
      throw error;
    }
  }

  // 同步稳定币数据
  async syncStablecoins() {
    console.log("开始同步稳定币数据...");

    try {
      const stablecoins = await this.defiLlamaClient.getStablecoins();

      // 批量插入/更新稳定币数据
      for (const coin of stablecoins) {
        await prisma.stablecoin.upsert({
          where: { id: coin.id },
          update: {
            name: coin.name,
            symbol: coin.symbol,
            geckoId: coin.gecko_id,
            pegType: coin.pegType,
            pegMechanism: coin.pegMechanism,
            circulating: coin.circulating?.peggedUSD || 0,
            price: coin.price,
            chains: coin.chains || [],
          },
          create: {
            id: coin.id,
            name: coin.name,
            symbol: coin.symbol,
            geckoId: coin.gecko_id,
            pegType: coin.pegType,
            pegMechanism: coin.pegMechanism,
            circulating: coin.circulating?.peggedUSD || 0,
            price: coin.price,
            chains: coin.chains || [],
          },
        });
      }

      // 缓存稳定币列表
      await redis.set(
        "defillama:stablecoins:list",
        JSON.stringify(
          stablecoins.map((c) => ({
            id: c.id,
            name: c.name,
            symbol: c.symbol,
            circulating: c.circulating?.peggedUSD,
            price: c.price,
          }))
        ),
        { ex: 3600 }
      ); // 缓存 1 小时

      console.log(`成功同步 ${stablecoins.length} 个稳定币`);
    } catch (error) {
      console.error("同步稳定币数据失败:", error);
      throw error;
    }
  }

  // 执行完整同步
  async syncAll() {
    await this.syncProtocols();
    await this.syncPools();
    await this.syncStablecoins();

    // 对于大量的资金池历史数据，我们可能不想一次性全部同步
    // 可以考虑只同步高收益或高 TVL 的资金池历史数据
    const topPools = await prisma.pool.findMany({
      where: {
        tvlUsd: { gt: 1000000 }, // TVL > $1M
        apy: { gt: 5 }, // APY > 5%
      },
      orderBy: { apy: "desc" },
      take: 50,
    });

    for (const pool of topPools) {
      await this.syncPoolChart(pool.id);
    }

    console.log("完整数据同步完成");
  }
}
