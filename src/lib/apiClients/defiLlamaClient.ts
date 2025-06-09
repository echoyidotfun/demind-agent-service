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

// DeFi Llama API Client
export class DeFiLlamaClient {
  private readonly apiClient;
  private readonly yieldsClient;

  constructor() {
    this.apiClient = axios.create({
      baseURL: DEFILLAMA_BASE_URL,
      timeout: 30000, // 30-second timeout
    });
    this.yieldsClient = axios.create({
      baseURL: DEFILLAMA_YIELDS_URL,
      timeout: 30000,
    });
  }

  // Get all protocols
  async getProtocols(): Promise<Protocol[]> {
    try {
      const { data } = await this.apiClient.get<Protocol[]>("/protocols");
      return data;
    } catch (error) {
      console.error("Failed to fetch protocols from DeFi Llama:", error);
      throw error;
    }
  }

  // Get all pools
  async getPools(): Promise<Pool[]> {
    try {
      const { data } = await this.yieldsClient.get<{ data: Pool[] }>("/pools");
      return data.data;
    } catch (error) {
      console.error("Failed to fetch pools from DeFi Llama:", error);
      throw error;
    }
  }

  // Get historical data for a specific pool
  async getPoolChart(poolId: string): Promise<PoolChartData[]> {
    try {
      const { data } = await this.yieldsClient.get<{ data: PoolChartData[] }>(
        `/chart/${poolId}`
      );
      return data.data;
    } catch (error) {
      console.error(
        `Failed to fetch historical data for pool ${poolId} from DeFi Llama:`,
        error
      );
      throw error;
    }
  }

  // Get all stablecoins
  async getStablecoins(): Promise<Stablecoin[]> {
    try {
      const { data } = await this.yieldsClient.get<{
        peggedAssets: Stablecoin[];
      }>("/stablecoins");
      return data.peggedAssets;
    } catch (error) {
      console.error("Failed to fetch stablecoins from DeFi Llama:", error);
      throw error;
    }
  }
}
