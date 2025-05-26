import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { ToolRegistry } from "@mastra/core";
import { setupDefiLlamaSyncCronJobs } from "./lib/cron/defiLlamaSyncTask";
import { registerDefiLlamaTools } from "./agents/tools/defiLlama.tool";

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

// 手动执行数据同步路由（仅在开发环境使用，生产环境应使用定时任务）
// 此路由应被身份验证和授权中间件保护
import { DeFiLlamaSyncService } from "./services/defiLlamaSync.service";

api.post("/sync/protocols", async (c) => {
  try {
    const syncService = new DeFiLlamaSyncService();
    await syncService.syncProtocols();
    return c.json({ success: true, message: "协议数据同步成功" });
  } catch (error) {
    console.error("同步失败:", error);
    return c.json(
      { success: false, message: "同步失败", error: String(error) },
      500
    );
  }
});

api.post("/sync/pools", async (c) => {
  try {
    const syncService = new DeFiLlamaSyncService();
    await syncService.syncPools();
    return c.json({ success: true, message: "资金池数据同步成功" });
  } catch (error) {
    console.error("同步失败:", error);
    return c.json(
      { success: false, message: "同步失败", error: String(error) },
      500
    );
  }
});

api.post("/sync/stablecoins", async (c) => {
  try {
    const syncService = new DeFiLlamaSyncService();
    await syncService.syncStablecoins();
    return c.json({ success: true, message: "稳定币数据同步成功" });
  } catch (error) {
    console.error("同步失败:", error);
    return c.json(
      { success: false, message: "同步失败", error: String(error) },
      500
    );
  }
});

// 机会发现查询 API
api.get("/opportunities/high-yield", async (c) => {
  const chain = c.req.query("chain");
  const minTvlUsd = Number(c.req.query("minTvl")) || 10000;
  const minApy = Number(c.req.query("minApy")) || 5;
  const limit = Math.min(Number(c.req.query("limit")) || 10, 100);
  const stablecoinOnly = c.req.query("stablecoinOnly") === "true";

  // 这里手动调用工具逻辑，实际生产代码应考虑从 tools 复用逻辑或抽取到 service 层
  try {
    const { findHighYieldPools } = await import(
      "./agents/tools/defiLlama.tool"
    );
    const result = await findHighYieldPools.handler({
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

// 初始化 Mastra 工具注册表
const toolRegistry = new ToolRegistry();
registerDefiLlamaTools(toolRegistry);

// 在开发环境下，服务启动时初始化应用
if (process.env.NODE_ENV === "development") {
  // 启动定时任务
  setupDefiLlamaSyncCronJobs();

  console.log("开发环境：已启动数据同步任务");
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
