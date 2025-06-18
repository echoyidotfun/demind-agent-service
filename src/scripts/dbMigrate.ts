import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * 此脚本用于在生产环境中执行数据库迁移
 * 可以通过直接导入或作为独立脚本运行
 */

export async function deployMigration() {
  console.log("开始数据库迁移部署流程...");

  // 检查环境变量
  if (!process.env.DATABASE_URL) {
    console.error("错误: 未找到 DATABASE_URL 环境变量");
    return false;
  }

  try {
    // 检查数据库连接
    const prisma = new PrismaClient();
    await prisma.$connect();
    console.log("数据库连接成功");

    // 检查表是否存在
    try {
      console.log("检查数据库表是否存在...");
      await prisma.$queryRaw`SELECT * FROM "Protocol" LIMIT 1`;
      await prisma.$queryRaw`SELECT * FROM "cg_coins_index" LIMIT 1`;
      console.log("数据库表已存在，无需迁移");
      await prisma.$disconnect();
      return true;
    } catch (e) {
      console.log("数据库表不存在，开始执行迁移...");
    }

    // 安全关闭连接
    await prisma.$disconnect();

    // 在生产环境中尝试使用 prisma db push
    console.log("使用 Prisma db push 创建数据库架构...");

    if (process.env.NODE_ENV === "production") {
      // 执行 Prisma Schema Push
      try {
        console.log("在生产环境中执行 db push...");
        execSync("npx prisma db push --accept-data-loss --skip-generate", {
          stdio: "inherit",
        });
        console.log("数据库架构创建成功");
        return true;
      } catch (dbPushError) {
        console.error("Prisma db push 失败:", dbPushError);
        return false;
      }
    } else {
      // 在开发环境中，使用 prisma migrate dev
      try {
        console.log("在开发环境中执行 migrate dev...");
        execSync("npx prisma migrate dev --name init", { stdio: "inherit" });
        console.log("数据库迁移完成");
        return true;
      } catch (migrateError) {
        console.error("Prisma migrate dev 失败:", migrateError);
        return false;
      }
    }
  } catch (error) {
    console.error("数据库迁移部署失败:", error);
    return false;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  deployMigration()
    .then((result) => {
      if (result) {
        console.log("数据库迁移脚本执行成功");
        process.exit(0);
      } else {
        console.error("数据库迁移脚本执行失败");
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("数据库迁移脚本发生错误:", error);
      process.exit(1);
    });
}
