import { PrismaClient, Prisma } from "@prisma/client";

// 设置生产环境优化选项
const prismaProductionOptions: Prisma.PrismaClientOptions = {
  log: [{ level: "error", emit: "stdout" }],
  // Serverless环境下通常不需要额外的连接池配置
};

const prismaDevelopmentOptions: Prisma.PrismaClientOptions = {
  log: [
    { level: "error", emit: "stdout" },
    { level: "warn", emit: "stdout" },
  ],
};

// 使用单例模式确保整个应用中只有一个 PrismaClient 实例
declare global {
  var prisma: PrismaClient | undefined;
}

// 创建 Prisma 客户端实例
export const prisma =
  global.prisma ||
  new PrismaClient(
    process.env.NODE_ENV === "production"
      ? prismaProductionOptions
      : prismaDevelopmentOptions
  );

// 在开发环境中重用 Prisma 客户端
if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

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
    await prisma.$disconnect();
    console.log("Prisma 连接已关闭");
  } catch (error) {
    console.error("关闭 Prisma 连接时出错:", error);
    throw error;
  }
}

export default prisma;
