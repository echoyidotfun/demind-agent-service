import axios from "axios";

// Base API clients
const DEFILLAMA_BASE_URL = "https://api.llama.fi";
const DEFILLAMA_YIELDS_URL = "https://yields.llama.fi";

// API Response Type Definitions
export interface Protocol {
  id: string;
  name: string;
  slug: string;
  address?: string;
  symbol?: string;
  description?: string;
  chain?: string;
  chains: string[];
  logo?: string;
  audits?: string;
  audit_note?: string;
  gecko_id?: string;
  cmcId?: string;
  category?: string;
  tvl?: number;
  change_1h?: number;
  change_1d?: number;
  change_7d?: number;
  mcap?: number;
  twitter?: string;
  url?: string;
  listedAt?: number;
  deadFrom?: number; // Timestamp when the protocol ceased to be active
  audit_links?: string[]; // List of audit links
  github?: string[]; // List of GitHub repositories
}

export interface Pool {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy?: number;
  apyBase?: number;
  apyReward?: number;
  rewardTokens?: string[];
  pool: string; // This is the pool ID
  stablecoin?: boolean;
  ilRisk?: string;
  exposure?: string;
  poolMeta?: string;
  underlyingTokens?: string[];
  apyPct1D?: number;
  apyPct7D?: number;
  apyPct30D?: number;
  volumeUsd1d?: number;
  volumeUsd7d?: number;
  apyBase7d?: number;
  apyMean30d?: number;
}

export interface PoolChartData {
  timestamp: string;
  tvlUsd: number;
  apy: number;
  apyBase: number;
  apyReward: number;
}

export interface Stablecoin {
  id: string;
  name: string;
  symbol: string;
  gecko_id?: string;
  pegType: string;
  pegMechanism?: string;
  circulating: {
    peggedUSD: number;
  };
  price: number;
  chains: string[];
}

// 重试函数工具
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    console.log(`重试操作，剩余重试次数: ${retries - 1}`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return withRetry(fn, retries - 1, delay * 2); // 指数退避策略
  }
}

// DeFi Llama API Client
export class DeFiLlamaClient {
  private readonly apiClient;
  private readonly yieldsClient;

  constructor() {
    this.apiClient = axios.create({
      baseURL: DEFILLAMA_BASE_URL,
      timeout: 60000, // 增加到 60 秒超时
    });
    this.yieldsClient = axios.create({
      baseURL: DEFILLAMA_YIELDS_URL,
      timeout: 60000, // 增加到 60 秒超时
    });
  }

  // Get all protocols
  async getProtocols(): Promise<Protocol[]> {
    try {
      console.log("开始获取 DeFi Llama 协议数据...");
      const result = await withRetry(async () => {
        const { data } = await this.apiClient.get<Protocol[]>("/protocols");
        return data;
      });
      console.log(`成功获取 DeFi Llama 协议数据，共 ${result.length} 个协议`);
      return result;
    } catch (error) {
      console.error("在多次重试后仍无法获取 DeFi Llama 协议数据:", error);
      throw error;
    }
  }

  // Get all pools
  async getPools(): Promise<Pool[]> {
    try {
      console.log("开始获取 DeFi Llama 池数据...");
      const result = await withRetry(async () => {
        const { data } = await this.yieldsClient.get<{ data: Pool[] }>(
          "/pools"
        );
        return data.data;
      });
      console.log(`成功获取 DeFi Llama 池数据，共 ${result.length} 个池`);
      return result;
    } catch (error) {
      console.error("在多次重试后仍无法获取 DeFi Llama 池数据:", error);
      throw error;
    }
  }

  // Get historical data for a specific pool
  async getPoolChart(poolId: string): Promise<PoolChartData[]> {
    try {
      console.log(`开始获取池 ${poolId} 的历史数据...`);
      const result = await withRetry(async () => {
        const { data } = await this.yieldsClient.get<{ data: PoolChartData[] }>(
          `/chart/${poolId}`
        );
        return data.data;
      });
      console.log(
        `成功获取池 ${poolId} 的历史数据，共 ${result.length} 条记录`
      );
      return result;
    } catch (error) {
      console.error(`在多次重试后仍无法获取池 ${poolId} 的历史数据:`, error);
      throw error;
    }
  }

  // Get all stablecoins
  async getStablecoins(): Promise<Stablecoin[]> {
    try {
      console.log("开始获取 DeFi Llama 稳定币数据...");
      const result = await withRetry(async () => {
        const { data } = await this.yieldsClient.get<{
          peggedAssets: Stablecoin[];
        }>("/stablecoins");
        return data.peggedAssets;
      });
      console.log(
        `成功获取 DeFi Llama 稳定币数据，共 ${result.length} 个稳定币`
      );
      return result;
    } catch (error) {
      console.error("在多次重试后仍无法获取 DeFi Llama 稳定币数据:", error);
      throw error;
    }
  }
}
