import { PrismaClient } from "@prisma/client";

// 使用单例模式确保整个应用中只有一个 PrismaClient 实例
declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma =
  global.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

export default prisma;
