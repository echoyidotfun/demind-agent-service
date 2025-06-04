import { CronJob } from "cron";
import { DeFiLlamaSyncService } from "../../services/defiLlamaSync.service";
import { prisma } from "../db/client";

export function setupDefiLlamaSyncCronJobs() {
  const defillamaSyncService = new DeFiLlamaSyncService();

  // 每天凌晨 1 点同步协议数据（完整同步，频率较低）
  new CronJob(
    "0 1 * * *",
    async () => {
      console.log(
        "DeFiLlamaSyncTask: Executing DeFiLlama protocol data daily sync..."
      );
      try {
        await defillamaSyncService.syncProtocols();
      } catch (error) {
        console.error(
          "DeFiLlamaSyncTask: DeFiLlama protocol data sync failed:",
          error
        );
      }
    },
    null,
    true
  );

  // 每 4 小时同步资金池数据（APY 变化较快）
  new CronJob(
    "0 */4 * * *",
    async () => {
      console.log("DeFiLlamaSyncTask: Executing DeFiLlama pool data sync...");
      try {
        await defillamaSyncService.syncPools();
      } catch (error) {
        console.error(
          "DeFiLlamaSyncTask: DeFi Llama pool data sync failed:",
          error
        );
      }
    },
    null,
    true
  );

  // 每小时同步高收益/高 TVL 资金池的历史数据
  new CronJob(
    "0 * * * *",
    async () => {
      console.log(
        "DeFiLlamaSyncTask: Executing DeFi Llama high-yield pool historical data sync..."
      );
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
          await defillamaSyncService.syncPoolChart(pool.id);
        }
      } catch (error) {
        console.error(
          "DeFiLlamaSyncTask: DeFi Llama pool historical data sync failed:",
          error
        );
      }
    },
    null,
    true
  );

  // 每 6 小时同步稳定币数据
  new CronJob(
    "0 */6 * * *",
    async () => {
      console.log(
        "DeFiLlamaSyncTask: Executing DeFiLlama stablecoin data sync..."
      );
      try {
        await defillamaSyncService.syncStablecoins();
      } catch (error) {
        console.error(
          "DeFiLlamaSyncTask: DeFiLlama stablecoin data sync failed:",
          error
        );
      }
    },
    null,
    true
  );

  console.log(
    "DeFiLlamaSyncTask: DeFiLlama data sync cron jobs set up successfully."
  );
}
