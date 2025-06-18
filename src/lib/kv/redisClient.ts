import { createClient, RedisClientType } from "redis";

// 全局变量
let redisClient: RedisClientType | null = null;
let clientPromise: Promise<RedisClientType> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10; // 增加到10次
const RECONNECT_DELAY_MS = 5000; // 5秒
const HEALTH_CHECK_INTERVAL_MS = 30000; // 30秒健康检查间隔

// 生产环境和开发环境配置
const getRedisConfig = () => {
  const baseConfig = {
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy: (retries: number) => {
        if (retries > MAX_RECONNECT_ATTEMPTS) {
          console.error(
            `Redis连接失败，已达到最大重试次数(${MAX_RECONNECT_ATTEMPTS})`
          );
          return new Error("Redis连接重试次数已用完");
        }

        // 指数退避策略，但最长不超过30秒
        const delay = Math.min(Math.pow(2, retries) * 1000, 30000);
        console.log(
          `Redis连接断开，${delay}毫秒后重试 (尝试 ${retries}/${MAX_RECONNECT_ATTEMPTS})`
        );
        return delay;
      },
      connectTimeout: 15000, // 15秒连接超时
    },
    // 避免在断线重连时出现堆积的命令
    commandsQueueMaxLength: 5000,
    // 启用离线队列
    disableOfflineQueue: false,
    // 添加性能优化
    readonly: false, // 除非是只读应用，否则应设为false
  };

  if (process.env.NODE_ENV === "production") {
    return {
      ...baseConfig,
      // 生产环境特定配置
      enableAutoPipelining: true, // 自动管道化提高吞吐量
    };
  }

  return baseConfig;
};

// 定期健康检查
let healthCheckInterval: NodeJS.Timeout | null = null;

// 启动健康检查
function startHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  healthCheckInterval = setInterval(async () => {
    try {
      const isConnected = await checkRedisConnection();
      if (!isConnected) {
        console.warn("Redis健康检查失败，尝试重新连接...");
        // 强制重置连接
        await resetConnection();
      }
    } catch (error) {
      console.error("Redis健康检查出错:", error);
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  // 确保定时器不阻止进程退出
  healthCheckInterval.unref();
}

// 重置连接的函数
async function resetConnection(): Promise<void> {
  try {
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
    }
  } catch (error) {
    console.error("关闭Redis连接失败:", error);
  } finally {
    redisClient = null;
    clientPromise = null;
    reconnectAttempts = 0;
  }
}

async function getConnectedClient(): Promise<RedisClientType> {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  if (!clientPromise) {
    if (!process.env.REDIS_URL) {
      throw new Error("REDIS_URL环境变量未设置");
    }

    const newClient = createClient(getRedisConfig());

    // 监听事件
    newClient.on("error", (err) => {
      console.error("Redis客户端错误:", err);
    });

    newClient.on("reconnecting", () => {
      console.log("Redis尝试重新连接...");
    });

    newClient.on("connect", () => {
      console.log("Redis已建立连接");
      reconnectAttempts = 0; // 重置重试计数
    });

    newClient.on("ready", () => {
      console.log("Redis客户端已就绪");
      // 启动健康检查
      startHealthCheck();
    });

    newClient.on("end", () => {
      console.log("Redis连接已终止");
      // 清除健康检查
      if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
      }
    });

    clientPromise = newClient
      .connect()
      .then((connectedClient: any) => {
        redisClient = connectedClient as RedisClientType;
        console.log("Redis连接成功");
        return redisClient;
      })
      .catch((err) => {
        console.error("Redis连接失败:", err);
        clientPromise = null; // 重置Promise以允许重试
        throw err;
      });
  }
  return clientPromise;
}

// 添加连接检查功能
export async function checkRedisConnection(): Promise<boolean> {
  try {
    const client = await getConnectedClient();
    // 设置测试键
    const testKey = "health_check_" + Date.now();
    await client.set(testKey, "ok", { EX: 5 });
    const value = await client.get(testKey);
    await client.del(testKey);
    return value === "ok";
  } catch (error) {
    console.error("Redis连接检查失败:", error);
    return false;
  }
}

// Wrapper object that mimics the @vercel/kv client API for get and set
export const redis = {
  async get<T = any>(
    key: string,
    parseJson: boolean = true
  ): Promise<T | null> {
    const client = await getConnectedClient();
    const value = await client.get(key);
    if (value === null) return null;

    // 只有在parseJson为true时才尝试解析JSON
    if (parseJson) {
      try {
        // Attempt to parse if it's JSON, otherwise return as string
        return JSON.parse(value) as T;
      } catch (e) {
        // 如果解析失败，并且期望的是JSON，则记录警告。
        // 如果不期望JSON，或者值本身就是有效字符串，则直接返回。
        console.warn(
          `Redis value for key=${key} is not valid JSON or parseJson was true but value is not JSON:`,
          e
        );
        return value as any as T; // Return as string if not valid JSON and parseJson was true
      }
    } else {
      // 不解析，直接返回原始字符串
      return value as any as T;
    }
  },

  async set<T = any>(
    key: string,
    value: T,
    options?: { ex?: number; px?: number; nx?: boolean; xx?: boolean }
  ): Promise<string | null> {
    const client = await getConnectedClient();
    const stringValue =
      typeof value === "string" ? value : JSON.stringify(value);
    const redisOptions: any = {};
    if (options?.ex) redisOptions.EX = options.ex;
    if (options?.px) redisOptions.PX = options.px;
    if (options?.nx) redisOptions.NX = options.nx;
    if (options?.xx) redisOptions.XX = options.xx;

    return client.set(key, stringValue, redisOptions);
  },

  async hget<T = any>(
    key: string,
    field: string,
    parseJson: boolean = true
  ): Promise<T | null> {
    const client = await getConnectedClient();
    const value = await client.hGet(key, field);
    if (value === null || value === undefined) return null;

    if (parseJson) {
      try {
        return JSON.parse(value) as T;
      } catch (e) {
        console.warn(
          `Redis hash value for key=${key}, field=${field} is not valid JSON or parseJson was true but value is not JSON:`,
          e
        );
        return value as any as T;
      }
    } else {
      return value as any as T;
    }
  },

  async hset(key: string, field: string, value: any): Promise<number> {
    const client = await getConnectedClient();
    const stringValue =
      typeof value === "string" ? value : JSON.stringify(value);
    return client.hSet(key, field, stringValue);
  },

  async hgetall<T = any>(
    key: string,
    parseJson: boolean = true
  ): Promise<Record<string, T> | null> {
    const client = await getConnectedClient();
    const values = await client.hGetAll(key);

    if (!values || Object.keys(values).length === 0) return null;

    const result: Record<string, any> = {};
    for (const [field, value] of Object.entries(values)) {
      if (parseJson) {
        try {
          result[field] = JSON.parse(value) as T;
        } catch (e) {
          // If parsing fails, store the raw string value
          result[field] = value;
        }
      } else {
        result[field] = value;
      }
    }
    return result as Record<string, T>;
  },

  async del(key: string): Promise<number> {
    const client = await getConnectedClient();
    return client.del(key);
  },

  // Expose a way to explicitly close the connection if needed (e.g., for tests or shutdown)
  async quit(): Promise<void> {
    if (clientPromise) {
      try {
        const client = await clientPromise;
        // 停止健康检查
        if (healthCheckInterval) {
          clearInterval(healthCheckInterval);
          healthCheckInterval = null;
        }
        await client.quit();
        redisClient = null;
        clientPromise = null;
        console.log("Redis连接已关闭");
      } catch (err) {
        console.error("关闭Redis连接时出错:", err);
      }
    }
  },

  // 添加重置连接方法
  resetConnection,
};

// 处理进程退出信号
process.on("SIGINT", async () => {
  console.log("收到 SIGINT 信号，正在关闭 Redis 连接...");
  await redis.quit();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("收到 SIGTERM 信号，正在关闭 Redis 连接...");
  await redis.quit();
  process.exit(0);
});
