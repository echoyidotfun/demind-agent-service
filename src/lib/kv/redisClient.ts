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
