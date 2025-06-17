import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { RuntimeContext } from "@mastra/core/di";
import {
  intentAgentInputSchema,
  intentAgentOutputSchema,
  reportGeneralAgentOutputSchema,
  reportTrendingAgentOutputSchema,
} from "../agents/defiRadar.agent";
import {
  findDefiInvestmentOpportunitiesTool,
  findTrendingTokenPoolsTool,
  defiRadarToolOutputSchema,
} from "../tools/defiRadar.tool";

const runtimeContext = new RuntimeContext();

const toolSelectorStepOutputSchema = z.object({
  toolOutput: defiRadarToolOutputSchema,
  selectedTool: z.enum([
    "findDefiInvestmentOpportunities",
    "findTrendingTokenPools",
  ]),
});

// Define the wrapped schemas for clarity and correct infer usage
const WrappedGeneralReportSchema = z.object({
  analyses: z.record(
    z.string(),
    z.object({
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
});
const WrappedTrendingReportSchema = z.object({
  trendingAnalyses: z.record(
    z.string(), // trending token cgId
    z.object({
      tokenAnalysis: z.string(),
      tokenScore: z.number().min(1).max(10),
      pools: z.record(
        z.string(),
        z.object({
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
  ),
});

// Step 1: Intent Recognition
const intentStep = createStep({
  id: "intent-recognition",
  description: "Recognizes user's intent and selects the appropriate tool.",
  inputSchema: intentAgentInputSchema,
  outputSchema: intentAgentOutputSchema,
  execute: async ({
    inputData,
    mastra,
  }): Promise<z.infer<typeof intentAgentOutputSchema>> => {
    const { userInput } = inputData;
    const agent = mastra.getAgent("intentAgent");
    const response = await agent.generate([
      { role: "user", content: userInput },
    ]);
    // Safely access response.object with explicit type assertion for the return value
    const result =
      "object" in response && response.object
        ? (response.object as z.infer<typeof intentAgentOutputSchema>)
        : {
            tool: "findDefiInvestmentOpportunities" as const,
            params: {} as Record<string, any>,
          }; // Fallback with explicit enum value and typed params

    return result;
  },
});

// Step 2: Dynamic Tool Execution
const toolCallStep = createStep({
  id: "tool-call",
  description: "Dynamically calls the selected DeFi Radar tool.",
  inputSchema: intentAgentOutputSchema, // Input is the output of intentStep
  outputSchema: toolSelectorStepOutputSchema, // Output is the result of the tool execution PLUS selected tool
  execute: async ({ inputData }) => {
    const { tool, params } = inputData;
    let toolResult: z.infer<typeof defiRadarToolOutputSchema>;

    if (tool === "findDefiInvestmentOpportunities") {
      toolResult = await findDefiInvestmentOpportunitiesTool.execute({
        context: params as z.infer<
          typeof findDefiInvestmentOpportunitiesTool.inputSchema
        >,
        runtimeContext,
      });
    } else if (tool === "findTrendingTokenPools") {
      toolResult = await findTrendingTokenPoolsTool.execute({
        context: params as z.infer<
          typeof findTrendingTokenPoolsTool.inputSchema
        >,
        runtimeContext,
      });
    } else {
      throw new Error(`Unknown tool: ${tool}`);
    }
    return { toolOutput: toolResult, selectedTool: tool };
  },
});

const agentGenerateReportStep = createStep({
  id: "agent-generate-report",
  inputSchema: toolSelectorStepOutputSchema,
  outputSchema: z.object({
    selectedTool: toolSelectorStepOutputSchema.shape.selectedTool,
    originalToolOutput: toolSelectorStepOutputSchema.shape.toolOutput,
    analysisReport: z.union([
      reportGeneralAgentOutputSchema,
      reportTrendingAgentOutputSchema,
    ]),
  }),
  execute: async ({ inputData, mastra }) => {
    // Added mastra context here
    const { toolOutput, selectedTool } = inputData;
    const { pools, protocols, tokens, trending } = toolOutput;

    let analysisReport:
      | z.infer<typeof reportGeneralAgentOutputSchema>
      | z.infer<typeof reportTrendingAgentOutputSchema>;

    if (selectedTool === "findDefiInvestmentOpportunities") {
      const agent = mastra.getAgent("reportGeneralAgent");
      const response = await agent.generate([
        {
          role: "user",
          content: `Analyze the following DeFi pools: ${JSON.stringify({
            pools,
            protocols,
            tokens,
          })}`,
        },
      ]);
      analysisReport =
        "object" in response && response.object
          ? (response.object as z.infer<typeof reportGeneralAgentOutputSchema>)
          : []; // Fallback to empty array
    } else {
      // findTrendingTokenPools
      const agent = mastra.getAgent("reportTrendingAgent");
      const response = await agent.generate([
        {
          role: "user",
          content: `Analyze the following trending token and DeFi pools: ${JSON.stringify(
            { trending, pools, protocols, tokens }
          )}`,
        },
      ]);
      analysisReport =
        "object" in response && response.object
          ? (response.object as z.infer<typeof reportTrendingAgentOutputSchema>)
          : []; // Fallback to empty array
    }
    return {
      selectedTool,
      originalToolOutput: toolOutput,
      analysisReport,
    };
  },
});

// New map step to wrap the analysis report
const wrapAnalysisReportStep = createStep({
  id: "wrap-analysis-report",
  description:
    "Wraps the analysis report with selected tool and original tool output.",
  inputSchema: z.object({
    analysisReport: z.union([
      reportGeneralAgentOutputSchema, // This is now an array
      reportTrendingAgentOutputSchema, // This is now an array
    ]),
    selectedTool: z.enum([
      "findDefiInvestmentOpportunities",
      "findTrendingTokenPools",
    ]),
    originalToolOutput: defiRadarToolOutputSchema,
  }),
  outputSchema: z.object({
    analysisReport: z.union([
      WrappedGeneralReportSchema,
      WrappedTrendingReportSchema,
    ]),
    selectedTool: z.enum([
      "findDefiInvestmentOpportunities",
      "findTrendingTokenPools",
    ]),
    originalToolOutput: defiRadarToolOutputSchema,
  }),
  execute: async ({ inputData }) => {
    const { analysisReport, selectedTool, originalToolOutput } = inputData;

    let wrappedAnalysisReport:
      | z.infer<typeof WrappedGeneralReportSchema>
      | z.infer<typeof WrappedTrendingReportSchema>;

    if (selectedTool === "findDefiInvestmentOpportunities") {
      const generalReports = analysisReport as z.infer<
        typeof reportGeneralAgentOutputSchema
      >;
      const generalReportRecord = generalReports.reduce((acc, current) => {
        const { poolId, ...rest } = current;
        if (poolId) {
          acc[poolId] = rest as Omit<
            z.infer<typeof reportGeneralAgentOutputSchema>[number],
            "poolId"
          >;
        }
        return acc;
      }, {} as Record<string, Omit<z.infer<typeof reportGeneralAgentOutputSchema>[number], "poolId">>);
      wrappedAnalysisReport = { analyses: generalReportRecord };
    } else {
      const trendingReports = analysisReport as z.infer<
        typeof reportTrendingAgentOutputSchema
      >;
      const trendingReportRecord = trendingReports.reduce((acc, current) => {
        const poolsRecord = current.pools.reduce((poolAcc, poolCurrent) => {
          const { poolId, ...poolRest } = poolCurrent;
          if (poolId) {
            poolAcc[poolId] = poolRest as Omit<
              z.infer<
                typeof reportTrendingAgentOutputSchema
              >[number]["pools"][number],
              "poolId"
            >;
          }
          return poolAcc;
        }, {} as Record<string, Omit<z.infer<typeof reportTrendingAgentOutputSchema>[number]["pools"][number], "poolId">>);

        const { trendingTokenCgId, ...rest } = current;
        if (trendingTokenCgId) {
          acc[trendingTokenCgId] = { ...rest, pools: poolsRecord } as Omit<
            z.infer<typeof reportTrendingAgentOutputSchema>[number],
            "trendingTokenCgId"
          > & {
            pools: Record<
              string,
              Omit<
                z.infer<
                  typeof reportTrendingAgentOutputSchema
                >[number]["pools"][number],
                "poolId"
              >
            >;
          };
        }
        return acc;
      }, {} as Record<string, Omit<z.infer<typeof reportTrendingAgentOutputSchema>[number], "trendingTokenCgId"> & { pools: Record<string, Omit<z.infer<typeof reportTrendingAgentOutputSchema>[number]["pools"][number], "poolId">> }>);
      wrappedAnalysisReport = { trendingAnalyses: trendingReportRecord };
    }

    return {
      analysisReport: wrappedAnalysisReport,
      selectedTool,
      originalToolOutput,
    };
  },
});

// Define output schema for finalDataFormatterStep
const FinalWorkflowOutputSchema = z.object({
  analysisReport: z.union([
    WrappedGeneralReportSchema,
    WrappedTrendingReportSchema,
  ]),
  pools: defiRadarToolOutputSchema.shape.pools,
  protocols: defiRadarToolOutputSchema.shape.protocols,
  tokens: defiRadarToolOutputSchema.shape.tokens,
  trending: defiRadarToolOutputSchema.shape.trending.optional(), // Keep trending if present
});

// New step to handle final data cleaning and assembly
const finalDataFormatterStep = createStep({
  id: "final-data-formatter",
  description:
    "Filters and assembles final data based on selected pools from the analysis report.",
  inputSchema: z.object({
    analysisReport: z.union([
      WrappedGeneralReportSchema,
      WrappedTrendingReportSchema,
    ]),
    selectedTool: z.enum([
      "findDefiInvestmentOpportunities",
      "findTrendingTokenPools",
    ]),
    originalToolOutput: defiRadarToolOutputSchema,
  }),
  outputSchema: FinalWorkflowOutputSchema,
  execute: async ({ inputData }) => {
    const { analysisReport, selectedTool, originalToolOutput } = inputData;

    const selectedPoolIds = new Set<string>();

    if (selectedTool === "findDefiInvestmentOpportunities") {
      const generalReport = analysisReport as z.infer<
        typeof WrappedGeneralReportSchema
      >;
      Object.keys(generalReport.analyses).forEach((poolId) =>
        selectedPoolIds.add(poolId)
      );
    } else {
      // findTrendingTokenPools
      const trendingReport = analysisReport as z.infer<
        typeof WrappedTrendingReportSchema
      >;
      Object.values(trendingReport.trendingAnalyses).forEach((tokenReport) => {
        Object.keys(tokenReport.pools).forEach((poolId) =>
          selectedPoolIds.add(poolId)
        );
      });

      // 移除没有对应池子的trending token分析报告
      const tokenCgIdsWithPools = new Set<string>();
      originalToolOutput.pools.forEach((pool) => {
        if (pool.relatedTrending && pool.relatedTrending.length > 0) {
          pool.relatedTrending.forEach((cgId) => tokenCgIdsWithPools.add(cgId));
        }
      });

      // 过滤trendingAnalyses，只保留有关联池子的token分析
      if (trendingReport.trendingAnalyses) {
        const filteredTrendingAnalyses: typeof trendingReport.trendingAnalyses =
          {};

        Object.entries(trendingReport.trendingAnalyses).forEach(
          ([cgId, analysis]) => {
            if (tokenCgIdsWithPools.has(cgId)) {
              filteredTrendingAnalyses[cgId] = analysis;
            }
          }
        );

        trendingReport.trendingAnalyses = filteredTrendingAnalyses;
      }
    }

    const filteredPools = originalToolOutput.pools.filter((pool) =>
      selectedPoolIds.has(pool.id)
    );

    const usedProtocolIds = new Set<string>();
    const usedTokenCgIds = new Set<string>();

    filteredPools.forEach((pool) => {
      usedProtocolIds.add(pool.protocol);
      pool.underlyingTokens.forEach((token) => {
        if (token && token.cgId) {
          // Added null check
          usedTokenCgIds.add(token.cgId);
        }
      });
    });

    const filteredProtocols: Record<string, any> = {};
    Object.entries(originalToolOutput.protocols).forEach(([id, protocol]) => {
      if (usedProtocolIds.has(id)) {
        filteredProtocols[id] = protocol;
      }
    });

    const filteredTokens: Record<string, any> = {};
    Object.entries(originalToolOutput.tokens).forEach(([id, token]) => {
      if (usedTokenCgIds.has(id)) {
        filteredTokens[id] = token;
      }
    });

    return {
      analysisReport,
      pools: filteredPools,
      protocols: filteredProtocols,
      tokens: filteredTokens,
      trending: originalToolOutput.trending, // Pass trending data if present
    };
  },
});

// Main Workflow Definition
export const defiRadarWorkflow = createWorkflow({
  id: "defi-radar-workflow",
  inputSchema: z.object({
    query: z.string().describe("User's query for DeFi analysis"),
  }),
  outputSchema: FinalWorkflowOutputSchema, // Updated to new final output schema
})
  .then(
    createStep({
      id: "prepare-intent-input",
      inputSchema: z.object({ query: z.string() }),
      outputSchema: intentAgentInputSchema,
      execute: async ({ inputData }) => ({ userInput: inputData.query }),
    })
  )
  .then(intentStep) // Output: { tool: "...", params: { ... } }
  .then(toolCallStep) // Output: { toolOutput: defiRadarToolOutputSchema, selectedTool: "..." }
  .then(agentGenerateReportStep)
  .then(wrapAnalysisReportStep)
  .then(finalDataFormatterStep)
  .commit();
