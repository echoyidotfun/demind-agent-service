import { CronJob } from "cron";
import { DeFiLlamaSyncService } from "../../services/defiLlamaSync.service";
import { executeSyncTask } from "./syncUtils";

/**
 * 设置 DeFiLlama 数据同步的定时任务
 * - 协议列表 (Protocols): 每 12 小时同步一次
 * - 流动性池 (Pools): 每 4 小时同步一次
 * - 稳定币 (Stablecoins): 每天同步一次
 */
export function setupDefiLlamaSyncCronJobs() {
  const defillamaSyncService = new DeFiLlamaSyncService();

  // 每 12 小时在 15 分同步协议数据
  new CronJob(
    "15 */12 * * *",
    async () => {
      await executeSyncTask(
        "DeFiLlama协议同步",
        async () => {
          console.log("DeFiLlamaSyncTask: 执行 DeFiLlama 协议数据同步...");
          const result = await defillamaSyncService.syncProtocols();
          console.log("DeFiLlamaSyncTask: DeFiLlama 协议数据同步完成");
          return result;
        },
        {
          maxRetries: 3,
          initialDelay: 10000, // 10秒
          backoffFactor: 2,
        }
      );
    },
    null,
    true
  );

  // 每 4 小时在 45 分同步资金池数据（APY 变化较快）
  new CronJob(
    "45 */4 * * *",
    async () => {
      await executeSyncTask(
        "DeFiLlama资金池同步",
        async () => {
          console.log("DeFiLlamaSyncTask: 执行 DeFiLlama 资金池数据同步...");
          const result = await defillamaSyncService.syncPools();
          console.log("DeFiLlamaSyncTask: DeFiLlama 资金池数据同步完成");
          return result;
        },
        {
          maxRetries: 2,
          initialDelay: 15000, // 15秒
          backoffFactor: 2,
        }
      );
    },
    null,
    true
  );

  // 每天凌晨 3 点同步稳定币数据
  new CronJob(
    "0 3 * * *",
    async () => {
      await executeSyncTask("DeFiLlama稳定币同步", async () => {
        console.log("DeFiLlamaSyncTask: 执行 DeFiLlama 稳定币数据同步...");
        const result = await defillamaSyncService.syncStablecoins();
        console.log("DeFiLlamaSyncTask: DeFiLlama 稳定币数据同步完成");
        return result;
      });
    },
    null,
    true
  );

  console.log("DeFiLlamaSyncTask: DeFiLlama 数据同步定时任务设置成功");
}
