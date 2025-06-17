import { CronJob } from "cron";
import { CoinGeckoService } from "../../services/coingeckoSync.service";
import { executeSyncTask } from "./syncUtils";

/**
 * 设置 CoinGecko 数据同步的定时任务
 * - 币种基础列表: 每24小时同步一次
 * - 热门币种: 每2小时同步一次
 */
export function setupCoinGeckoSyncCronJobs() {
  const coinGeckoService = new CoinGeckoService();

  // 每天凌晨 2 点同步所有币种基础信息（完整列表和平台信息）
  new CronJob(
    "0 2 * * *",
    async () => {
      await executeSyncTask(
        "CoinGecko币种列表同步",
        async () => {
          console.log(
            "CoinGeckoSyncTask: 执行 CoinGecko 币种列表和平台数据同步..."
          );
          const result = await coinGeckoService.syncCoinsListAndPlatforms();
          console.log(
            "CoinGeckoSyncTask: CoinGecko 币种列表和平台数据同步完成"
          );
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

  // 每 2 小时在 30 分同步热门币种和它们的详情
  new CronJob(
    "30 */2 * * *",
    async () => {
      await executeSyncTask(
        "CoinGecko热门币种同步",
        async () => {
          console.log("CoinGeckoSyncTask: 执行 CoinGecko 热门币种数据同步...");
          const result =
            await coinGeckoService.syncTrendingCoinsCacheAndDetails();
          console.log("CoinGeckoSyncTask: CoinGecko 热门币种数据同步完成");
          return result;
        },
        {
          maxRetries: 2,
          initialDelay: 5000, // 5秒
          backoffFactor: 2,
        }
      );
    },
    null,
    true
  );

  console.log("CoinGeckoSyncTask: CoinGecko 数据同步定时任务设置成功");
}
