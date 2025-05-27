import axios from "axios";

// 基础 API 客户端
const DEFILLAMA_BASE_URL = "https://api.llama.fi";
const DEFILLAMA_YIELDS_URL = "https://yields.llama.fi";

// API 响应类型定义
export interface Protocol {
  id: string;
  name: string;
  slug: string;
  address?: string;
  symbol?: string;
  description?: string;
  chain?: string;
  chains?: string[];
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
  deadFrom?: number; // 协议停止活跃的时间戳
  audit_links?: string[]; // 审计链接列表
  github?: string[]; // GitHub 仓库列表
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
  pool: string; // 这是 pool ID
  stablecoin?: boolean;
  ilRisk?: string;
  exposure?: string;
  poolMeta?: string;
  underlyingTokens?: string[];
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

// DeFi Llama API 客户端
export class DeFiLlamaClient {
  private readonly apiClient;
  private readonly yieldsClient;

  constructor() {
    this.apiClient = axios.create({
      baseURL: DEFILLAMA_BASE_URL,
      timeout: 30000, // 30秒超时
    });
    this.yieldsClient = axios.create({
      baseURL: DEFILLAMA_YIELDS_URL,
      timeout: 30000,
    });
  }

  // 获取所有协议
  async getProtocols(): Promise<Protocol[]> {
    try {
      const { data } = await this.apiClient.get<Protocol[]>("/protocols");
      return data;
    } catch (error) {
      console.error("从 DeFi Llama 获取协议数据失败:", error);
      throw error;
    }
  }

  // 获取所有资金池
  async getPools(): Promise<Pool[]> {
    try {
      const { data } = await this.yieldsClient.get<{ data: Pool[] }>("/pools");
      return data.data;
    } catch (error) {
      console.error("从 DeFi Llama 获取资金池数据失败:", error);
      throw error;
    }
  }

  // 获取特定资金池的历史数据
  async getPoolChart(poolId: string): Promise<PoolChartData[]> {
    try {
      const { data } = await this.yieldsClient.get<{ data: PoolChartData[] }>(
        `/chart/${poolId}`
      );
      return data.data;
    } catch (error) {
      console.error(
        `从 DeFi Llama 获取资金池 ${poolId} 的历史数据失败:`,
        error
      );
      throw error;
    }
  }

  // 获取所有稳定币
  async getStablecoins(): Promise<Stablecoin[]> {
    try {
      const { data } = await this.yieldsClient.get<{
        peggedAssets: Stablecoin[];
      }>("/stablecoins");
      return data.peggedAssets;
    } catch (error) {
      console.error("从 DeFi Llama 获取稳定币数据失败:", error);
      throw error;
    }
  }
}
