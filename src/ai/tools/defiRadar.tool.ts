import { createTool } from "@mastra/core/tools";
import { prisma } from "../../lib/db/prismaClient";
import { z } from "zod";
import { CoinGeckoService } from "../../services/coingeckoSync.service";
import { Decimal } from "@prisma/client/runtime/library";

const coinGeckoService = new CoinGeckoService();

const defiLlamaToCoinGeckoChainMap: Record<string, string> = {
  arbitrum: "arbitrum-one",
  bsc: "binance-smart-chain",
  optimism: "optimistic-ethereum",
  manta: "manta-pacific",
};

const coinGeckoToDefiLlamaChainMap: Record<string, string> = {
  "arbitrum-one": "arbitrum",
  "binance-smart-chain": "bsc",
  "optimistic-ethereum": "optimism",
  "manta-pacific": "manta",
};

/**
 * 将DeFiLlama链名转换为CoinGecko链名
 * @param defiLlamaChain DeFiLlama链名
 * @returns CoinGecko链名
 */
function mapDefiLlamaToCoinGeckoChain(defiLlamaChain: string): string {
  return defiLlamaToCoinGeckoChainMap[defiLlamaChain] || defiLlamaChain;
}

/**
 * 将CoinGecko链名转换为DeFiLlama链名
 * @param coinGeckoChain CoinGecko链名
 * @returns DeFiLlama链名
 */
function mapCoinGeckoToDefiLlamaChain(coinGeckoChain: string): string {
  return coinGeckoToDefiLlamaChainMap[coinGeckoChain] || coinGeckoChain;
}

// 定义标准化的接口结构
interface OutputSchemaUnderlyingToken {
  cgId: string;
  chain: string;
  address: string;
}

interface OutputSchemaPool {
  id: string;
  chain: string;
  project: string;
  protocol: string;
  symbol: string;
  tvlUsd: number;
  apyBase: number | null;
  apyReward: number | null;
  apy: number;
  apyPct1D: number | null;
  apyPct7D: number | null; // 修改为允许 null
  stablecoin: boolean;
  ilRisk: string;
  volume1D: number | null;
  underlyingTokens: OutputSchemaUnderlyingToken[];
  exposure: string;
  relatedTrending?: string[]; // 添加可选的相关热门代币字段
}

interface OutputSchemaProtocol {
  id: string;
  name: string;
  url: string | null;
  description: string | null;
  chains: string[];
  logo: string | null;
  audits: string | null;
  category: string | null;
  twitter: string | null;
  github: string | null;
  tvl: number | null;
  change1d: number | null;
  change7d: number | null;
  listedAt: Date | null;
}

interface OutputSchemaToken {
  cgId: string;
  name: string;
  symbol: string;
  description: string | null;
  imageUrl: string | null;
  categories: string[];
  homepage: string | null;
  whitepaperUrl: string | null;
  twitter: string | null;
  telegram: string | null;
  github: string | null;
  sentimentVotesUpPercentage: number;
  watchlistPortfolioUsers: number;
  marketCapRank: number | null;
  currentPrice: Decimal | null;
  marketCap: Decimal | null;
  fullyDilutedValuation: Decimal | null;
  ath: Decimal | null;
  atl: Decimal | null;
  circulatingSupply: Decimal | null;
  totalSupply: Decimal | null;
  maxSupply: Decimal | null;
  priceChangePercentage24h: Decimal | null;
  priceChangePercentage7d: Decimal | null;
  priceChangePercentage14d: Decimal | null;
  priceChangePercentage30d: Decimal | null;
}

interface OutputSchemaTrending {
  cgId: string; // 修正字段名
  name: string;
  symbol: string;
  marketCapRank: number | null;
  relatedPoolsCount?: number;
  relatedPoolIds?: string[];
}

interface OutputSchemaResult {
  trending?: OutputSchemaTrending[];
  pools: OutputSchemaPool[];
  protocols: Record<string, OutputSchemaProtocol>;
  tokens: Record<string, OutputSchemaToken>;
  error?: string;
  details?: string;
  message?: string;
}

// Define Zod schemas for output validation
const underlyingTokenSchema = z.object({
  cgId: z.string().describe("CoinGecko ID of the token"),
  chain: z.string().describe("Blockchain where the token exists"),
  address: z.string().describe("Contract address of the token"),
});

const poolSchema = z.object({
  id: z.string().describe("Unique identifier of the pool"),
  chain: z.string().describe("Blockchain where the pool exists"),
  project: z.string().describe("Project name"),
  protocol: z.string().describe("Protocol ID this pool belongs to"),
  symbol: z.string().describe("Token symbol or LP token symbol"),
  tvlUsd: z.number().describe("Total Value Locked in USD"),
  apyBase: z.number().nullable().describe("Base APY percentage"),
  apyReward: z.number().nullable().describe("Reward APY percentage"),
  apy: z.number().describe("Total APY percentage"),
  apyPct1D: z.number().nullable().describe("1-day APY percentage change"),
  apyPct7D: z.number().nullable().describe("7-day APY percentage change"),
  stablecoin: z
    .boolean()
    .describe("Whether this pool contains only stablecoins"),
  ilRisk: z.string().describe("Impermanent loss risk category"),
  volumeUsd1d: z.number().nullable().describe("24-hour trading volume in USD"),
  underlyingTokens: z
    .array(underlyingTokenSchema)
    .describe("Tokens in this pool"),
  exposure: z.string().describe("Exposure category"),
  relatedTrending: z
    .array(z.string())
    .optional()
    .describe("Related trending token IDs"),
});

const protocolSchema = z.object({
  id: z.string().describe("Unique identifier of the protocol"),
  name: z.string().describe("Protocol name"),
  url: z.string().nullable().describe("Protocol website URL"),
  description: z.string().nullable().describe("Protocol description"),
  chains: z.array(z.string()).describe("Blockchains supported by the protocol"),
  logo: z.string().nullable().describe("URL to protocol logo"),
  audits: z.string().nullable().describe("Audit information"),
  category: z.string().nullable().describe("Protocol category"),
  twitter: z.string().nullable().describe("Protocol Twitter handle"),
  github: z.string().nullable().describe("Protocol GitHub URL"),
  tvl: z.number().nullable().describe("Total Value Locked across all pools"),
  change1d: z.number().nullable().describe("1-day TVL change"),
  change7d: z.number().nullable().describe("7-day TVL change"),
  listedAt: z
    .string()
    .nullable()
    .describe("Date when the protocol was listed on DeFiLlama"),
});

const tokenSchema = z.object({
  cgId: z.string().describe("CoinGecko ID"),
  name: z.string().describe("Token name"),
  symbol: z.string().describe("Token symbol"),
  description: z.string().nullable().describe("Token description"),
  imageUrl: z.string().nullable().describe("Token logo URL"),
  categories: z.array(z.string()).describe("Token categories"),
  homepage: z.string().nullable().describe("Token homepage URL"),
  whitepaperUrl: z.string().nullable().describe("Token whitepaper URL"),
  twitter: z.string().nullable().describe("Token Twitter handle"),
  telegram: z.string().nullable().describe("Token Telegram channel"),
  github: z.string().nullable().describe("Token GitHub repositories"),
  sentimentVotesUpPercentage: z
    .number()
    .nullable()
    .describe("Sentiment votes up percentage"),
  watchlistPortfolioUsers: z
    .number()
    .nullable()
    .describe("Watchlist portfolio users"),
  marketCapRank: z.number().nullable().describe("Market cap rank"),
  currentPrice: z.any().nullable().describe("Current price in USD"),
  marketCap: z.any().nullable().describe("Market capitalization in USD"),
  fullyDilutedValuation: z.any().nullable().describe("Fully diluted valuation"),
  ath: z.any().nullable().describe("All-time high price"),
  atl: z.any().nullable().describe("All-time low price"),
  circulatingSupply: z.any().nullable().describe("Circulating supply"),
  totalSupply: z.any().nullable().describe("Total supply"),
  maxSupply: z.any().nullable().describe("Maximum supply"),
  priceChangePercentage24h: z
    .any()
    .nullable()
    .describe("24-hour price change percentage"),
  priceChangePercentage7d: z
    .any()
    .nullable()
    .describe("7-day price change percentage"),
});

const trendingSchema = z.object({
  cgId: z.string().describe("CoinGecko ID"),
  name: z.string().describe("Token name"),
  symbol: z.string().describe("Token symbol"),
  marketCapRank: z.number().nullable().describe("Market cap rank"),
  relatedPoolsCount: z
    .number()
    .optional()
    .describe("Number of pools related to this trending token"),
  relatedPoolIds: z
    .array(z.string())
    .optional()
    .describe("IDs of pools related to this trending token"),
});

export const defiRadarToolOutputSchema = z.object({
  trending: z
    .array(trendingSchema)
    .optional()
    .describe("List of trending tokens"),
  pools: z
    .array(poolSchema)
    .describe("List of DeFi pools related to trending tokens"),
  protocols: z
    .record(z.string(), protocolSchema)
    .describe("Protocol data keyed by protocol ID"),
  tokens: z
    .record(z.string(), tokenSchema)
    .describe("Token data keyed by CoinGecko ID"),
  error: z.string().nullable().describe("Error message if any"),
  details: z.string().nullable().describe("Additional error details"),
  message: z.string().nullable().describe("Informational message"),
});

// 辅助函数 - 构建池子查询条件
function buildPoolQueryConditions({
  chain,
  minTvlUsd,
  minApy,
  stablecoinOnly = false,
}: {
  chain?: string;
  minTvlUsd: number;
  minApy: number;
  stablecoinOnly?: boolean;
}): any {
  const whereClause: any = {
    tvlUsd: { gt: minTvlUsd },
    apy: { gt: minApy },
  };

  if (chain) {
    const dlChain = mapCoinGeckoToDefiLlamaChain(chain);
    // console.log(`Chain param mapping: ${chain} -> ${dlChain}`);
    whereClause.chain = dlChain;
  }

  if (stablecoinOnly) {
    whereClause.stablecoin = true;
  }

  return whereClause;
}

// 辅助函数 - 收集代币信息
async function collectTokenInfo(
  tokenAddressMap: Map<string, { chain: string; address: string }>
) {
  // 准备存储结果的Map
  const cgIdToAddressMap = new Map<string, string>();
  const addressToCgIdMap = new Map<string, string>();
  const tokens: Record<string, OutputSchemaToken> = {};

  // 将大批量查询拆分为小批次处理，避免过多并发请求
  const batchSize = 5;
  const entries = Array.from(tokenAddressMap.entries());
  const batches = [];

  for (let i = 0; i < entries.length; i += batchSize) {
    batches.push(entries.slice(i, i + batchSize));
  }

  // 记录各链上的代币数量
  const chainCounts = new Map<string, number>();
  for (const [_, token] of entries) {
    chainCounts.set(token.chain, (chainCounts.get(token.chain) || 0) + 1);
  }

  // 按批次处理代币
  for (const [batchIndex, batch] of batches.entries()) {
    console.log(`Processing token batch ${batchIndex + 1}/${batches.length}`);

    // 1. 查询批次中代币的基本信息
    const tokenInfoPromises = batch.map(async ([key, token]) => {
      try {
        const retries = 2;
        let basicInfo = null;

        // 添加重试逻辑
        for (
          let attempt = 0;
          attempt < retries && !basicInfo?.cgId;
          attempt++
        ) {
          if (attempt > 0) {
            // console.log(`Retry ${attempt} for ${token.chain}:${token.address}`);
            await new Promise((resolve) => setTimeout(resolve, 1000)); // 延迟1秒
          }

          // 将DeFiLlama链名转换为CoinGecko链名
          const cgChain = mapDefiLlamaToCoinGeckoChain(token.chain);
          // console.log(`Chain mapping: ${token.chain} -> ${cgChain}`);

          basicInfo = await coinGeckoService.findCgInfoByPlatformContract(
            cgChain,
            token.address
          );
        }

        if (basicInfo && basicInfo.cgId) {
          return {
            key,
            cgId: basicInfo.cgId,
          };
        }
        return { key, cgId: null };
      } catch (error) {
        console.error(
          `Error finding CG info for ${token.chain}:${token.address}`,
          error
        );
        return { key, cgId: null };
      }
    });

    const tokenInfoResults = await Promise.all(tokenInfoPromises);

    // 2. 构建批次中的映射关系
    const batchCgIds = new Set<string>();

    tokenInfoResults.forEach((result) => {
      if (result.cgId) {
        cgIdToAddressMap.set(result.cgId, result.key);
        addressToCgIdMap.set(result.key, result.cgId);
        batchCgIds.add(result.cgId);
      }
    });

    // 3. 查询批次中代币详细信息
    const uniqueCgIds = Array.from(batchCgIds);

    if (uniqueCgIds.length > 0) {
      const tokenDetailsPromises = uniqueCgIds.map(async (cgId) => {
        try {
          const retries = 2;
          let details = null;

          // 添加重试逻辑
          for (let attempt = 0; attempt < retries && !details; attempt++) {
            if (attempt > 0) {
              console.log(`Retry ${attempt} for details of ${cgId}`);
              await new Promise((resolve) => setTimeout(resolve, 1000)); // 延迟1秒
            }

            details = await coinGeckoService.getCoinDetailsAndStore(cgId);
          }

          if (details) {
            return { cgId, details };
          }
          return { cgId, details: null };
        } catch (error) {
          console.error(`Error fetching details for token ${cgId}`, error);
          return { cgId, details: null };
        }
      });

      const tokenDetailsResults = await Promise.all(tokenDetailsPromises);

      // 4. 整理批次中代币信息
      tokenDetailsResults.forEach(({ cgId, details }) => {
        if (details) {
          // 防止Decimal类型序列化问题，将所有Decimal显式转换为Number或String
          const safeValue = (val: any) => {
            if (val === null || val === undefined) return null;
            // 如果是Decimal类型（有toNumber方法），转换为Number
            if (
              val &&
              typeof val === "object" &&
              typeof val.toNumber === "function"
            ) {
              try {
                return val.toNumber();
              } catch (e) {
                return null;
              }
            }
            // 如果是其他对象类型，尝试转换为字符串
            if (val && typeof val === "object") {
              try {
                return String(val);
              } catch (e) {
                return null;
              }
            }
            return val;
          };

          tokens[cgId] = {
            cgId: details.cgId,
            name: details.name,
            symbol: details.symbol,
            description: details.descriptionEn,
            imageUrl: details.imageLargeUrl,
            categories: details.categories as string[],
            homepage: details.linksHomepage,
            whitepaperUrl: details.linksWhitepaperUrl,
            twitter: details.linksTwitterScreenName,
            telegram: details.linksTelegramChannelId,
            github: details.linksGithubRepos,
            sentimentVotesUpPercentage: details.sentimentVotesUpPercentage || 0,
            watchlistPortfolioUsers: details.watchlistPortfolioUsers || 0,
            marketCapRank: details.marketCapRank,
            currentPrice: safeValue(details.currentPriceUsd),
            marketCap: safeValue(details.marketCapUsd),
            fullyDilutedValuation: safeValue(details.fullyDilutedValuationUsd),
            ath: safeValue(details.athUsd),
            atl: safeValue(details.atlUsd),
            circulatingSupply: safeValue(details.circulatingSupply),
            totalSupply: safeValue(details.totalSupply),
            maxSupply: safeValue(details.maxSupply),
            priceChangePercentage24h: safeValue(
              details.priceChangePercentage24hUsd
            ),
            priceChangePercentage7d: safeValue(
              details.priceChangePercentage7dUsd
            ),
            priceChangePercentage14d: safeValue(
              details.priceChangePercentage14dUsd
            ),
            priceChangePercentage30d: safeValue(
              details.priceChangePercentage30dUsd
            ),
          };
        }
      });

      // 允许在批次之间短暂暂停，避免API速率限制
      if (batchIndex < batches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500)); // 延迟500ms
      }
    }
  }

  return {
    cgIdToAddressMap,
    addressToCgIdMap,
    tokens,
  };
}

// 辅助函数 - 格式化池子数据
function formatPoolData(
  pool: any,
  addressToCgIdMap: Map<string, string>
): OutputSchemaPool | null {
  // 处理底层代币
  const underlyingTokens: OutputSchemaUnderlyingToken[] = (
    pool.poolTokens || []
  )
    .map((token: { chain: string; tokenAddress: string }) => {
      const key = `${token.chain}:${token.tokenAddress}`;
      const cgId = addressToCgIdMap.get(key);

      return cgId
        ? {
            cgId,
            chain: token.chain, // 保持DeFiLlama格式的链名
            address: token.tokenAddress,
          }
        : null;
    })
    .filter(
      (
        token: OutputSchemaUnderlyingToken | null
      ): token is OutputSchemaUnderlyingToken => token !== null
    );

  // 新增逻辑：如果有任何一个poolToken无法匹配到cgid，则返回null
  if (!pool.poolTokens || underlyingTokens.length !== pool.poolTokens.length) {
    return null;
  }

  return {
    id: pool.id,
    chain: pool.chain,
    project: pool.project,
    protocol: pool.protocol?.id || "",
    symbol: pool.symbol,
    tvlUsd: pool.tvlUsd,
    apyBase: pool.apyBase,
    apyReward: pool.apyReward,
    apy: pool.apy,
    apyPct1D: pool.apyPct1D,
    apyPct7D: pool.apyPct7D,
    stablecoin: pool.stablecoin,
    ilRisk: pool.ilRisk,
    volume1D: pool.volumeUsd1d,
    underlyingTokens,
    exposure: pool.exposure,
  };
}

// 辅助函数 - 清理未使用的协议和代币
function sanitizeResults(
  result: OutputSchemaResult,
  usedProtocolIds: Set<string>,
  usedTokenIds: Set<string>
): void {
  // 过滤掉未使用的协议和代币
  Object.keys(result.protocols).forEach((protocolId) => {
    if (!usedProtocolIds.has(protocolId)) {
      delete result.protocols[protocolId];
    }
  });

  Object.keys(result.tokens).forEach((tokenId) => {
    if (!usedTokenIds.has(tokenId)) {
      delete result.tokens[tokenId];
    }
  });
}

// 辅助函数 - 创建错误响应
function createErrorResponse(
  errorType: string,
  errorDetails: any
): OutputSchemaResult {
  const errorMessages: Record<string, string> = {
    investment: "Error querying DeFi investment opportunities",
    trending: "Error querying trending token pools",
    noContracts: "No blockchain contract addresses found for trending tokens",
    noTrending: "Failed to retrieve trending token information",
  };

  return {
    pools: [],
    protocols: {},
    tokens: {},
    error: errorMessages[errorType] || "Unknown error",
    details:
      errorDetails instanceof Error
        ? errorDetails.message
        : String(errorDetails),
  };
}

export const findDefiInvestmentOpportunitiesTool = createTool({
  id: "Find DeFi Investment Opportunities",
  description:
    "Searches for DeFi liquidity pools and automatically retrieves comprehensive analysis information about the pools, protocols, and tokens. Filters high-quality investment opportunities by blockchain, minimum TVL, minimum APY, and other parameters. Returns detailed pool information, protocol data, and token analysis.",
  inputSchema: z.object({
    chain: z
      .string()
      .optional()
      .describe("Blockchain ID, e.g. 'ethereum', 'arbitrum'"),
    minTvlUsd: z
      .number()
      .optional()
      .describe("Minimum TVL in USD, defaults to 10000"),
    minApy: z
      .number()
      .optional()
      .describe("Minimum APY percentage, defaults to 5"),
    stablecoinOnly: z
      .boolean()
      .optional()
      .describe("Whether to only find stablecoin pools, defaults to false"),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Number of results to return, defaults to 10, maximum 50"),
  }),
  outputSchema: defiRadarToolOutputSchema,
  execute: async ({ context }) => {
    const {
      chain,
      minTvlUsd = 10000,
      minApy = 5,
      stablecoinOnly = false,
      limit = 10,
    } = context;
    const maxLimit = Math.min(limit, 50);

    try {
      console.log(
        `[Find DeFi Investment Opportunities] Searching for pools with params: ${JSON.stringify(
          context
        )}`
      );

      // 1. 构建查询条件并查询符合条件的资金池
      const whereClause = buildPoolQueryConditions({
        chain,
        minTvlUsd,
        minApy,
        stablecoinOnly,
      });

      // 获取资金池数据
      const pools = await prisma.pool.findMany({
        where: whereClause,
        orderBy: [{ apy: "desc" }, { tvlUsd: "desc" }],
        take: maxLimit * 2,
        include: {
          protocol: {
            select: {
              id: true,
              name: true,
              url: true,
              description: true,
              chains: true,
              logo: true,
              audits: true,
              category: true,
              twitter: true,
              github: true,
              tvl: true,
              change1d: true,
              change7d: true,
              listedAt: true,
            },
          },
          poolTokens: {
            select: {
              tokenAddress: true,
              chain: true,
            },
          },
        },
      });

      console.log(
        `[Find DeFi Investment Opportunities] Found ${pools.length} pools matching criteria`
      );

      // 准备输出结构
      const result: OutputSchemaResult = {
        pools: [],
        protocols: {},
        tokens: {},
      };

      // 2. 收集唯一协议和代币地址
      const tokenAddressMap = new Map<
        string,
        { chain: string; address: string }
      >();

      // 收集协议信息
      pools.forEach((pool) => {
        if (pool.protocol && !result.protocols[pool.protocol.id]) {
          result.protocols[pool.protocol.id] = {
            id: pool.protocol.id,
            name: pool.protocol.name,
            url: pool.protocol.url,
            description: pool.protocol.description,
            chains: pool.protocol.chains,
            logo: pool.protocol.logo,
            audits: pool.protocol.audits,
            category: pool.protocol.category,
            twitter: pool.protocol.twitter,
            github: pool.protocol.github,
            tvl: pool.protocol.tvl,
            change1d: pool.protocol.change1d,
            change7d: pool.protocol.change7d,
            listedAt: pool.protocol.listedAt,
          };
        }

        // 收集代币地址
        if (pool.poolTokens) {
          for (const token of pool.poolTokens) {
            const key = `${token.chain}:${token.tokenAddress}`;
            if (!tokenAddressMap.has(key)) {
              tokenAddressMap.set(key, {
                chain: token.chain,
                address: token.tokenAddress,
              });
            }
          }
        }
      });

      // 3. 查询代币信息
      try {
        const { addressToCgIdMap, tokens } = await collectTokenInfo(
          tokenAddressMap
        );
        result.tokens = tokens;

        // 4. 最终整理池子信息
        const formattedPools: OutputSchemaPool[] = pools
          .map((pool) => formatPoolData(pool, addressToCgIdMap))
          .filter((pool): pool is OutputSchemaPool => pool !== null)
          .slice(0, maxLimit); // 只保留limit条
        result.pools = formattedPools;

        // 5. 清理掉没有关联池子的协议和代币
        const usedProtocolIds = new Set(
          result.pools.map((p) => p.protocol).filter(Boolean)
        );
        const usedTokenIds = new Set<string>();

        result.pools.forEach((pool) => {
          pool.underlyingTokens.forEach((token) => {
            if (token && token.cgId) {
              usedTokenIds.add(token.cgId);
            }
          });
        });

        // 清理未使用的协议和代币
        sanitizeResults(result, usedProtocolIds, usedTokenIds);
      } catch (tokenError) {
        console.error(
          "[Find DeFi Investment Opportunities] Token data error:",
          tokenError
        );
        // 即使无法获取代币详情，也返回基本的池子和协议信息
        result.pools = pools.map((pool) => ({
          id: pool.id,
          chain: pool.chain,
          project: pool.project,
          protocol: pool.protocol?.id || "",
          symbol: pool.symbol,
          tvlUsd: pool.tvlUsd,
          apyBase: pool.apyBase,
          apyReward: pool.apyReward,
          apy: pool.apy,
          apyPct1D: pool.apyPct1D,
          apyPct7D: pool.apyPct7D,
          stablecoin: pool.stablecoin,
          ilRisk: pool.ilRisk,
          volume1D: pool.volumeUsd1d,
          underlyingTokens: [],
          exposure: pool.exposure,
        }));

        // 添加错误信息
        result.message =
          "Some token data could not be retrieved. Displaying limited information.";
      }

      console.log(
        `[Find DeFi Investment Opportunities] Final result contains ${
          result.pools.length
        } pools, ${Object.keys(result.protocols).length} protocols, ${
          Object.keys(result.tokens).length
        } tokens`
      );

      // 确保数据可以被序列化
      return JSON.parse(JSON.stringify(result));
    } catch (error) {
      console.error("[Find DeFi Investment Opportunities] Error:", error);
      return createErrorResponse("investment", error);
    }
  },
});

export const findTrendingTokenPoolsTool = createTool({
  id: "Find Trending Token Pools",
  description:
    "Discovers DeFi liquidity pools related to currently trending tokens on CoinGecko and provides comprehensive analysis. Automatically fetches trending tokens, associated pools, and detailed analytics to help identify investment opportunities based on market trends and popularity.",
  inputSchema: z.object({
    minTvlUsd: z
      .number()
      .optional()
      .describe("Minimum TVL in USD, defaults to 10000"),
    minApy: z
      .number()
      .optional()
      .describe("Minimum APY percentage, defaults to 5"),
    limit: z
      .number()
      .optional()
      .default(5)
      .describe(
        "Number of pools to return per trending token, defaults to 5, maximum 10"
      ),
  }),
  outputSchema: defiRadarToolOutputSchema,
  execute: async ({ context }) => {
    const { minTvlUsd = 10000, minApy = 5, limit = 5 } = context;
    const maxLimit = Math.min(limit, 10);

    try {
      console.log(
        `[Find Trending Token Pools] Starting with params: ${JSON.stringify(
          context
        )}`
      );

      // 1. 获取热门代币
      let trendingCoins = await coinGeckoService.getTrendingCoinsFromCache();
      if (!trendingCoins || trendingCoins.length === 0) {
        console.log("Trending tokens cache miss, syncing from API...");
        try {
          trendingCoins =
            await coinGeckoService.syncTrendingCoinsCacheAndDetails();
        } catch (syncError) {
          console.error("Error syncing trending coins:", syncError);
          // 尝试直接从API获取热门代币，不写入数据库
          trendingCoins =
            await coinGeckoService.coingeckoClient.getTrendingCoins();
        }
      }

      if (!trendingCoins || trendingCoins.length === 0) {
        return createErrorResponse("noTrending", "No trending tokens found");
      }

      console.log(
        `[Find Trending Token Pools] Found ${trendingCoins.length} trending coins`
      );

      // 准备输出结构
      const result: OutputSchemaResult = {
        trending: [],
        pools: [],
        protocols: {},
        tokens: {},
      };

      // 保存热门代币信息
      result.trending = trendingCoins
        .map((coin) => ({
          cgId: coin.id,
          name: coin.name,
          symbol: coin.symbol,
          marketCapRank: coin.market_cap_rank,
        }))
        .filter((coin) => coin.cgId !== null);

      // 2. 获取热门代币的合约地址
      const trendingCgIds = result.trending.map((coin) => coin.cgId);

      const platformInfoPromises = trendingCgIds.map((cgId) =>
        coinGeckoService.getCoinPlatformsByCgId(cgId)
      );

      const platformInfoResults = await Promise.allSettled(
        platformInfoPromises
      );

      // 收集所有合约地址
      const contractAddresses: {
        cgId: string;
        chain: string;
        address: string;
      }[] = [];

      platformInfoResults.forEach((result, index) => {
        if (
          result.status === "fulfilled" &&
          result.value &&
          result.value.length > 0
        ) {
          const cgId = trendingCgIds[index];
          result.value.forEach((platform) => {
            const dlChain = mapCoinGeckoToDefiLlamaChain(platform.blockchainId);
            // console.log(
            //   `Chain mapping: ${platform.blockchainId} -> ${dlChain}`
            // );

            contractAddresses.push({
              cgId,
              chain: dlChain, // 使用转换后的DeFiLlama链名
              address: platform.contractAddress.toLowerCase(),
            });
          });
        }
      });

      console.log(
        `[Find Trending Token Pools] Found ${contractAddresses.length} contract addresses for trending tokens`
      );

      if (contractAddresses.length === 0) {
        return {
          trending: result.trending,
          pools: [],
          protocols: {},
          tokens: {},
          message: "No blockchain contract addresses found for trending tokens",
          details: "Unable to query related pools",
        };
      }

      try {
        // 3. 查找包含这些合约地址的资金池
        // 用于存储池子、协议、代币信息的映射
        const poolDataMap = new Map<string, any>();
        const protocolDataMap = new Map<string, OutputSchemaProtocol>();
        const trendingTokenAddressMap = new Map<
          string,
          { chain: string; address: string }
        >();
        const poolsSet = new Set<string>();
        const cgIdPoolsMap = new Map<string, OutputSchemaPool[]>();

        for (const contract of contractAddresses) {
          const poolTokens = await prisma.poolToken.findMany({
            where: {
              chain: contract.chain,
              tokenAddress: contract.address,
            },
            take: 2,
            include: {
              pool: {
                include: {
                  protocol: {
                    select: {
                      id: true,
                      name: true,
                      url: true,
                      description: true,
                      chains: true,
                      logo: true,
                      audits: true,
                      category: true,
                      twitter: true,
                      github: true,
                      tvl: true,
                      change1d: true,
                      change7d: true,
                      listedAt: true,
                    },
                  },
                  poolTokens: {
                    select: {
                      tokenAddress: true,
                      chain: true,
                    },
                  },
                },
              },
            },
          });

          // 过滤符合TVL和APY条件的池子
          const validPools = poolTokens
            .filter(
              (pt) =>
                pt.pool &&
                pt.pool.tvlUsd > minTvlUsd &&
                (pt.pool.apy || 0) > minApy
            )
            .map((pt) => {
              const pool = pt.pool;
              if (!pool) return null;

              // 存储pool数据以便后续使用
              poolDataMap.set(pool.id, pool);

              // 存储protocol数据
              if (pool.protocol) {
                protocolDataMap.set(pool.protocol.id, {
                  id: pool.protocol.id,
                  name: pool.protocol.name,
                  url: pool.protocol.url,
                  description: pool.protocol.description,
                  chains: pool.protocol.chains,
                  logo: pool.protocol.logo,
                  audits: pool.protocol.audits,
                  category: pool.protocol.category,
                  twitter: pool.protocol.twitter,
                  github: pool.protocol.github,
                  tvl: pool.protocol.tvl,
                  change1d: pool.protocol.change1d,
                  change7d: pool.protocol.change7d,
                  listedAt: pool.protocol.listedAt,
                });
              }

              // 存储token地址信息
              if (pool.poolTokens) {
                for (const token of pool.poolTokens) {
                  const key = `${token.chain}:${token.tokenAddress}`;
                  if (!trendingTokenAddressMap.has(key)) {
                    trendingTokenAddressMap.set(key, {
                      chain: token.chain,
                      address: token.tokenAddress,
                    });
                  }
                }
              }

              return pool;
            })
            .filter((pool): pool is NonNullable<typeof pool> => !!pool);

          if (validPools.length > 0) {
            if (!cgIdPoolsMap.has(contract.cgId)) {
              cgIdPoolsMap.set(contract.cgId, []);
            }

            for (const pool of validPools) {
              if (!poolsSet.has(pool.id)) {
                poolsSet.add(pool.id);
                // 创建标准化的Pool对象
                const standardPool: OutputSchemaPool = {
                  id: pool.id,
                  chain: pool.chain,
                  project: pool.project,
                  protocol: pool.protocol?.id || "",
                  symbol: pool.symbol,
                  tvlUsd: pool.tvlUsd,
                  apyBase: pool.apyBase,
                  apyReward: pool.apyReward,
                  apy: pool.apy,
                  apyPct1D: pool.apyPct1D,
                  apyPct7D: pool.apyPct7D,
                  stablecoin: pool.stablecoin,
                  ilRisk: pool.ilRisk,
                  volume1D: pool.volumeUsd1d,
                  underlyingTokens: [],
                  exposure: pool.exposure,
                  relatedTrending: [contract.cgId], // 记录相关的热门代币
                };
                cgIdPoolsMap.get(contract.cgId)?.push(standardPool);
              } else {
                // 如果池子已存在，添加相关的热门代币ID
                for (const poolArr of cgIdPoolsMap.values()) {
                  const existingPool = poolArr.find((p) => p.id === pool.id);
                  if (
                    existingPool &&
                    !existingPool.relatedTrending?.includes(contract.cgId)
                  ) {
                    existingPool.relatedTrending = [
                      ...(existingPool.relatedTrending || []),
                      contract.cgId,
                    ];
                  }
                }
              }
            }
          }
        }

        console.log(
          `[Find Trending Token Pools] Found pools for ${cgIdPoolsMap.size} trending tokens`
        );

        // 收集所有池子
        const allPools: OutputSchemaPool[] = [];

        for (const [cgId, pools] of cgIdPoolsMap.entries()) {
          // 按APY排序并限制数量
          const sortedPools = pools
            .sort((a, b) => (b.apy || 0) - (a.apy || 0))
            .slice(0, maxLimit);

          allPools.push(...sortedPools);
        }

        // 4. 查询代币信息
        try {
          const { addressToCgIdMap, tokens } = await collectTokenInfo(
            trendingTokenAddressMap
          );
          result.tokens = tokens;

          // 5. 填充池子的代币信息 - 使用已获取的数据
          for (const pool of allPools) {
            const poolData = poolDataMap.get(pool.id);
            if (poolData && poolData.poolTokens) {
              pool.underlyingTokens = poolData.poolTokens
                .map((token: { chain: string; tokenAddress: string }) => {
                  const key = `${token.chain}:${token.tokenAddress}`;
                  const cgId = addressToCgIdMap.get(key);
                  return cgId
                    ? {
                        cgId,
                        chain: token.chain,
                        address: token.tokenAddress,
                      }
                    : null;
                })
                .filter(
                  (
                    token: OutputSchemaUnderlyingToken | null
                  ): token is OutputSchemaUnderlyingToken => token !== null
                );
            }
          }
          // 新增逻辑：移除underlyingTokens数量与原始poolTokens数量不一致的池子
          result.pools = allPools
            .filter((pool) => {
              const poolData = poolDataMap.get(pool.id);
              return (
                pool.underlyingTokens.length > 0 &&
                poolData &&
                poolData.poolTokens &&
                pool.underlyingTokens.length === poolData.poolTokens.length
              );
            })
            .slice(0, maxLimit); // 只保留limit条
        } catch (tokenError) {
          console.error(
            "[Find Trending Token Pools] Token data error:",
            tokenError
          );
          // 即使无法获取代币详情，依然返回池子基本信息
          result.message =
            "Some token information could not be retrieved. Showing limited details.";
        }

        // 6. 最终整理结果
        result.pools = allPools;
        result.protocols = Object.fromEntries(protocolDataMap);

        // 7. 为每个热门代币添加相关池子信息
        result.trending = result.trending.map((token) => {
          const relatedPoolIds = result.pools
            .filter((pool) => pool.relatedTrending?.includes(token.cgId))
            .map((pool) => pool.id);

          return {
            ...token,
            relatedPoolsCount: relatedPoolIds.length,
            relatedPoolIds,
          };
        });

        // 8. 添加过滤逻辑，移除没有相关池子的trending token
        result.trending = result.trending.filter(
          (token) => token.relatedPoolsCount && token.relatedPoolsCount > 0
        );

        console.log(
          `[Find Trending Token Pools] Final result contains ${
            result.trending.length
          } trending tokens, ${result.pools.length} pools, ${
            Object.keys(result.protocols).length
          } protocols, ${Object.keys(result.tokens).length} tokens`
        );

        // 确保数据可以被序列化
        return JSON.parse(JSON.stringify(result));
      } catch (error) {
        console.error("[Find Trending Token Pools] Processing error:", error);
        // 如果处理过程中出现错误，但我们已经有了trending数据，返回简化的结果
        return {
          trending: result.trending,
          pools: [],
          protocols: {},
          tokens: {},
          error: "Error processing trending token pools",
          details: error instanceof Error ? error.message : String(error),
        };
      }
    } catch (error) {
      console.error("[Find Trending Token Pools] Error:", error);
      return createErrorResponse("trending", error);
    }
  },
});
