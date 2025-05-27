import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { setupDefiLlamaSyncCronJobs } from "./lib/cron/defiLlamaSyncTask";
import { findHighYieldPools } from "./agents/tools/defiLlama.tool";
import { DeFiLlamaSyncService } from "./services/defiLlamaSync.service";

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
    console.error("查询高收益机会失败:", error);
    return c.json(
      { success: false, message: "查询失败", error: String(error) },
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
  console.log("开发环境：已启动数据同步定时任务");

  // 开发环境启动时，立即执行一次核心数据同步
  (async () => {
    console.log("开发环境：开始执行启动时数据同步...");
    const syncService = new DeFiLlamaSyncService();
    try {
      await syncService.syncProtocols();
      await syncService.syncPools();
      // await syncService.syncStablecoins();
      console.log("开发环境：启动时数据同步完成。");
    } catch (error) {
      console.error("开发环境：启动时数据同步失败:", error);
    }
  })();
} else {
  // 生产环境逻辑
  console.log("生产环境：数据同步任务将由定时触发器管理");
}

// 启动服务器
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
console.log(`服务器启动在端口 ${port}`);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  }
);
