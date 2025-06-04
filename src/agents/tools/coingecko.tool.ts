// src/mastra/tools/coingecko-tools.ts

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
// coinGeckoApiClient is an instance of CoingeckoClient, not CoinGeckoService
// import { coinGeckoApiClient } from "../../lib/apiClients/coingeckoClient";
import { CoinGeckoService } from "../../services/coingeckoSync.service";
import { TrendingCoinItem } from "../../lib/apiClients/coingeckoClient"; // Import for output schema

// Instantiate the service
// CoinGeckoService will instantiate its own PrismaClient and CoingeckoClient if not provided.
const coinGeckoService = new CoinGeckoService();

export const getTokenInfoByContractTool = createTool({
  id: "GetCoinGeckoTokenInfoByContract",
  description:
    "Retrieves full token information from CoinGecko using blockchain ID (e.g., 'ethereum', 'solana') and contract address. Fetches details if not recently cached (2-hour TTL).",
  inputSchema: z.object({
    platformId: z
      .string()
      .describe(
        "Blockchain ID as recognized by CoinGecko (e.g., 'ethereum', 'solana')."
      ),
    contractAddress: z
      .string()
      .describe("Contract address of the token on the specified blockchain."),
  }),
  outputSchema: z.object({
    found: z
      .boolean()
      .describe("Indicates if the token was found and details were retrieved."),
    cgId: z
      .string()
      .optional()
      .describe("The CoinGecko ID of the token, if found."),
    // CgCoinDetails is complex, using z.any() but describing key expected fields.
    // A more specific Zod schema could be built for CgCoinDetails if needed for strong typing at the tool output.
    details: z
      .any()
      .optional()
      .describe(
        "Object containing detailed token information from CoinGecko. Structure mirrors Prisma CgCoinDetails model including fields like name, symbol, market_data, descriptionEn, imageThumbUrl, etc."
      ),
    message: z
      .string()
      .optional()
      .describe(
        "Optional message, e.g., if token ID was found but details retrieval failed."
      ),
  }),
  execute: async ({ context }) => {
    const { platformId, contractAddress } = context;
    try {
      // First, get the cgId, name, and symbol using the new service method
      const basicInfo = await coinGeckoService.findCgInfoByPlatformContract(
        platformId,
        contractAddress
      );

      if (!basicInfo || !basicInfo.cgId) {
        return {
          found: false,
          message: `Token with contract ${contractAddress} on blockchain ${platformId} not found in CoinGecko index.`,
        };
      }

      // Now fetch full details using the cgId
      // getCoinDetailsAndStore uses a 2-hour cache by default
      const details = await coinGeckoService.getCoinDetailsAndStore(
        basicInfo.cgId
      );

      if (!details) {
        return {
          found: false,
          cgId: basicInfo.cgId,
          message: `Found CoinGecko ID (${basicInfo.cgId}) for ${basicInfo.name} (${basicInfo.symbol}) but failed to retrieve full details.`,
        };
      }
      return {
        found: true,
        cgId: basicInfo.cgId,
        details: details, // contains all CgCoinDetails fields
      };
    } catch (error: any) {
      console.error(
        `[Tool:GetCoinGeckoTokenInfoByContract] Error: ${error.message}`,
        error
      );
      return {
        found: false,
        error: error.message || String(error),
        message:
          "An error occurred while fetching token information by contract.",
      };
    }
  },
});

export const syncCoinGeckoTokensListAndPlatformsTool = createTool({
  id: "SyncCoinGeckoTokensListAndPlatforms",
  description:
    "Triggers a synchronization of the CoinGecko coins list and their platforms to the local database and cache. Should be used sparingly, as it's a heavy operation.",
  inputSchema: z.object({}).optional(),
  outputSchema: z.object({
    success: z
      .boolean()
      .describe(
        "Indicates if the synchronization process was successfully initiated."
      ),
    message: z
      .string()
      .describe(
        "A message detailing the outcome of the synchronization trigger."
      ),
    error: z
      .string()
      .optional()
      .describe("Error message if the process failed to trigger."),
  }),
  execute: async () => {
    try {
      console.log(
        "[Tool:SyncCoinGeckoTokensListAndPlatforms] Starting synchronization..."
      );
      await coinGeckoService.syncCoinsListAndPlatforms();
      return {
        success: true,
        message:
          "CoinGecko coins list and platforms synchronization triggered successfully. The process runs in the background.",
      };
    } catch (error: any) {
      console.error(
        `[Tool:SyncCoinGeckoTokensListAndPlatforms] Error: ${error.message}`,
        error
      );
      return {
        success: false,
        message:
          "Failed to trigger CoinGecko coins list and platforms synchronization.",
        error: error.message || String(error),
      };
    }
  },
});

export const getTokenDetailsByCoinGeckoIdTool = createTool({
  id: "GetCoinGeckoTokenDetailsById",
  description:
    "Retrieves full token details from CoinGecko using its CoinGecko ID (e.g., 'bitcoin'). Uses a 2-hour cache by default.",
  inputSchema: z.object({
    cgId: z
      .string()
      .describe("The CoinGecko ID of the token (e.g., 'bitcoin', 'ethereum')."),
  }),
  outputSchema: z.object({
    found: z
      .boolean()
      .describe("Indicates if details were found for the given CoinGecko ID."),
    cgId: z.string().optional().describe("The CoinGecko ID that was queried."),
    details: z
      .any()
      .optional()
      .describe(
        "Object containing detailed token information. Structure mirrors Prisma CgCoinDetails model."
      ),
    message: z
      .string()
      .optional()
      .describe("Optional message, e.g., if no details were found."),
  }),
  execute: async ({ context }) => {
    const { cgId } = context;
    try {
      console.log(`[Tool:GetCoinGeckoTokenDetailsById] cgId: ${cgId}`);
      // getCoinDetailsAndStore uses a 2-hour cache by default
      const details = await coinGeckoService.getCoinDetailsAndStore(cgId);
      if (!details) {
        return {
          found: false,
          cgId: cgId,
          message: `No details found for CoinGecko ID: ${cgId}`,
        };
      }
      return {
        found: true,
        cgId: cgId,
        details: details,
      };
    } catch (error: any) {
      console.error(
        `[Tool:GetCoinGeckoTokenDetailsById] Error for cgId ${cgId}: ${error.message}`,
        error
      );
      return {
        found: false,
        cgId: cgId,
        error: error.message || String(error),
        message: "An error occurred while fetching token details by ID.",
      };
    }
  },
});

export const getTrendingCoinsTool = createTool({
  id: "GetCoinGeckoTrendingCoinsFromCache",
  description:
    "Retrieves the list of trending coins directly from the Redis cache. Backend services are responsible for periodically updating this cache.",
  inputSchema: z.object({}).optional(),
  outputSchema: z.object({
    success: z
      .boolean()
      .describe(
        "Indicates if the operation was successful (even if cache is empty)."
      ),
    count: z
      .number()
      .optional()
      .describe("Number of trending coins found in the cache."),
    trendingCoins: z
      .array(
        z.custom<TrendingCoinItem>(
          (data) =>
            typeof data === "object" &&
            data !== null &&
            "id" in data &&
            "name" in data &&
            "symbol" in data &&
            "coin_id" in data
        )
      )
      .optional()
      .describe(
        "An array of trending coin objects. Each object includes id, name, symbol, coin_id, market_cap_rank, and score."
      ),
    message: z
      .string()
      .describe("A message detailing the outcome, e.g., if cache was empty."),
    error: z
      .string()
      .optional()
      .describe("Error message if reading from cache failed."),
  }),
  execute: async () => {
    try {
      console.log(
        "[Tool:GetCoinGeckoTrendingCoinsFromCache] Fetching trending coins from Redis cache..."
      );
      const trendingCoinsList =
        await coinGeckoService.getTrendingCoinsFromCache();

      if (trendingCoinsList && trendingCoinsList.length > 0) {
        return {
          success: true,
          count: trendingCoinsList.length,
          trendingCoins: trendingCoinsList,
          message: `Successfully fetched ${trendingCoinsList.length} trending coins from cache.`,
        };
      } else if (trendingCoinsList === null || trendingCoinsList.length === 0) {
        return {
          success: true,
          count: 0,
          trendingCoins: [],
          message:
            "Trending coins cache is empty or not found. Backend jobs should populate this.",
        };
      }
      // Fallthrough for unexpected null from service if logic changes, though current service returns [] or null for empty/miss.
      return {
        success: true,
        count: 0,
        trendingCoins: [],
        message: "No trending coins data currently available in cache.",
      };
    } catch (error: any) {
      console.error(
        `[Tool:GetCoinGeckoTrendingCoinsFromCache] Error: ${error.message}`,
        error
      );
      return {
        success: false,
        message: "Failed to fetch trending coins from cache.",
        error: error.message || String(error),
      };
    }
  },
});

// New tool to find basic coin info (cgId, name, symbol) by platform and contract
export const findCgInfoByPlatformContractTool = createTool({
  id: "FindCoinGeckoInfoByPlatformContract",
  description:
    "Finds a token's CoinGecko ID, name, and symbol using its blockchain ID and contract address. Useful for quick lookups without fetching full details.",
  inputSchema: z.object({
    platformId: z
      .string()
      .describe(
        "Blockchain ID as recognized by CoinGecko (e.g., 'ethereum', 'solana')."
      ),
    contractAddress: z
      .string()
      .describe(
        "The contract address of the token on the specified blockchain."
      ),
  }),
  outputSchema: z.object({
    found: z.boolean().describe("Indicates if a matching token was found."),
    cgId: z
      .string()
      .optional()
      .describe("The CoinGecko ID of the token, if found."),
    name: z
      .string()
      .optional()
      .describe(
        "The name of the token, if found. Could be 'Unknown' if cgId is found but name/symbol are not."
      ),
    symbol: z
      .string()
      .optional()
      .describe(
        "The symbol of the token, if found. Could be 'Unknown' if cgId is found but name/symbol are not."
      ),
    message: z
      .string()
      .optional()
      .describe("Optional message, e.g., if token was not found."),
  }),
  execute: async ({ context }) => {
    const { platformId, contractAddress } = context;
    try {
      console.log(
        `[Tool:FindCoinGeckoInfoByPlatformContract] platformId: ${platformId}, contractAddress: ${contractAddress}`
      );
      const basicInfo = await coinGeckoService.findCgInfoByPlatformContract(
        platformId,
        contractAddress
      );

      if (basicInfo && basicInfo.cgId) {
        return {
          found: true,
          cgId: basicInfo.cgId,
          name: basicInfo.name,
          symbol: basicInfo.symbol,
        };
      }
      return {
        found: false,
        message: `No CoinGecko token information found for contract ${contractAddress} on blockchain ${platformId}.`,
      };
    } catch (error: any) {
      console.error(
        `[Tool:FindCoinGeckoInfoByPlatformContract] Error: ${error.message}`,
        error
      );
      return {
        found: false,
        message:
          "An error occurred while finding token info by platform and contract.",
        error: error.message || String(error),
      };
    }
  },
});
