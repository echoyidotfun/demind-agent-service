import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { setupDefiLlamaSyncCronJobs } from "./lib/cron/defiLlamaSyncTask";
import { findHighYieldPools } from "./agents/tools/defiLlama.tool";
import { DeFiLlamaSyncService } from "./services/defiLlamaSync.service";
import { CoinGeckoService } from "./services/coingeckoSync.service";

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

// 机会发现查询 API
api.get("/opportunities/high-yield", async (c) => {
  const chain = c.req.query("chain");
  const minTvlUsd = Number(c.req.query("minTvl")) || 10000;
  const minApy = Number(c.req.query("minApy")) || 5;
  const limit = Math.min(Number(c.req.query("limit")) || 10, 100);
  const stablecoinOnly = c.req.query("stablecoinOnly") === "true";

  // 直接调用业务逻辑函数
  try {
    const result = await findHighYieldPools({
      chain,
      minTvlUsd,
      minApy,
      limit,
      stablecoinOnly,
    });
    return c.json(result);
  } catch (error) {
    console.error("Failed to query high-yield opportunities:", error);
    return c.json(
      { success: false, message: "Query failed", error: String(error) },
      500
    );
  }
});

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
    // const defiLlamaSyncService = new DeFiLlamaSyncService();
    // try {
    //   console.log("Development environment: Starting DeFiLlama data sync...");
    //   await defiLlamaSyncService.syncProtocols();
    //   await defiLlamaSyncService.syncPools();
    //   // await defiLlamaSyncService.syncStablecoins();
    //   console.log("Development environment: DeFiLlama data sync completed.");
    // } catch (error) {
    //   console.error(
    //     "Development environment: DeFiLlama data sync failed:",
    //     error
    //   );
    // }

    // CoinGecko Sync
    const coinGeckoService = new CoinGeckoService();
    try {
      console.log("Development environment: Starting CoinGecko data sync...");
      await coinGeckoService.syncCoinsListAndPlatforms();
      await coinGeckoService.syncTrendingCoinsCacheAndDetails();
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
