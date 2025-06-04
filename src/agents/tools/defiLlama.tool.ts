import { createTool } from "@mastra/core/tools";
import { prisma } from "../../lib/db/client";
import { redis } from "../../lib/kv/redisClient";
import { z } from "zod";

// Implementation functions
async function findHighYieldPoolsImpl(params: any) {
  // Set default parameters
  const chain = params.chain;
  const minTvlUsd = params.minTvlUsd || 10000;
  const minApy = params.minApy || 5;
  const limit = Math.min(params.limit || 10, 100);
  const stablecoinOnly = params.stablecoinOnly || false;

  // Try to fetch from cache
  const cacheKey = `defillama:high-yield-pools:${
    chain || "all"
  }:${minTvlUsd}:${minApy}:${limit}:${stablecoinOnly}`;
  const cached = await redis.get(cacheKey, true);

  if (cached) {
    // Return Redis auto-parsed data directly
    return cached;
  }

  // Build query
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

  // Execute query
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

  // Format results
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

  // Cache result for 2 hours
  await redis.set(cacheKey, JSON.stringify(result), { ex: 60 * 60 * 2 });

  return result;
}

async function searchProtocolsImpl(params: any) {
  const nameQuery = params.nameQuery;
  const category = params.category;
  const minTvl = params.minTvl || 0;
  const semanticQuery = params.semanticQuery;
  const limit = Math.min(params.limit || 10, 50);

  // If there is a semantic query
  if (semanticQuery) {
    // Vector search functionality has been removed, return an empty array here.
    // Can connect to a new RAG vector database in the future.
    console.warn(
      "[searchProtocolsImpl] Semantic search is currently disabled. Returning empty results."
    );
    return [];
  } else {
    // Normal search (based on name, category, TVL)
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

  // Try to fetch from cache
  const cacheKey = `defillama:poolchart:${poolId}`;
  const cached = await redis.get(cacheKey, true);

  if (cached) {
    // Return Redis auto-parsed data directly
    return cached;
  }

  // Fetch from database
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

  // Cache result for 1 hour
  await redis.set(cacheKey, JSON.stringify(chartData), { ex: 3600 });

  return chartData;
}

// High-yield pools query tool
export const findHighYieldPoolsTool = createTool({
  id: "findHighYieldPools",
  description:
    "Finds high-yield DeFi pools. Can be filtered by chain, minimum TVL, and minimum APY. Returns a list of pools sorted by APY in descending order, including project name, chain, token symbol, TVL, APY, etc.",
  inputSchema: z.object({
    chain: z
      .string()
      .optional()
      .describe(
        "Optional. Specify the blockchain, e.g., 'Ethereum', 'BSC', 'Arbitrum'."
      ),
    minTvlUsd: z
      .number()
      .optional()
      .describe("Optional. Minimum TVL (USD), defaults to 10000 ($10k)."),
    minApy: z
      .number()
      .optional()
      .describe("Optional. Minimum APY (%), defaults to 5."),
    limit: z
      .number()
      .optional()
      .describe(
        "Optional. Number of results to return, defaults to 10, max 100."
      ),
    stablecoinOnly: z
      .boolean()
      .optional()
      .describe(
        "Optional. Whether to return only stablecoin pools, defaults to false."
      ),
  }),
  execute: async ({ context }) => {
    return await findHighYieldPoolsImpl(context);
  },
});

// Export function for API calls
export const findHighYieldPools = findHighYieldPoolsImpl;

// Protocol search tool - for Mastra
export const searchProtocolsTool = createTool({
  id: "searchProtocols",
  description:
    "Searches DeFi protocols. Can be filtered by name, category, and minimum TVL. Semantic search is currently disabled; if semanticQuery is provided, it will return empty results.",
  inputSchema: z.object({
    nameQuery: z
      .string()
      .optional()
      .describe("Optional. Protocol name keyword."),
    category: z
      .string()
      .optional()
      .describe(
        "Optional. Protocol category, e.g., 'Lending', 'DEX', 'Yield'."
      ),
    minTvl: z
      .number()
      .optional()
      .describe("Optional. Minimum TVL (USD), defaults to 0."),
    semanticQuery: z
      .string()
      .optional()
      .describe(
        "Optional. Semantic search query (currently disabled, will return empty results if provided)."
      ),
    limit: z
      .number()
      .optional()
      .describe(
        "Optional. Number of results to return, defaults to 10, max 50."
      ),
  }),
  execute: async ({ context }) => {
    return await searchProtocolsImpl(context);
  },
});

// Export function for API calls
export const searchProtocols = searchProtocolsImpl;

// Pool historical data tool - for Mastra
export const getPoolHistoricalDataTool = createTool({
  id: "getPoolHistoricalData",
  description:
    "Gets historical data for a specified pool, including TVL and APY trends.",
  inputSchema: z.object({
    poolId: z.string().describe("The ID of the pool."),
  }),
  execute: async ({ context }) => {
    return await getPoolHistoricalDataImpl(context);
  },
});

// Export function for API calls
export const getPoolHistoricalData = getPoolHistoricalDataImpl;

// Export all tools for Mastra registration
export const defiLlamaTools = [
  findHighYieldPoolsTool,
  searchProtocolsTool,
  getPoolHistoricalDataTool,
];
