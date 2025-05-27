import { createClient, RedisClientType } from "redis";

let redisClient: RedisClientType | null = null;
let clientPromise: Promise<RedisClientType> | null = null;

async function getConnectedClient(): Promise<RedisClientType> {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  if (!clientPromise) {
    if (!process.env.REDIS_URL) {
      throw new Error("REDIS_URL environment variable is not set.");
    }
    const newClient = createClient({
      url: process.env.REDIS_URL,
    });

    clientPromise = newClient
      .connect()
      .then((connectedClient: any) => {
        redisClient = connectedClient as RedisClientType;
        console.log("Successfully connected to Redis.");
        // Handle client errors after connection
        redisClient.on("error", (err) =>
          console.error("Redis Client Error", err)
        );
        return redisClient;
      })
      .catch((err) => {
        console.error("Failed to connect to Redis:", err);
        clientPromise = null; // Reset promise on failure to allow retry
        throw err;
      });
  }
  return clientPromise;
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
        // 记录解析错误但不抛出
        console.warn(`Redis值解析JSON失败 (key=${key}):`, e);
        return value as any as T; // Return as string if not JSON
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
    // The 'redis' package options for 'EX' are slightly different from @vercel/kv
    // EX expects seconds. PX expects milliseconds.
    // NX -- Only set the key if it does not already exist.
    // XX -- Only set the key if it already exist.
    const redisOptions: any = {};
    if (options?.ex) redisOptions.EX = options.ex; // seconds
    if (options?.px) redisOptions.PX = options.px; // milliseconds
    if (options?.nx) redisOptions.NX = options.nx;
    if (options?.xx) redisOptions.XX = options.xx;

    return client.set(key, stringValue, redisOptions);
  },

  async del(key: string): Promise<number> {
    const client = await getConnectedClient();
    return client.del(key);
  },

  // You can add other Redis commands here as needed, e.g.:
  // async incr(key: string): Promise<number> {
  //   const client = await getConnectedClient();
  //   return client.incr(key);
  // },

  // Expose a way to explicitly close the connection if needed (e.g., for tests or shutdown)
  async quit(): Promise<void> {
    if (clientPromise) {
      try {
        const client = await clientPromise;
        await client.quit();
        redisClient = null;
        clientPromise = null;
        console.log("Redis connection closed.");
      } catch (err) {
        console.error("Error closing Redis connection:", err);
      }
    }
  },
};
