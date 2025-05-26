import { CronJob } from "cron";
import { DeFiLlamaSyncService } from "../../services/defiLlamaSync.service";
import { prisma } from "../db/client";

export function setupDefiLlamaSyncCronJobs() {
  const syncService = new DeFiLlamaSyncService();

  // 每天凌晨 1 点同步协议数据（完整同步，频率较低）
  new CronJob(
    "0 1 * * *",
    async () => {
      console.log("执行 DeFi Llama 协议数据每日同步...");
      try {
        await syncService.syncProtocols();
      } catch (error) {
        console.error("DeFi Llama 协议数据同步失败:", error);
      }
    },
    null,
    true
  );

  // 每 4 小时同步资金池数据（APY 变化较快）
  new CronJob(
    "0 */4 * * *",
    async () => {
      console.log("执行 DeFi Llama 资金池数据同步...");
      try {
        await syncService.syncPools();
      } catch (error) {
        console.error("DeFi Llama 资金池数据同步失败:", error);
      }
    },
    null,
    true
  );

  // 每小时同步高收益/高 TVL 资金池的历史数据
  new CronJob(
    "0 * * * *",
    async () => {
      console.log("执行 DeFi Llama 高收益资金池历史数据同步...");
      try {
        // 每小时只查询最新的高收益池子
        const topPools = await prisma.pool.findMany({
          where: {
            tvlUsd: { gt: 1000000 }, // TVL > $1M
            apy: { gt: 10 }, // APY > 10%
          },
          orderBy: { apy: "desc" },
          take: 20,
        });

        for (const pool of topPools) {
          await syncService.syncPoolChart(pool.id);
        }
      } catch (error) {
        console.error("DeFi Llama 资金池历史数据同步失败:", error);
      }
    },
    null,
    true
  );

  // 每 6 小时同步稳定币数据
  new CronJob(
    "0 */6 * * *",
    async () => {
      console.log("执行 DeFi Llama 稳定币数据同步...");
      try {
        await syncService.syncStablecoins();
      } catch (error) {
        console.error("DeFi Llama 稳定币数据同步失败:", error);
      }
    },
    null,
    true
  );

  console.log("已设置 DeFi Llama 数据同步定时任务");
}
