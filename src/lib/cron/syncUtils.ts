/**
 * 同步任务的工具函数
 */

// 重试配置
interface RetryConfig {
  maxRetries: number; // 最大重试次数
  initialDelay: number; // 初始延迟(ms)
  backoffFactor: number; // 退避因子
}

// 默认重试配置
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 5000, // 5秒
  backoffFactor: 2, // 指数退避
};

/**
 * 带重试功能的异步任务执行函数
 * @param taskName 任务名称
 * @param task 要执行的异步任务函数
 * @param retryConfig 重试配置
 */
export async function executeWithRetry<T>(
  taskName: string,
  task: () => Promise<T>,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | unknown;
  let retryCount = 0;
  let delay = retryConfig.initialDelay;

  while (retryCount <= retryConfig.maxRetries) {
    try {
      if (retryCount > 0) {
        console.log(
          `[${taskName}] 重试第 ${retryCount}/${retryConfig.maxRetries} 次...`
        );
      }
      return await task();
    } catch (error) {
      lastError = error;
      retryCount++;

      if (retryCount <= retryConfig.maxRetries) {
        console.warn(
          `[${taskName}] 执行失败，将在 ${delay / 1000} 秒后重试: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= retryConfig.backoffFactor; // 指数退避策略
      } else {
        console.error(
          `[${taskName}] 达到最大重试次数 (${retryConfig.maxRetries})，任务失败:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  throw lastError;
}

/**
 * 带监控功能的同步任务包装器
 * @param taskName 任务名称
 * @param syncTask 同步任务函数
 * @param retryConfig 重试配置
 */
export async function executeSyncTask<T>(
  taskName: string,
  syncTask: () => Promise<T>,
  retryConfig?: RetryConfig
): Promise<T | null> {
  console.log(`[${taskName}] 开始执行...`);
  const startTime = Date.now();

  try {
    const result = await executeWithRetry(taskName, syncTask, retryConfig);
    const duration = (Date.now() - startTime) / 1000;
    console.log(`[${taskName}] 成功完成，耗时 ${duration.toFixed(2)} 秒`);
    return result;
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    console.error(
      `[${taskName}] 最终失败，耗时 ${duration.toFixed(2)} 秒:`,
      error instanceof Error ? error.message : String(error)
    );

    // 这里可以添加错误通知逻辑
    // sendErrorNotification(taskName, error);

    return null;
  }
}

/**
 * 发送错误通知（示例，未实现）
 * 在生产环境可以连接到监控系统如 Sentry、Slack 通知等
 */
// function sendErrorNotification(taskName: string, error: unknown): void {
//   // 实现错误通知逻辑
//   console.error(`需要通知: ${taskName} 失败:`, error);
// }
