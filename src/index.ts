import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Mastra } from "@mastra/core";
import { streamSSE } from "hono/streaming";
import {
  // DefiRadarAgent,
  intentAgent,
  reportGeneralAgent,
  reportTrendingAgent,
} from "./ai/agents/defiRadar.agent";
import { defiRadarWorkflow } from "./ai/workflows/defiRadar.workflow";
import { setupDefiLlamaSyncCronJobs } from "./lib/cron/defiLlamaSyncTask";
import { DeFiLlamaSyncService } from "./services/defiLlamaSync.service";
import { CoinGeckoService } from "./services/coingeckoSync.service";

const defiLlamaSyncService = new DeFiLlamaSyncService();
const coinGeckoService = new CoinGeckoService();

// Initialize Mastra and register the agent
const mastra = new Mastra({
  agents: {
    // DefiRadarAgent,
    intentAgent,
    reportGeneralAgent,
    reportTrendingAgent,
  },
  workflows: {
    defiRadarWorkflow,
  },
});

// 创建 Hono 应用
const app = new Hono();

// 启用 CORS
app.use(
  "/*",
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5500",
      "http://127.0.0.1:5500",
      "https://your-frontend-domain.com",
    ],
    allowHeaders: ["Content-Type", "Authorization", "Cache-Control"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Type", "Content-Length"],
    maxAge: 86400,
    credentials: true,
  })
);

// 基础路由
app.get("/", (c) =>
  c.json({
    service: "DeMind Agent API",
    status: "running",
    version: "1.0.0",
  })
);

app.get("/health", (c) => c.json({ status: "ok" }));

const api = new Hono().basePath("/api/v1");

// api.post("/debug/defiRadar", async (c) => {
//   try {
//     const { query, maxSteps = 10 } = await c.req.json();

//     if (!query) {
//       return c.json({ error: "Query is required" }, 400);
//     }

//     console.log(`[DEBUG] DefiRadar Agent processing query: "${query}"`);

//     // 创建一个更详细的响应，包含工具调用信息
//     const steps: any[] = [];
//     const response = await DefiRadarAgent.generate(
//       [{ role: "user", content: query }],
//       {
//         maxSteps,
//         onStepFinish: ({ text, toolCalls, toolResults }) => {
//           // 记录每个步骤的信息
//           const stepInfo = {
//             text:
//               text?.substring(0, 200) +
//               (text && text.length > 200 ? "..." : ""),
//             toolCalls:
//               toolCalls?.map((call) => ({
//                 type: call.type,
//                 tool: call.type === "tool-call" ? call.toolName : "none",
//                 args: call.type === "tool-call" ? call.args : {},
//               })) || [],
//             hasResults: !!toolResults?.length,
//           };

//           steps.push(stepInfo);
//           console.log(
//             `[DEBUG] Step ${steps.length} completed:`,
//             JSON.stringify(stepInfo, null, 2)
//           );
//         },
//       }
//     );

//     return c.json({
//       reply: response.text,
//       steps,
//       totalSteps: steps.length,
//       success: true,
//     });
//   } catch (error: any) {
//     console.error("[DEBUG] DefiRadar Agent error:", error);
//     return c.json(
//       {
//         success: false,
//         message: "DefiRadar Agent debug failed",
//         error: error.message || String(error),
//       },
//       500
//     );
//   }
// });

// Add debug interface for defiRadarWorkflow
// api.post("/debug/defiRadarWorkflow", async (c) => {
//   try {
//     const { query } = await c.req.json();

//     if (!query) {
//       return c.json({ error: "Query is required" }, 400);
//     }

//     console.log(`[DEBUG] defiRadarWorkflow processing query: "${query}"`);

//     const workflow = mastra.getWorkflow("defiRadarWorkflow");
//     const run = workflow.createRun();

//     const result = await run.start({ inputData: { query } });

//     return c.json({
//       success: true,
//       result: "result" in result ? result.result : result,
//     });
//   } catch (error: any) {
//     console.error("[DEBUG] defiRadarWorkflow error:", error);
//     return c.json(
//       {
//         success: false,
//         message: "defiRadarWorkflow debug failed",
//         error: error.message || String(error),
//       },
//       500
//     );
//   }
// });

// 存储正在运行的工作流和对应的中断控制器
const workflowAbortControllers = new Map<string, AbortController>();

// 添加中断工作流的API端点
api.post("/stream/abort/:runId", async (c) => {
  const runId = c.req.param("runId");
  const controller = workflowAbortControllers.get(runId);

  if (controller) {
    controller.abort();
    workflowAbortControllers.delete(runId);
    return c.json({ success: true, message: "Workflow aborted" });
  }

  return c.json({ success: false, message: "Workflow not found" }, 404);
});

// 重构流式响应API，使用streamSSE
api.get("/stream/defiRadarWorkflow", async (c) => {
  const query = c.req.query("query");

  console.log(`[STREAM] Received stream request, query: "${query}"`);

  if (!query) {
    console.log("[STREAM] Missing query parameter");
    return c.json({ error: "Query parameter is required" }, 400);
  }

  console.log(`[STREAM] Headers set for SSE connection`);

  // 生成唯一的运行ID
  const runId = `run-${Date.now()}`;

  // 创建中断控制器
  const abortController = new AbortController();
  workflowAbortControllers.set(runId, abortController);

  return streamSSE(
    c,
    async (stream) => {
      try {
        // 发送连接成功消息和runId
        await stream.writeSSE({
          data: JSON.stringify({
            status: "Connected to streaming API",
            timestamp: new Date().toISOString(),
            runId,
          }),
          event: "connected",
        });

        // 处理中断
        stream.onAbort(() => {
          console.log(`[STREAM] Connection aborted for runId: ${runId}`);
          if (workflowAbortControllers.has(runId)) {
            workflowAbortControllers.get(runId)?.abort();
            workflowAbortControllers.delete(runId);
          }
        });

        // 发送初始分析开始消息
        await stream.writeSSE({
          data: JSON.stringify({
            message: "Starting DeFi analysis...",
            query,
          }),
          event: "start",
        });

        // 获取工作流
        const workflow = mastra.getWorkflow("defiRadarWorkflow");

        if (!workflow) {
          console.error("[STREAM] Workflow not found: defiRadarWorkflow");
          await stream.writeSSE({
            data: JSON.stringify({
              message: "Workflow not found",
              details: "The requested workflow could not be found",
            }),
            event: "error",
          });
          return;
        }

        // 创建工作流运行实例
        const run = workflow.createRun();
        console.log(`[STREAM] Created workflow run: ${runId}`);

        // 设置工作流观察器
        run.watch(async (event: any) => {
          // 检查是否已中断
          if (abortController.signal.aborted) {
            console.log(
              `[STREAM] Skipping event processing - workflow aborted: ${runId}`
            );
            return;
          }

          // 创建基础事件数据
          const eventData: Record<string, any> = {
            type: event.type,
            timestamp: new Date().toISOString(),
          };

          // 确定步骤类型和状态
          let stepStatus = "";
          if (event.type === "workflow-start") {
            eventData.message = "Workflow started";
          } else if (event.type === "workflow-complete") {
            eventData.message = "Workflow completed successfully";
          } else if (event.type === "workflow-error") {
            eventData.message = "Workflow execution error";
            eventData.error = event.error?.message || "Unknown error";
          } else if (event.payload && event.payload.currentStep) {
            // 从payload.currentStep获取步骤信息
            const currentStep = event.payload.currentStep;
            eventData.stepId = currentStep.id;

            if (currentStep.status === "running") {
              stepStatus = "start";
              eventData.stepStatus = "start";
              eventData.message = `Starting step: ${currentStep.id}`;
            } else if (currentStep.status === "success") {
              stepStatus = "complete";
              eventData.stepStatus = "complete";
              eventData.message = `Completed step: ${currentStep.id}`;
            } else if (currentStep.status === "failed") {
              stepStatus = "failed";
              eventData.stepStatus = "failed";
              eventData.message = `Step execution failed: ${currentStep.id}`;
              eventData.error = currentStep.error?.message || "Unknown error";
            }

            // 为特定步骤添加详细信息
            if (stepStatus === "start") {
              switch (currentStep.id) {
                case "intent-recognition":
                case "prepare-intent-input":
                  eventData.detail = { message: "Recognizing user intent..." };
                  break;
                case "tool-selector":
                  eventData.detail = {
                    message: "Selecting appropriate DeFi data tool...",
                  };
                  break;
                case "process-tool-output":
                  eventData.detail = { message: "Processing tool output..." };
                  break;
                case "wrap-analysis-report":
                  eventData.detail = {
                    message: "Formatting analysis report...",
                  };
                  break;
                case "final-data-formatter":
                  eventData.detail = { message: "Finalizing result format..." };
                  break;
              }
            } else if (stepStatus === "complete") {
              switch (currentStep.id) {
                case "intent-recognition":
                  eventData.detail = {
                    intentRecognized: true,
                    processingToolSelection: true,
                    message: "User intent successfully recognized",
                  };
                  break;
                case "tool-selector":
                  eventData.detail = {
                    dataFetching: true,
                    message: "Fetching DeFi data...",
                  };
                  break;
                case "process-tool-output":
                  eventData.detail = {
                    analysisStarted: true,
                    message: "Analyzing DeFi investment opportunities...",
                  };
                  break;
                case "wrap-analysis-report":
                  eventData.detail = {
                    message: "Analysis report successfully compiled",
                  };
                  break;
                case "final-data-formatter":
                  eventData.detail = {
                    message: "Results formatted and ready to display",
                  };
                  break;
              }

              // 如果有数据且非敏感或过大，添加到事件中
              if (
                currentStep.output &&
                typeof currentStep.output === "object"
              ) {
                try {
                  // 只选择安全的元数据字段
                  if (currentStep.id === "intent-recognition") {
                    eventData.data = {
                      tool: currentStep.output.tool,
                      hasParams: !!currentStep.output.params,
                    };
                  } else if (currentStep.id === "tool-selector") {
                    eventData.data = {
                      selectedTool: currentStep.output.selectedTool,
                      poolsCount:
                        currentStep.output.toolOutput?.pools?.length || 0,
                    };
                  }
                } catch (e) {
                  console.log("[STREAM] Error extracting step data:", e);
                }
              }
            } else if (stepStatus === "failed") {
              eventData.detail = {
                message: "Error during analysis process",
              };
            }
          } else if (event.payload && event.payload.workflowState) {
            // 处理工作流状态变化事件
            const workflowState = event.payload.workflowState;
            if (workflowState.status === "success") {
              eventData.message = "Workflow execution successful";
            } else if (workflowState.status === "failed") {
              eventData.message = "Workflow execution failed";
              eventData.error =
                workflowState.error?.message || "Unknown workflow error";
            }
          }

          // 发送事件
          await stream.writeSSE({
            data: JSON.stringify(eventData),
            event: "workflowProgress",
          });
        });

        // 设置心跳定时器
        const heartbeatInterval = setInterval(async () => {
          try {
            await stream.writeSSE({
              data: JSON.stringify({ time: new Date().toISOString() }),
              event: "heartbeat",
            });
          } catch (error) {
            console.error("[STREAM] Error sending heartbeat:", error);
            clearInterval(heartbeatInterval);
          }
        }, 5000);

        // 设置超时
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Operation timeout"));
          }, 120000); // 2分钟超时
        });

        try {
          // 启动工作流，与超时竞争
          const workflowPromise = run.start({
            inputData: { query },
          });

          // 设置中断处理
          abortController.signal.addEventListener("abort", async () => {
            console.log(`[STREAM] Workflow aborted for runId: ${runId}`);

            // 发送中断事件给客户端
            try {
              await stream.writeSSE({
                data: JSON.stringify({
                  message: "Workflow aborted by user",
                  timestamp: new Date().toISOString(),
                }),
                event: "aborted",
              });
            } catch (error) {
              console.error(
                "[STREAM] Error sending abort notification:",
                error
              );
            }
          });

          const result = (await Promise.race([
            workflowPromise,
            timeoutPromise,
          ])) as any;

          // 清除心跳
          clearInterval(heartbeatInterval);

          // 发送结果
          await stream.writeSSE({
            data: JSON.stringify({
              steps: result.steps,
              summary: "Analysis completed",
            }),
            event: "stepResults",
          });

          await stream.writeSSE({
            data: JSON.stringify({
              success: true,
              result: "result" in result ? result.result : result,
            }),
            event: "complete",
          });

          // 删除中断控制器
          workflowAbortControllers.delete(runId);
        } catch (error: any) {
          // 清除心跳
          clearInterval(heartbeatInterval);

          if (error.message === "Operation timeout") {
            await stream.writeSSE({
              data: JSON.stringify({
                message: "Analysis operation timed out",
                error: "Processing time exceeded 2 minutes",
              }),
              event: "error",
            });
          } else {
            await stream.writeSSE({
              data: JSON.stringify({
                message: "Error processing DeFi analysis",
                error: error.message || String(error),
              }),
              event: "error",
            });
          }

          // 删除中断控制器
          workflowAbortControllers.delete(runId);
        }
      } catch (error: any) {
        console.error("[STREAM] Unexpected error in streamSSE:", error);
        await stream.writeSSE({
          data: JSON.stringify({
            message: "Internal server error",
            details: error instanceof Error ? error.message : String(error),
          }),
          event: "error",
        });
      }
    },
    async (err, stream) => {
      // 错误处理
      console.error("[STREAM] Stream error:", err);
      await stream.writeSSE({
        data: JSON.stringify({
          message: "Stream processing error",
          error: err instanceof Error ? err.message : String(err),
        }),
        event: "error",
      });
    }
  );
});

// // 获取代币详情API接口
// api.get("/coin/details", async (c) => {
//   const cgId = c.req.query("cgId") as string;
//   const details = await coinGeckoService.getCoinDetailsAndStore(cgId);
//   return c.json(details);
// });

// 将 API 路由挂载到主应用
app.route("/", api);

// 在开发环境下，服务启动时初始化应用
if (process.env.NODE_ENV === "development") {
  // 启动定时任务
  setupDefiLlamaSyncCronJobs();
  console.log("Development environment: Data sync cron jobs started.");

  // 开发环境启动时，立即执行一次核心数据同步
  (async () => {
    console.log("Development environment: Starting initial data sync...");

    // DeFiLlama Sync
    try {
      console.log("Development environment: Starting DeFiLlama data sync...");
      await defiLlamaSyncService.syncProtocols();
      await defiLlamaSyncService.syncPools();
      // await defiLlamaSyncService.syncStablecoins();
      console.log("Development environment: DeFiLlama data sync completed.");
    } catch (error) {
      console.error(
        "Development environment: DeFiLlama data sync failed:",
        error
      );
    }

    // CoinGecko Sync
    try {
      console.log("Development environment: Starting CoinGecko data sync...");
      await coinGeckoService.syncCoinsListAndPlatforms(); // Uses shared instance
      await coinGeckoService.syncTrendingCoinsCacheAndDetails(); // Uses shared instance
      console.log("Development environment: CoinGecko data sync completed.");
    } catch (error) {
      console.error(
        "Development environment: CoinGecko data sync failed:",
        error
      );
    }
    console.log("Development environment: Initial data sync process finished.");
  })();
} else {
  // 生产环境逻辑
  console.log(
    "Production environment: Data sync tasks will be managed by cron triggers."
  );
}

// 启动服务器
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
console.log(`Server starting on port ${port}`);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  }
);
