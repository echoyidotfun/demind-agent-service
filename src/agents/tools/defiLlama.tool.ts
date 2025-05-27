import { createTool } from "@mastra/core/tools";
import { prisma } from "../../lib/db/client";
import { redis } from "../../lib/kv/client";
import { z } from "zod";

// 实现业务逻辑的函数
async function findHighYieldPoolsImpl(params: any) {
  // 设置默认参数
  const chain = params.chain;
  const minTvlUsd = params.minTvlUsd || 10000;
  const minApy = params.minApy || 5;
  const limit = Math.min(params.limit || 10, 100);
  const stablecoinOnly = params.stablecoinOnly || false;

  // 尝试从缓存获取
  const cacheKey = `defillama:high-yield-pools:${
    chain || "all"
  }:${minTvlUsd}:${minApy}:${limit}:${stablecoinOnly}`;
  const cached = await redis.get(cacheKey, true);

  if (cached) {
    // 直接返回Redis自动解析的数据
    return cached;
  }

  // 构建查询
  const whereClause: any = {
    tvlUsd: { gt: minTvlUsd },
    apy: { gt: minApy },
  };

  if (chain) {
    whereClause.chain = chain;
  }

  if (stablecoinOnly) {
    whereClause.stablecoin = true;
  }

  // 执行查询
  const pools = await prisma.pool.findMany({
    where: whereClause,
    orderBy: { apy: "desc" },
    take: limit,
    include: {
      protocol: {
        select: {
          name: true,
          description: true,
          category: true,
        },
      },
    },
  });

  // 格式化结果
  const result = pools.map((pool) => ({
    id: pool.id,
    chain: pool.chain,
    project: pool.project,
    projectName: pool.protocol?.name,
    category: pool.protocol?.category,
    symbol: pool.symbol,
    tvlUsd: pool.tvlUsd,
    apy: pool.apy,
    apyBase: pool.apyBase,
    apyReward: pool.apyReward,
    stablecoin: pool.stablecoin,
    ilRisk: pool.ilRisk,
    exposure: pool.exposure,
  }));

  // 缓存结果 30 分钟
  await redis.set(cacheKey, JSON.stringify(result), { ex: 1800 });

  return result;
}

async function searchProtocolsImpl(params: any) {
  const nameQuery = params.nameQuery;
  const category = params.category;
  const minTvl = params.minTvl || 0;
  const semanticQuery = params.semanticQuery;
  const limit = Math.min(params.limit || 10, 50);

  // 如果有语义查询
  if (semanticQuery) {
    // 向量搜索功能已移除，此处返回空数组
    // 后续可以对接新的 RAG 向量数据库
    return [];
  } else {
    // 普通搜索（基于名称、类别、TVL）
    const whereClause: any = {
      tvl: { gte: minTvl },
    };

    if (category) {
      whereClause.category = category;
    }

    if (nameQuery) {
      whereClause.name = { contains: nameQuery, mode: "insensitive" };
    }

    const protocols = await prisma.protocol.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        category: true,
        tvl: true,
        change1d: true,
        change7d: true,
        chains: true,
      },
      orderBy: { tvl: "desc" },
      take: limit,
    });

    return protocols;
  }
}

async function getPoolHistoricalDataImpl(params: any) {
  const { poolId } = params;

  // 尝试从缓存获取
  const cacheKey = `defillama:poolchart:${poolId}`;
  const cached = await redis.get(cacheKey, true);

  if (cached) {
    // 直接返回Redis自动解析的数据
    return cached;
  }

  // 从数据库获取
  const chartData = await prisma.poolChart.findMany({
    where: { poolId },
    orderBy: { timestamp: "asc" },
    select: {
      timestamp: true,
      tvlUsd: true,
      apy: true,
      apyBase: true,
      apyReward: true,
    },
  });

  // 缓存结果 1 小时
  await redis.set(cacheKey, JSON.stringify(chartData), { ex: 3600 });

  return chartData;
}

// 高收益资金池查询工具 - 为Mastra提供
export const findHighYieldPoolsTool = createTool({
  id: "findHighYieldPools",
  description: `查找高收益的 DeFi 资金池，可以按链、最低 TVL、最低 APY 筛选。
  返回按 APY 降序排序的资金池列表，包括项目名称、链、代币符号、TVL、APY 等信息。`,
  inputSchema: z.object({
    chain: z
      .string()
      .optional()
      .describe('可选, 指定区块链，例如 "Ethereum", "BSC", "Arbitrum" 等'),
    minTvlUsd: z
      .number()
      .optional()
      .describe("可选, 最低 TVL（美元），默认为 10000 ($10k)"),
    minApy: z.number().optional().describe("可选, 最低 APY（%），默认为 5"),
    limit: z
      .number()
      .optional()
      .describe("可选, 返回的结果数量，默认为 10，最大为 100"),
    stablecoinOnly: z
      .boolean()
      .optional()
      .describe("可选, 是否只返回稳定币资金池，默认为 false"),
  }),
  execute: async ({ context }) => {
    return await findHighYieldPoolsImpl(context);
  },
});

// 为API调用导出函数
export const findHighYieldPools = findHighYieldPoolsImpl;

// 协议搜索工具 - 为Mastra提供
export const searchProtocolsTool = createTool({
  id: "searchProtocols",
  description: `搜索 DeFi 协议，可以按名称、类别、最低 TVL 筛选。
  语义搜索功能当前已禁用，若提供 semanticQuery，将返回空结果。`,
  inputSchema: z.object({
    nameQuery: z.string().optional().describe("可选，协议名称关键词"),
    category: z
      .string()
      .optional()
      .describe('可选，协议类别，如 "Lending", "DEX", "Yield" 等'),
    minTvl: z.number().optional().describe("可选，最低 TVL（美元），默认为 0"),
    semanticQuery: z
      .string()
      .optional()
      .describe("可选，语义搜索查询（当前已禁用，若提供将返回空结果）"),
    limit: z
      .number()
      .optional()
      .describe("可选，返回的结果数量，默认为 10，最大为 50"),
  }),
  execute: async ({ context }) => {
    return await searchProtocolsImpl(context);
  },
});

// 为API调用导出函数
export const searchProtocols = searchProtocolsImpl;

// 获取资金池历史数据工具 - 为Mastra提供
export const getPoolHistoricalDataTool = createTool({
  id: "getPoolHistoricalData",
  description: `获取指定资金池的历史数据，包括 TVL 和 APY 的变化趋势。`,
  inputSchema: z.object({
    poolId: z.string().describe("资金池 ID"),
  }),
  execute: async ({ context }) => {
    return await getPoolHistoricalDataImpl(context);
  },
});

// 为API调用导出函数
export const getPoolHistoricalData = getPoolHistoricalDataImpl;

// 导出所有工具，供Mastra注册使用
export const defiLlamaTools = [
  findHighYieldPoolsTool,
  searchProtocolsTool,
  getPoolHistoricalDataTool,
];
