import axios, { AxiosError } from "axios";
import { z } from "zod";
import https from "https";

// 扩展 CoinDetail Schema 定义，更详细地描述 API 返回结构
const CoinListItemSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  platforms: z.record(z.string(), z.string().nullable()).optional(),
});

// 更完整的 CoinDetail Schema (与 Prisma 模型对齐，但仍从 API 结构出发)
const ApiCoinDetailSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  asset_platform_id: z.string().nullable().optional(),
  platforms: z.record(z.string(), z.string().nullable()).optional(),
  description: z.object({ en: z.string().nullable().optional() }).optional(),
  image: z
    .object({
      thumb: z.string().nullable().optional(),
      small: z.string().nullable().optional(),
      large: z.string().nullable().optional(),
    })
    .optional(),
  categories: z.array(z.string()).nullable().optional(),
  links: z
    .object({
      homepage: z.array(z.string()).nullable().optional(),
      whitepaper: z.string().nullable().optional(),
      twitter_screen_name: z.string().nullable().optional(),
      telegram_channel_identifier: z.string().nullable().optional(),
      repos_url: z
        .object({ github: z.array(z.string()).optional() })
        .optional(),
      subreddit_url: z.string().nullable().optional(),
    })
    .optional(),
  market_cap_rank: z.number().nullable().optional(),
  sentiment_votes_up_percentage: z.number().nullable().optional(),
  watchlist_portfolio_users: z.number().nullable().optional(),
  market_data: z
    .object({
      current_price: z
        .object({ usd: z.number().nullable().optional() })
        .optional(),
      market_cap: z
        .object({ usd: z.number().nullable().optional() })
        .optional(),
      fully_diluted_valuation: z
        .object({ usd: z.number().nullable().optional() })
        .optional(),
      total_volume: z
        .object({ usd: z.number().nullable().optional() })
        .optional(),
      ath: z.object({ usd: z.number().nullable().optional() }).optional(),
      ath_date: z.object({ usd: z.string().nullable().optional() }).optional(), // API sends string date
      atl: z.object({ usd: z.number().nullable().optional() }).optional(),
      atl_date: z.object({ usd: z.string().nullable().optional() }).optional(), // API sends string date
      circulating_supply: z.number().nullable().optional(),
      total_supply: z.number().nullable().optional(),
      max_supply: z.number().nullable().optional(),
      price_change_percentage_24h: z.number().nullable().optional(),
      price_change_percentage_7d: z.number().nullable().optional(),
      price_change_percentage_14d: z.number().nullable().optional(),
      price_change_percentage_30d: z.number().nullable().optional(),
      price_change_percentage_60d: z.number().nullable().optional(),
      price_change_percentage_200d: z.number().nullable().optional(),
      price_change_percentage_1y: z.number().nullable().optional(),
    })
    .optional(),
  developer_data: z.any().optional(), // Keep as any for simplicity, can be detailed later
  community_data: z.any().optional(), // Keep as any for simplicity
  last_updated: z.string().nullable().optional(), // API sends string date
});

export type CoinListItem = z.infer<typeof CoinListItemSchema>;
export type ApiCoinDetail = z.infer<typeof ApiCoinDetailSchema>;

// Schema for a single item in the trending coins list
const TrendingCoinItemSchema = z.object({
  item: z.object({
    id: z.string(),
    coin_id: z.number(),
    name: z.string(),
    symbol: z.string(),
    market_cap_rank: z.number().nullable(),
    thumb: z.string().url().optional(),
    small: z.string().url().optional(),
    large: z.string().url().optional(),
    slug: z.string().optional(),
    price_btc: z.number().optional(),
    score: z.number().optional(),
    data: z.record(z.string(), z.any()).optional(),
  }),
});

const TrendingApiResponseSchema = z.object({
  coins: z.array(TrendingCoinItemSchema),
});

export type TrendingCoinItem = z.infer<typeof TrendingCoinItemSchema>["item"];

export class CoingeckoClient {
  private readonly baseUrl: string = "https://api.coingecko.com/api/v3";
  private readonly apiKey: string = process.env.COINGECKO_API_KEY || "";
  private readonly headers: Record<string, string>;
  private readonly apiClient: import("axios").AxiosInstance;
  private readonly MAX_RETRIES = 5;
  private readonly RETRY_DELAY_MS = 2100;
  private readonly httpsAgent: https.Agent;

  // Rate limiting properties
  private requestQueue: (() => Promise<any>)[] = [];
  private isProcessingQueue: boolean = false;
  private readonly MIN_REQUEST_INTERVAL_MS = 1500; // 增加到1.5秒
  private lastRequestTime: number = 0;
  private backoffTime: number = 0; // 记录当前需要等待的时间
  private readonly MAX_QUEUE_SIZE = 50; // 限制队列大小

  constructor() {
    this.headers = {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    };
    if (this.apiKey) {
      this.headers["x-cg-demo-api-key"] = this.apiKey;
    }

    // Create a custom httpsAgent with keepAlive enabled
    this.httpsAgent = new https.Agent({
      keepAlive: false, // Explicitly disable keepAlive
      // keepAliveMsecs: 5000, // Not needed if keepAlive is false
      // maxSockets: 100, // Default is Infinity, consider limiting if many concurrent requests
      // maxFreeSockets: 10, // Default is 256
    });

    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      headers: this.headers,
      timeout: 30000,
      httpsAgent: this.httpsAgent,
    });
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }
    this.isProcessingQueue = true;

    try {
      const now = Date.now();
      let waitTime = 0;

      // 检查是否需要等待指定的退避时间
      if (this.backoffTime > now) {
        waitTime = this.backoffTime - now;
        console.log(`CoinGecko API 退避中，等待 ${waitTime}ms...`);
      } else {
        // 检查距离上次请求的时间
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS) {
          waitTime = this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest;
        }
      }

      if (waitTime > 0) {
        await this.delay(waitTime);
      }

      const requestFn = this.requestQueue.shift();
      if (requestFn) {
        try {
          await requestFn();
        } catch (error) {
          // 错误会由调用函数的重试逻辑处理
        } finally {
          this.lastRequestTime = Date.now();
          this.isProcessingQueue = false;
          this.processQueue(); // 处理队列中的下一个
        }
      } else {
        this.isProcessingQueue = false;
      }
    } catch (error) {
      console.error("处理请求队列时出错:", error);
      this.isProcessingQueue = false;
      // 短暂延迟后尝试继续处理队列
      setTimeout(() => this.processQueue(), 1000);
    }
  }

  private async addToQueue<T>(apiCall: () => Promise<T>): Promise<T> {
    // 如果队列过长，拒绝新请求
    if (this.requestQueue.length >= this.MAX_QUEUE_SIZE) {
      throw new Error(
        `CoinGecko API 请求队列已满 (${this.MAX_QUEUE_SIZE}). 请稍后再试.`
      );
    }

    return new Promise<T>((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await apiCall();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  // 处理API响应中的429错误和重试
  private handleApiError(
    error: any,
    attempt: number,
    maxRetries: number,
    endpoint: string
  ): boolean {
    const axiosError = error as AxiosError;

    // 处理"Too Many Requests"错误
    if (axiosError.response?.status === 429) {
      // 获取Retry-After头或使用默认值
      let retryAfterSeconds = 60; // 默认60秒

      if (axiosError.response.headers["retry-after"]) {
        retryAfterSeconds = parseInt(
          axiosError.response.headers["retry-after"] as string,
          10
        );
      }

      // 加上额外的3秒作为缓冲
      const waitTimeMs = (retryAfterSeconds + 3) * 1000;

      // 设置退避时间
      this.backoffTime = Date.now() + waitTimeMs;

      console.warn(
        `CoinGeckoClient: API速率限制(429)，将等待 ${retryAfterSeconds}秒 (${endpoint}). 当前队列长度: ${this.requestQueue.length}`
      );

      return attempt < maxRetries; // 如果尝试次数未达最大，返回true表示应该重试
    }

    // 处理连接重置错误
    if (axiosError.code === "ECONNRESET" && attempt < maxRetries) {
      console.warn(
        `CoinGeckoClient: 尝试 ${attempt} 失败，连接重置，${this.RETRY_DELAY_MS}ms后重试...`
      );
      return true;
    }

    // 记录其他错误
    console.error(
      `CoinGeckoClient: ${endpoint} 请求失败 (尝试 ${attempt}/${maxRetries}):`,
      error
    );

    return false; // 默认不重试
  }

  async getCoinsList(includePlatform: boolean = true): Promise<CoinListItem[]> {
    return this.addToQueue(async () => {
      for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
        try {
          const response = await this.apiClient.get(`/coins/list`, {
            params: { include_platform: includePlatform },
          });
          const parsed = z.array(CoinListItemSchema).safeParse(response.data);
          if (!parsed.success) {
            console.error(
              "CoingeckoClient: Failed to parse coins list data:",
              parsed.error.flatten()
            );
            return []; // Return empty on parse failure, no retry for this
          }
          return parsed.data;
        } catch (error) {
          const shouldRetry = this.handleApiError(
            error,
            attempt,
            this.MAX_RETRIES,
            "getCoinsList"
          );
          if (shouldRetry) {
            await this.delay(this.RETRY_DELAY_MS);
          } else if (attempt === this.MAX_RETRIES) {
            return []; // Return empty after final attempt
          }
        }
      }
      return []; // Should be unreachable if MAX_RETRIES >= 1
    });
  }

  async getCoinDetails(coinId: string): Promise<ApiCoinDetail | null> {
    return this.addToQueue(async () => {
      for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
        try {
          const response = await this.apiClient.get(`/coins/${coinId}`);
          const parsed = ApiCoinDetailSchema.safeParse(response.data);
          if (!parsed.success) {
            console.error(
              `CoingeckoClient: Failed to parse coin details for ${coinId} from API:`,
              parsed.error.flatten()
            );
            // For parsing failure, return original data if it seems plausible, or null.
            // Here we choose to return the potentially malformed data for the service layer to inspect if needed,
            // or one might choose to return null directly.
            return response.data as ApiCoinDetail;
          }
          return parsed.data;
        } catch (error) {
          const shouldRetry = this.handleApiError(
            error,
            attempt,
            this.MAX_RETRIES,
            `getCoinDetails(${coinId})`
          );
          if (shouldRetry) {
            await this.delay(this.RETRY_DELAY_MS);
          } else if (attempt === this.MAX_RETRIES) {
            return null;
          }
        }
      }
      return null;
    });
  }

  async getTrendingCoins(): Promise<TrendingCoinItem[]> {
    return this.addToQueue(async () => {
      for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
        try {
          const response = await this.apiClient.get(`/search/trending`);
          const parsed = TrendingApiResponseSchema.safeParse(response.data);
          if (!parsed.success) {
            console.error(
              "CoingeckoClient: Failed to parse trending coins data:",
              parsed.error.flatten()
            );
            return []; // Return empty on parse failure, no retry for this
          }

          // Transform to a simple array of trending items
          const trendingCoins = parsed.data.coins.map((coin) => coin.item);
          return trendingCoins;
        } catch (error) {
          const shouldRetry = this.handleApiError(
            error,
            attempt,
            this.MAX_RETRIES,
            "getTrendingCoins"
          );
          if (shouldRetry) {
            await this.delay(this.RETRY_DELAY_MS);
          } else if (attempt === this.MAX_RETRIES) {
            return []; // Return empty after final attempt
          }
        }
      }
      return []; // Should be unreachable if MAX_RETRIES >= 1
    });
  }
}

export const coinGeckoApiClient = new CoingeckoClient();
