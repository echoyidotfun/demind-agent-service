import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Mastra } from "@mastra/core";
import { streamSSE } from "hono/streaming";
import {
  intentAgent,
  reportGeneralAgent,
  reportTrendingAgent,
} from "./ai/agents/defiRadar.agent";
import { defiRadarWorkflow } from "./ai/workflows/defiRadar.workflow";
import { setupDefiLlamaSyncCronJobs } from "./lib/cron/defiLlamaSyncTask";
import { setupCoinGeckoSyncCronJobs } from "./lib/cron/coingeckoSyncTask";
import { DeFiLlamaSyncService } from "./services/defiLlamaSync.service";
import { CoinGeckoService } from "./services/coingeckoSync.service";
import { checkPrismaConnection } from "./lib/db/prismaClient";
import { checkRedisConnection } from "./lib/kv/redisClient";

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

const productionOrigins = ["https://demind.fun"];
const developmentOrigins = ["http://localhost:5500", "http://localhost:5501"];

// 启用 CORS
app.use(
  "/*",
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? productionOrigins
        : developmentOrigins,
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

// 健康检查端点
app.get("/health", async (c) => {
  const status = {
    service: "DeMind Agent API",
    status: "running",
    version: "1.0.0",
    db: "unknown",
    redis: "unknown",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  };

  // 检查数据库连接
  try {
    const isConnected = await checkPrismaConnection();
    status.db = isConnected ? "connected" : "disconnected";
    if (!isConnected) {
      status.status = "degraded";
    }
  } catch (error) {
    console.error("数据库健康检查失败:", error);
    status.db = "disconnected";
    status.status = "degraded";
  }

  // 检查Redis连接
  try {
    const isConnected = await checkRedisConnection();
    if (isConnected) {
      status.redis = "connected";
    } else {
      status.redis = "disconnected";
      status.status = "degraded";
    }
  } catch (error) {
    console.error("Redis健康检查失败:", error);
    status.redis = "disconnected";
    status.status = "degraded";
  }

  // 设置适当的HTTP状态码
  if (status.status === "degraded") {
    return c.json(status, 503); // Service Unavailable
  }
  return c.json(status);
});

// 详细健康检查端点，用于运维监控
app.get("/health/detailed", async (c) => {
  const detailedStatus = {
    service: "DeMind Agent API",
    status: "running",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    components: {
      database: {
        status: "unknown",
        details: {},
      },
      redis: {
        status: "unknown",
        details: {},
      },
      services: {
        defiLlama: "unknown",
        coinGecko: "unknown",
      },
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  };

  // 检查数据库
  try {
    const start = Date.now();
    const isConnected = await checkPrismaConnection();
    const latency = Date.now() - start;

    detailedStatus.components.database = {
      status: isConnected ? "healthy" : "unhealthy",
      details: {
        connected: isConnected,
        latency: `${latency}ms`,
      },
    };
  } catch (error) {
    detailedStatus.components.database = {
      status: "unhealthy",
      details: {
        error: error instanceof Error ? error.message : String(error),
        connected: false,
      },
    };
  }

  // 检查Redis
  try {
    const start = Date.now();
    const isConnected = await checkRedisConnection();
    const latency = Date.now() - start;

    detailedStatus.components.redis = {
      status: isConnected ? "healthy" : "unhealthy",
      details: {
        connected: isConnected,
        latency: `${latency}ms`,
      },
    };
  } catch (error) {
    detailedStatus.components.redis = {
      status: "unhealthy",
      details: {
        error: error instanceof Error ? error.message : String(error),
        connected: false,
      },
    };
  }

  // 根据组件状态设置整体状态
  if (
    detailedStatus.components.database.status === "unhealthy" ||
    detailedStatus.components.redis.status === "unhealthy"
  ) {
    detailedStatus.status = "degraded";
    return c.json(detailedStatus, 503); // Service Unavailable
  }

  return c.json(detailedStatus);
});

const api = new Hono().basePath("/api/v1");

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
                case "tool-call":
                  eventData.detail = {
                    message: "Fetching DeFi data...",
                  };
                  break;
                case "agent-generate-report":
                  eventData.detail = {
                    message: "Mind analyzing...",
                  };
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
                    message: "Fetching finished",
                  };
                  break;
                case "agent-generate-report":
                  eventData.detail = {
                    analysisStarted: true,
                    message: "Mind is talking...",
                  };
                  break;
                case "wrap-analysis-report":
                  eventData.detail = {
                    message: "Analysis report checked",
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
                  if (currentStep.id === "tool-call") {
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
          }, 180000); // 3分钟超时
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

// 添加API密钥验证中间件
const verifyCronApiKey = async (c: any, next: any) => {
  // 检查请求头中的API密钥
  const apiKey = c.req.header("X-CRON-API-KEY");

  // 验证API密钥是否有效
  if (!apiKey || apiKey !== process.env.X_CRON_API_KEY) {
    return c.json(
      {
        success: false,
        message: "未授权访问",
        timestamp: new Date().toISOString(),
      },
      401
    );
  }

  // 密钥验证通过，继续处理请求
  return await next();
};

// 为高频率独立同步任务的API端点添加验证中间件
api.use("/cron/defillama-pools", verifyCronApiKey);
api.use("/cron/coingecko-trending", verifyCronApiKey);

// 为其他独立同步任务的API端点添加验证中间件（虽然已合并，但保留接口）
api.use("/cron/defillama-protocols", verifyCronApiKey);
api.use("/cron/defillama-stablecoins", verifyCronApiKey);
api.use("/cron/coingecko-coins", verifyCronApiKey);

// 合并的API端点（由Vercel Cron触发）不需要验证，因为它们受Vercel自身保护

// Vercel Cron 定时触发的合并任务端点
api.get("/cron/defillama-all", async (c) => {
  try {
    console.log("启动DeFiLlama全部数据异步同步");

    // 立即开始后台异步任务
    (async () => {
      try {
        // 按顺序执行所有DeFiLlama同步任务
        console.log("开始同步DeFiLlama协议数据...");
        await defiLlamaSyncService.syncProtocols();

        console.log("开始同步DeFiLlama资金池数据...");
        await defiLlamaSyncService.syncPools();

        console.log("开始同步DeFiLlama稳定币数据...");
        await defiLlamaSyncService.syncStablecoins();

        console.log("DeFiLlama全部数据同步已完成");
      } catch (error) {
        console.error("后台DeFiLlama数据同步失败:", error);
      }
    })();

    return c.json({
      success: true,
      message: "DeFiLlama全部数据同步任务已启动",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("启动DeFiLlama数据同步失败:", error);
    return c.json(
      {
        success: false,
        message: "启动DeFiLlama数据同步失败",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

api.get("/cron/coingecko-all", async (c) => {
  try {
    console.log("启动CoinGecko全部数据异步同步");

    // 立即开始后台异步任务
    (async () => {
      try {
        // 按顺序执行所有CoinGecko同步任务
        console.log("开始同步CoinGecko币种列表数据...");
        await coinGeckoService.syncCoinsListAndPlatforms();

        console.log("开始同步CoinGecko热门币种数据...");
        await coinGeckoService.syncTrendingCoinsCacheAndDetails();

        console.log("CoinGecko全部数据同步已完成");
      } catch (error) {
        console.error("后台CoinGecko数据同步失败:", error);
      }
    })();

    return c.json({
      success: true,
      message: "CoinGecko全部数据同步任务已启动",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("启动CoinGecko数据同步失败:", error);
    return c.json(
      {
        success: false,
        message: "启动CoinGecko数据同步失败",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

// 添加用于处理外部API调用的同步接口
api.get("/cron/defillama-protocols", async (c) => {
  try {
    console.log("启动DeFiLlama协议数据异步同步");

    // 立即开始后台异步任务
    (async () => {
      try {
        await defiLlamaSyncService.syncProtocols();
        console.log("DeFiLlama协议数据同步已完成");
      } catch (error) {
        console.error("后台DeFiLlama协议数据同步失败:", error);
      }
    })();

    return c.json({
      success: true,
      message: "DeFiLlama协议数据同步任务已启动",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("启动DeFiLlama协议数据同步失败:", error);
    return c.json(
      {
        success: false,
        message: "启动DeFiLlama协议数据同步失败",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

api.get("/cron/defillama-pools", async (c) => {
  try {
    console.log("启动DeFiLlama资金池数据异步同步");

    // 立即开始后台异步任务
    (async () => {
      try {
        await defiLlamaSyncService.syncPools();
        console.log("DeFiLlama资金池数据同步已完成");
      } catch (error) {
        console.error("后台DeFiLlama资金池数据同步失败:", error);
      }
    })();

    return c.json({
      success: true,
      message: "DeFiLlama资金池数据同步任务已启动",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("启动DeFiLlama资金池数据同步失败:", error);
    return c.json(
      {
        success: false,
        message: "启动DeFiLlama资金池数据同步失败",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

api.get("/cron/defillama-stablecoins", async (c) => {
  try {
    console.log("启动DeFiLlama稳定币数据异步同步");

    // 立即开始后台异步任务
    (async () => {
      try {
        await defiLlamaSyncService.syncStablecoins();
        console.log("DeFiLlama稳定币数据同步已完成");
      } catch (error) {
        console.error("后台DeFiLlama稳定币数据同步失败:", error);
      }
    })();

    return c.json({
      success: true,
      message: "DeFiLlama稳定币数据同步任务已启动",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("启动DeFiLlama稳定币数据同步失败:", error);
    return c.json(
      {
        success: false,
        message: "启动DeFiLlama稳定币数据同步失败",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

api.get("/cron/coingecko-coins", async (c) => {
  try {
    console.log("启动CoinGecko币种列表异步同步");

    // 立即开始后台异步任务
    (async () => {
      try {
        await coinGeckoService.syncCoinsListAndPlatforms();
        console.log("CoinGecko币种列表同步已完成");
      } catch (error) {
        console.error("后台CoinGecko币种列表同步失败:", error);
      }
    })();

    return c.json({
      success: true,
      message: "CoinGecko币种列表同步任务已启动",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("启动CoinGecko币种列表同步失败:", error);
    return c.json(
      {
        success: false,
        message: "启动CoinGecko币种列表同步失败",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

api.get("/cron/coingecko-trending", async (c) => {
  try {
    console.log("启动CoinGecko热门币种异步同步");

    // 立即开始后台异步任务
    (async () => {
      try {
        await coinGeckoService.syncTrendingCoinsCacheAndDetails();
        console.log("CoinGecko热门币种同步已完成");
      } catch (error) {
        console.error("后台CoinGecko热门币种同步失败:", error);
      }
    })();

    return c.json({
      success: true,
      message: "CoinGecko热门币种同步任务已启动",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("启动CoinGecko热门币种同步失败:", error);
    return c.json(
      {
        success: false,
        message: "启动CoinGecko热门币种同步失败",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

app.route("/", api);

// 设置定时同步任务
function setupSyncTasks() {
  // 设置 DeFiLlama 数据同步定时任务
  setupDefiLlamaSyncCronJobs();

  // 设置 CoinGecko 数据同步定时任务
  setupCoinGeckoSyncCronJobs();

  console.log("数据同步定时任务设置完成");
}

// 启动时，立即执行一次核心数据同步
const initialDataSync = async () => {
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
};

initialDataSync();

if (process.env.NODE_ENV === "production") {
  // 生产环境逻辑 - 设置定时任务
  console.log("Production environment: Setting up data sync cron jobs");
  setupSyncTasks();
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
