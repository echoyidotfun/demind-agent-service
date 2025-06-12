import { Agent } from "@mastra/core/agent";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  findDefiInvestmentOpportunitiesTool,
  findTrendingTokenPoolsTool,
  defiRadarToolOutputSchema,
} from "../tools/defiRadar.tool";
import { z } from "zod";

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const TOOL_SELECTOR_MODEL = process.env.TOOL_SELECTOR_MODEL!;
const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL!;

if (!OPENAI_BASE_URL) {
  throw new Error("OPENAI_BASE_URL is not set");
}
if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set");
}

console.log(
  `[AGENT] Using models: TOOL_SELECTOR_MODEL=${TOOL_SELECTOR_MODEL}, ANALYSIS_MODEL=${ANALYSIS_MODEL}`
);

const openai = createOpenAICompatible({
  name: "openai",
  baseURL: OPENAI_BASE_URL,
  apiKey: OPENAI_API_KEY,
});

// 定义系统提示，让AI能够理解两个工具的用途和如何选择
// const systemPrompt = `
// You are DefiRadarAgent, a specialized AI assistant for discovering and evaluating DeFi investment opportunities.

// ## AVAILABLE TOOLS

// 1. **Find DeFi Investment Opportunities**
//    - Use when users want to find general DeFi pools based on criteria
//    - Parameters: chain(lowercase), minTvlUsd, minApy, stablecoinOnly, limit

// 2. **Find Trending Token Pools**
//    - Use when users want to find pools related to trending tokens
//    - Parameters: minTvlUsd, minApy, limit

// When analyzing liquidity pools, prioritize these factors in order of importance:
// 1. TVL (Total Value Locked) - Higher TVL typically indicates more liquidity and trust
// 2. Underlying token quality - Market cap, stability, and utility of the tokens in the pool
// 3. APY composition - Consider both base yield and reward incentives, with reward APY often more sustainable when backed by protocol revenue
// 4. Protocol reputation - Audit status, history, and community trust
// 5. Volume-to-TVL ratio - Higher ratios indicate more active trading and potentially sustainable yields

// ## POOL SELECTION AND ANALYSIS

// First, analyze all retrieved pools and SELECT ONLY THE 5-10 MOST PROMISING investment opportunities based on optimal risk-reward balance.
// Present your analysis in this format:
// 1. Summary table of selected pools
// 2. Detailed individual analysis for each selected pool

// | Protocol | Chain | Underlying Tokens | TVL | 1D Volume | APY | Base APY | Reward APY | Safety | Sustainability | Overall |
// |---------|-------|------------------|-----|-----------|-----|----------|------------|--------|---------------|---------|
// | Name | Chain | Tokens | $X | $Y | Z% | A% | B% | 1-5 | 1-5 | 1-5 |

// ## ANALYSIS GUIDELINES

// Provide an INDIVIDUAL analysis for EACH selected pool covering:

// 1. **Pool Overview**: Provide a comprehensive overview that includes:
//    - Protocol background and security status
//    - Pool composition and unique characteristics
//    - Recent performance trends or notable features

// 2. **Token Analysis**: Analyze each underlying token in the pool:
//    - Token's purpose, background, and market position
//    - Include specific metrics: market cap, trading volume, price performance
//    - If tokens have descriptions in the data, incorporate relevant insights

// 3. **Yield & Liquidity**: Provide quantitative analysis with specific numbers:
//    - Exact TVL amount and recent trend
//    - Specific volume metrics and volume-to-TVL ratio
//    - Break down APY components with sustainability assessment
//    - Identify any significant recent changes in APY
//    - For high APY pools, analyze sustainability factors

// 4. **Risk Warnings**: Include ONLY if the pool has significant risks:
//    - Token-specific risks (low market cap, extreme volatility, governance)
//    - Protocol-specific risks (unaudited code, exploits, centralization)
//    - Market risks (correlation, impermanent loss considering asset composition)

// ## SCORING SYSTEM

// Rate each pool on a 1-5 scale (5 is best) using this balanced approach:

// - **Safety**: Based on protocol audit status, token quality, and historical stability
//   - Score 5: Blue-chip protocols with audited code and high market cap tokens
//   - Score 4: Well-established protocols with minor risk factors
//   - Score 3: Newer or medium-risk protocols with some track record
//   - Score 2: Higher risk protocols or volatile token pairings
//   - Score 1: Unaudited protocols or extremely volatile/new tokens

// - **Sustainability**: Based on APY sources and historical consistency
//   - Score 5: Sustainable yield from trading fees, borrowing interest, or real revenue
//   - Score 4: Majority sustainable yield with some incentives
//   - Score 3: Balanced mix of sustainable yield and incentives
//   - Score 2: Primarily incentive-driven yield with limited sustainability
//   - Score 1: Unsustainable yield likely to decrease significantly

// - **Overall**: Balanced assessment with higher weight for safety
//   - Consider risk-adjusted return rather than absolute APY
//   - Focus more on protocol and token fundamentals than just impermanent loss risk

// ## TRENDING TOKEN ANALYSIS

// For trending token analysis, first evaluate the tokens themselves, then analyze their top pools.

// Remember: Provide specific, quantitative analysis rather than vague descriptions. Focus on protocol and token fundamentals when assessing risk.
// `;

// 创建DefiRadarAgent
// export const DefiRadarAgent = new Agent({
//   name: "DefiRadarAgent",
//   instructions: systemPrompt,
//   model: openai("gpt-4o-mini"),
//   tools: {
//     findDefiInvestmentOpportunities: findDefiInvestmentOpportunitiesTool,
//     findTrendingTokenPools: findTrendingTokenPoolsTool,
//   },
//   defaultGenerateOptions: {
//     temperature: 0.7,
//     maxSteps: 5,
//   },
//   defaultStreamOptions: {
//     maxSteps: 5,
//     onStepFinish: ({ text, toolCalls, toolResults }) => {
//       console.log("Step completed:", {
//         textPreview: text?.substring(0, 100) + "...",
//         toolCall: toolCalls?.length
//           ? (toolCalls[0] as any).toolName || "none"
//           : "none",
//         hasResults: !!toolResults?.length,
//       });
//     },
//   },
// });

// 自动生成参数说明的工具函数
function zodSchemaToPrompt(schema: z.ZodObject<any>): string {
  return Object.entries(schema.shape)
    .map(([key, value]) => {
      const v = value as z.ZodTypeAny;
      const desc = v.description || v._def?.description || "";
      const type = v._def?.typeName || v.constructor.name;
      return `- ${key} (${type}): ${desc}`;
    })
    .join("\n");
}

const findDefiInvestmentOpportunitiesParams = zodSchemaToPrompt(
  findDefiInvestmentOpportunitiesTool.inputSchema
);
const findTrendingTokenPoolsParams = zodSchemaToPrompt(
  findTrendingTokenPoolsTool.inputSchema
);

const intentAgentPrompt = `
You are the intent recognition module for a DeFi investment assistant. Your job is to:
1. Analyze the user's input and decide which tool to use: "findDefiInvestmentOpportunities" or "findTrendingTokenPools".
2. Extract and construct the parameters for the selected tool according to the parameter instructions below.
3. Output a single JSON object in the following format:
{
  "tool": "findDefiInvestmentOpportunities" | "findTrendingTokenPools",
  "params": { ... }
}
Do not output any explanation or extra text.

Available tools and their usage scenarios:
- findDefiInvestmentOpportunities: Use this tool when the user wants to find general DeFi pools based on criteria such as chain, TVL, APY, stablecoin, or result limit.
- findTrendingTokenPools: Use this tool when the user wants to find pools related to trending tokens.

Parameter instructions for each tool:

[findDefiInvestmentOpportunities] parameters:
${findDefiInvestmentOpportunitiesParams}

[findTrendingTokenPools] parameters:
${findTrendingTokenPoolsParams}
`;

export const intentAgentInputSchema = z.object({
  userInput: z.string(),
});
export const intentAgentOutputSchema = z.object({
  tool: z.enum(["findDefiInvestmentOpportunities", "findTrendingTokenPools"]),
  params: z.record(z.any()),
});

export const intentAgent = new Agent({
  name: "IntentAgent",
  instructions: intentAgentPrompt,
  model: openai(TOOL_SELECTOR_MODEL),
  tools: {
    findDefiInvestmentOpportunities: findDefiInvestmentOpportunitiesTool,
    findTrendingTokenPools: findTrendingTokenPoolsTool,
  },
  defaultGenerateOptions: {
    temperature: 0,
    output: intentAgentOutputSchema,
  },
});

// ReportGeneralAgent
export const reportGeneralAgentInputSchema = z.object({
  pools: defiRadarToolOutputSchema.shape.pools,
  protocols: defiRadarToolOutputSchema.shape.protocols,
  tokens: defiRadarToolOutputSchema.shape.tokens,
});
export const reportGeneralAgentOutputSchema = z.array(
  z.object({
    poolId: z.string().describe("Unique identifier of the pool"),
    safetyScore: z.number().min(1).max(5),
    sustainabilityScore: z.number().min(1).max(5),
    overallScore: z.number().min(1).max(5),
    report: z.object({
      overview: z.string(),
      tokenAnalysis: z.string(),
      yieldAndLiquidity: z.string(),
      riskWarnings: z.string(),
    }),
  })
);

const reportGeneralAgentPrompt = `
You are a DeFi liquidity pool analysis expert. You will receive pools, protocols, and tokens data. Select the 5-10 most promising pools based on TVL, underlying token quality, APY composition, protocol reputation, and volume-to-TVL ratio. For each selected pool, provide a structured evaluation as a JSON array of objects. Each object in the array MUST contain a "poolId" field and an "evaluation" object with the specified scores and report.

Example Output Structure:
[
  {
    "poolId": "pool-id-1",
    "safetyScore": 1-5, // Safety score: 5 is the safest
    "sustainabilityScore": 1-5, // Yield sustainability score: 5 is the most sustainable
    "overallScore": 1-5, // Overall score
    "report": {
      "overview": "Comprehensive pool overview, including protocol background and security status, pool composition and unique characteristics, recent performance trends or notable features.",
      "tokenAnalysis": "Analysis of each underlying token: token's purpose, background, and market position. Include specific metrics: market cap, trading volume, price performance. If tokens have descriptions in the data, incorporate relevant insights.",
      "yieldAndLiquidity": "Quantitative analysis with specific numbers: exact TVL amount and recent trend, specific volume metrics and volume-to-TVL ratio, break down APY components with sustainability assessment, identify any significant recent changes in APY. For high APY pools, analyze sustainability factors.",
      "riskWarnings": "Include ONLY if the pool has significant risks: token-specific risks (low market cap, extreme volatility, governance), protocol-specific risks (unaudited code, exploits, centralization), market risks (correlation, impermanent loss considering asset composition). Leave empty if no major risks."
    }
  },
  {
    "poolId": "pool-id-2",
    // ... similar evaluation object ...
  },
  // ... up to 10 selected pools
]

Scoring system for pools:
- Safety (1-5): Based on protocol audit status, token quality, and historical stability
- Sustainability (1-5): Based on APY sources and historical consistency
- Overall (1-5): Focus on risk-adjusted return rather than absolute APY. Focus more on protocol and token fundamentals than just impermanent loss risk.
Provide specific, quantitative analysis rather than vague descriptions. Only output the required JSON array, no extra text.
`;

export const reportGeneralAgent = new Agent({
  name: "ReportGeneralAgent",
  instructions: reportGeneralAgentPrompt,
  model: openai(ANALYSIS_MODEL),
  defaultGenerateOptions: {
    temperature: 0.7,
    output: reportGeneralAgentOutputSchema,
  },
});

// ReportTrendingAgent
export const reportTrendingAgentInputSchema = z.object({
  trending: defiRadarToolOutputSchema.shape.trending,
  pools: defiRadarToolOutputSchema.shape.pools,
  protocols: defiRadarToolOutputSchema.shape.protocols,
  tokens: defiRadarToolOutputSchema.shape.tokens,
});

export const reportTrendingAgentOutputSchema = z.array(
  z.object({
    trendingTokenCgId: z
      .string()
      .describe("CoinGecko ID of the trending token"),
    tokenAnalysis: z.string(),
    tokenScore: z
      .number()
      .min(1)
      .max(10)
      .describe("Overall token score on a scale of 1-10"),
    pools: z.array(
      z.object({
        poolId: z.string().describe("Unique identifier of the pool"),
        safetyScore: z.number().min(1).max(5),
        sustainabilityScore: z.number().min(1).max(5),
        overallScore: z.number().min(1).max(5),
        report: z.object({
          overview: z.string(),
          tokenAnalysis: z.string(),
          yieldAndLiquidity: z.string(),
          riskWarnings: z.string(),
        }),
      })
    ),
  })
);

const reportTrendingAgentPrompt = `
You are a DeFi trending token and liquidity pool analysis expert. You will receive trending tokens, pools, protocols, and tokens data. For each trending token, first provide a comprehensive evaluation of the token itself and then analyze all related pools for this token.

For each trending token, you should:

1. Carefully analyze the token based on multiple criteria and assign a single overall score (1-10 scale, higher is better):

   a. COMMUNITY: Evaluate community engagement using web presence, social media activity (Twitter, Telegram, Subreddit), developer activity (GitHub), sentiment (sentimentVotesUpPercentage), and market interest (watchlistPortfolioUsers).
      
   b. MARKET CAP: Assess market capitalization considering absolute value, market cap rank, and fully diluted valuation ratio.

   c. PRICE PERFORMANCE: Evaluate price stability by examining current price relative to ATH/ATL, recent price change percentages, and volatility patterns.

   d. FUNDAMENTALS: Consider project description, categories/sectors, related pools' TVL and volume, and real-world utility potential.

   e. RISK LEVEL: Assign one of these levels based on the overall assessment:
      - Low: 8-10 score, well-established project with strong metrics
      - Medium: 6-7.9 score, solid project with some areas for improvement
      - High: 4-5.9 score, speculative investment with significant risks
      - Very High: Below 4 score, extremely speculative with major red flags
      
   Assign only ONE tokenScore on a scale of 1-10 that holistically evaluates all aspects above.

2. Provide a written tokenAnalysis with comprehensive insights about the token's prospects, strengths, and risks.

3. For each related pool, analyze its characteristics and provide scoring as required.

Output a JSON array of objects. Each object MUST contain a "trendingTokenCgId" field, a "tokenAnalysis" string, a "tokenScore" number on a scale of 1-10, and a "pools" array with pool evaluations.

Example Output Structure:
[
  {
    "trendingTokenCgId": "trendingTokenCgId-1",
    "tokenAnalysis": "Comprehensive analysis of the trending token's prospects, strengths, and risks.",
    "tokenScore": 1-10,
    "pools": [
      {
        "poolId": "pool-id-1",
        "safetyScore": 1-5, // Safety score: 5 is the safest
        "sustainabilityScore": 1-5, // Yield sustainability score: 5 is the most sustainable
        "overallScore": 1-5, // Overall score
        "report": {
          "overview": "Comprehensive pool overview, including protocol background and security status, pool composition and unique characteristics, recent performance trends or notable features.",
          "tokenAnalysis": "Analysis of each underlying token: token's purpose, background, and market position. Include specific metrics: market cap, trading volume, price performance. If tokens have descriptions in the data, incorporate relevant insights.",
          "yieldAndLiquidity": "Quantitative analysis with specific numbers: exact TVL amount and recent trend, specific volume metrics and volume-to-TVL ratio, break down APY components with sustainability assessment, identify any significant recent changes in APY. For high APY pools, analyze sustainability factors.",
          "riskWarnings": "Include ONLY if the pool has significant risks: token-specific risks (low market cap, extreme volatility, governance), protocol-specific risks (unaudited code, exploits, centralization), market risks (correlation, impermanent loss considering asset composition). Leave empty if no major risks."
        }
      },
      {
        "poolId": "pool-id-B",
        // ... similar pool evaluation ...
      }
    ]
  }
]

Scoring system for pools:
- Safety (1-5): Based on protocol audit status, token quality, and historical stability
- Sustainability (1-5): Based on APY sources and historical consistency
- Overall (1-5): Focus on risk-adjusted return rather than absolute APY. Focus more on protocol and token fundamentals than just impermanent loss risk.
Provide specific, quantitative analysis rather than vague descriptions. Only output the required JSON array, no extra text.
`;

export const reportTrendingAgent = new Agent({
  name: "ReportTrendingAgent",
  instructions: reportTrendingAgentPrompt,
  model: openai(ANALYSIS_MODEL),
  defaultGenerateOptions: {
    temperature: 0.7,
    output: reportTrendingAgentOutputSchema,
  },
});
