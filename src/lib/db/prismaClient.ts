import { PrismaClient, Prisma } from "@prisma/client";

console.log("Prisma 客户端初始化开始...");

// 添加初始化诊断信息
console.log({
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL_EXISTS: !!process.env.DATABASE_URL,
  DATABASE_URL_PREFIX: process.env.DATABASE_URL
    ? process.env.DATABASE_URL.substring(0, 20) + "..."
    : undefined,
});

// 设置生产环境优化选项
const prismaProductionOptions: Prisma.PrismaClientOptions = {
  log: [{ level: "error", emit: "stdout" }],
  // 添加生产环境连接池配置
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
};

const prismaDevelopmentOptions: Prisma.PrismaClientOptions = {
  log: [
    { level: "error", emit: "stdout" },
    { level: "warn", emit: "stdout" },
    { level: "info", emit: "stdout" }, // 添加更多日志级别以便调试
  ],
  // 开发环境连接池配置
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
};

// 根据环境选择恰当的选项
const options =
  process.env.NODE_ENV === "production"
    ? prismaProductionOptions
    : prismaDevelopmentOptions;

// 单例模式实现，对容器环境更友好
let prismaInstance: PrismaClient | undefined = undefined;

function getPrismaInstance(): PrismaClient {
  if (!prismaInstance) {
    try {
      console.log("创建新的 Prisma 客户端实例...");
      prismaInstance = new PrismaClient(options);
      console.log("Prisma 客户端实例创建成功");
    } catch (error) {
      console.error("创建 Prisma 客户端实例失败:", error);
      throw new Error(
        `Prisma 客户端初始化失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return prismaInstance;
}

// 获取单例实例
const prisma = getPrismaInstance();

// 添加连接检查和处理功能
export async function checkPrismaConnection(): Promise<boolean> {
  try {
    // 执行简单查询来检查连接
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error("Prisma 连接检查失败:", error);
    return false;
  }
}

// 优雅关闭函数，用于应用关闭时清理连接
export async function disconnectPrisma(): Promise<void> {
  try {
    if (prismaInstance) {
      await prismaInstance.$disconnect();
      console.log("Prisma 连接已关闭");
      prismaInstance = undefined;
    }
  } catch (error) {
    console.error("关闭 Prisma 连接时出错:", error);
    throw error;
  }
}

// 在进程退出时关闭数据库连接
process.on("SIGINT", async () => {
  console.log("收到 SIGINT 信号，正在关闭 Prisma 连接...");
  await disconnectPrisma();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("收到 SIGTERM 信号，正在关闭 Prisma 连接...");
  await disconnectPrisma();
  process.exit(0);
});

export default prisma;
export { prisma };
