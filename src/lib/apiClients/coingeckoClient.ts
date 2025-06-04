import axios from "axios";
import { z } from "zod";

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
    })
    .optional(),
  market_cap_rank: z.number().nullable().optional(),
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
    market_cap_rank: z.number().nullable().optional(),
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
  private readonly apiKey: string = "CG-daTv2qyoVRS5yimoYbKQCW2e"; // Consider moving to env variables
  private readonly headers: Record<string, string>;

  constructor() {
    this.headers = {
      "x-cg-demo-api-key": this.apiKey,
      Accept: "application/json",
    };
  }

  async getCoinsList(includePlatform: boolean = true): Promise<CoinListItem[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/coins/list`, {
        params: { include_platform: includePlatform },
        headers: this.headers,
      });
      const parsed = z.array(CoinListItemSchema).safeParse(response.data);
      if (!parsed.success) {
        console.error(
          "CoingeckoClient: Failed to parse coins list data:",
          parsed.error.flatten()
        );
        return [];
      }
      return parsed.data;
    } catch (error) {
      console.error("CoingeckoClient: Error fetching coins list:", error);
      return [];
    }
  }

  async getCoinDetailsFromApi(coinId: string): Promise<ApiCoinDetail | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/coins/${coinId}`, {
        headers: this.headers,
      });
      const parsed = ApiCoinDetailSchema.safeParse(response.data);
      if (!parsed.success) {
        console.error(
          `CoingeckoClient: Failed to parse coin details for ${coinId} from API:`,
          parsed.error.flatten()
        );
        return response.data as ApiCoinDetail;
      }
      return parsed.data;
    } catch (error) {
      console.error(
        `CoingeckoClient: Error fetching details for coin ${coinId} from API:`,
        error
      );
      return null;
    }
  }

  async getTrendingCoins(): Promise<TrendingCoinItem[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/search/trending`, {
        headers: this.headers,
      });
      const parsed = TrendingApiResponseSchema.safeParse(response.data);
      if (!parsed.success) {
        console.error(
          "CoingeckoClient: Failed to parse trending coins API response:",
          parsed.error.flatten()
        );
        return [];
      }
      return parsed.data.coins.map((coinWrapper) => {
        const item = coinWrapper.item;
        return {
          id: item.id,
          name: item.name,
          symbol: item.symbol,
          coin_id: item.coin_id,
          market_cap_rank: item.market_cap_rank,
          score: item.score,
        };
      });
    } catch (error) {
      console.error("CoingeckoClient: Error fetching trending coins:", error);
      return [];
    }
  }
}

export const coinGeckoApiClient = new CoingeckoClient();
