import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Mastra } from "@mastra/core";
import { DefiRadarAgent } from "./ai/agents/defiRadar.agent";
import { setupDefiLlamaSyncCronJobs } from "./lib/cron/defiLlamaSyncTask";
import { DeFiLlamaSyncService } from "./services/defiLlamaSync.service";
import { CoinGeckoService } from "./services/coingeckoSync.service";

const defiLlamaSyncService = new DeFiLlamaSyncService();
const coinGeckoService = new CoinGeckoService();

// Initialize Mastra and register the agent
const mastra = new Mastra({
  agents: { DefiRadarAgent },
});

// 创建 Hono 应用
const app = new Hono();

// 启用 CORS
app.use(
  "/*",
  cors({
    origin: ["http://localhost:3000", "https://your-frontend-domain.com"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    maxAge: 86400,
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

// 健康检查路由
app.get("/health", (c) => c.json({ status: "ok" }));

// API 路由分组
const api = new Hono().basePath("/api/v1");

// Agent Chat API Route
api.post("/agent/chat", async (c) => {
  try {
    const { message, userId, threadId } = await c.req.json();

    if (!message) {
      return c.json({ error: "Message is required" }, 400);
    }

    // Simple generation for now, without explicit memory/thread management via API
    // Mastra's agent.generate will use any configured memory internally if set up on the agent.
    const response = await DefiRadarAgent.generate([
      { role: "user", content: message },
    ]);

    // The response from agent.generate is typically the direct text response or structured output.
    // For more complex interactions including tool calls, the structure might differ or need streaming.
    // For now, we assume it's a text response suitable for chat.
    return c.json({ reply: response });
  } catch (error: any) {
    console.error("Agent chat API error:", error);
    return c.json(
      {
        success: false,
        message: "Agent chat failed",
        error: error.message || String(error),
      },
      500
    );
  }
});

// 添加 DefiRadar 调试专用接口
api.post("/debug/defiRadar", async (c) => {
  try {
    const { query, maxSteps = 10 } = await c.req.json();

    if (!query) {
      return c.json({ error: "Query is required" }, 400);
    }

    console.log(`[DEBUG] DefiRadar Agent processing query: "${query}"`);

    // 创建一个更详细的响应，包含工具调用信息
    const steps: any[] = [];
    const response = await DefiRadarAgent.generate(
      [{ role: "user", content: query }],
      {
        maxSteps,
        onStepFinish: ({ text, toolCalls, toolResults }) => {
          // 记录每个步骤的信息
          const stepInfo = {
            text:
              text?.substring(0, 200) +
              (text && text.length > 200 ? "..." : ""),
            toolCalls:
              toolCalls?.map((call) => ({
                type: call.type,
                tool: call.type === "tool-call" ? call.toolName : "none",
                args: call.type === "tool-call" ? call.args : {},
              })) || [],
            hasResults: !!toolResults?.length,
          };

          steps.push(stepInfo);
          console.log(
            `[DEBUG] Step ${steps.length} completed:`,
            JSON.stringify(stepInfo, null, 2)
          );
        },
      }
    );

    return c.json({
      reply: response.text,
      steps,
      totalSteps: steps.length,
      success: true,
    });
  } catch (error: any) {
    console.error("[DEBUG] DefiRadar Agent error:", error);
    return c.json(
      {
        success: false,
        message: "DefiRadar Agent debug failed",
        error: error.message || String(error),
      },
      500
    );
  }
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
