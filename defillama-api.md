## defillama api

### protocol

https://api.llama.fi/protocols
GET：获取所有收录协议的信息。
response 为 protocol 元数据和相关统计信息的列表，未压缩数据约 6-10Mb。单个实体的示例：

```json
{
  "id": "111",
  "name": "AAVE V2",
  "address": "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
  "symbol": "AAVE",
  "url": "[https://aave.com\r\n](https://aave.com/r/n)",
  "description": "Aave is an Open Source and Non-Custodial protocol to earn interest on deposits and borrow assets",
  "chain": "Multi-Chain",
  "logo": "[https://icons.llama.fi/aave-v2.png](https://icons.llama.fi/aave-v2.png)",
  "audits": "2",
  "audit_note": null,
  "gecko_id": "aave",
  "cmcId": "7278",
  "category": "Lending",
  "chains": ["Ethereum", "Polygon", "Avalanche"],
  "module": "aave/index.js",
  "twitter": "aave",
  "audit_links": ["[https://aave.com/security](https://aave.com/security)"],
  "oracles": ["Chainlink"],
  "oraclesBreakdown": [
    {
      "name": "Chainlink",
      "type": "Primary",
      "proof": [
        "[https://aave.com/docs/primitives/oracle](https://aave.com/docs/primitives/oracle)"
      ]
    }
  ],
  "parentProtocol": "parent#aave",
  "wrongLiquidity": true,
  "hallmarks": [
    [1619470313, "Start Ethereum V2 Rewards"],
    [1633377983, "Start AVAX V2 Rewards"],
    [1635339600, "Potential xSUSHI attack found"],
    [1651881600, "UST depeg"],
    [1654822801, "stETH depeg"]
  ],
  "methodology": "Counts the tokens locked in the contracts to be used as collateral to borrow or to earn yield. Borrowed coins are not counted towards the TVL, so only the coins actually locked in the contracts are counted. There's multiple reasons behind this but one of the main ones is to avoid inflating the TVL through cycled lending.",
  "slug": "aave-v2",
  "tvl": 326081889.19335246,
  "chainTvls": {
    "Ethereum-staking": 633475095.9044864,
    "Ethereum-pool2": 2481895.8792042905,
    "Polygon-borrowed": 5812984.04564458,
    "Ethereum": 271342824.3355706,
    "Ethereum-borrowed": 78168949.70176701,
    "Polygon": 33574855.00588474,
    "Avalanche-borrowed": 2811618.687388838,
    "Avalanche": 21164209.85189713,
    "staking": 633475095.9044864,
    "pool2": 2481895.8792042905,
    "borrowed": 86793552.43480043
  },
  "change_1h": -0.24560878163488553,
  "change_1d": -2.662727087896556,
  "change_7d": -4.90312610794129,
  "tokenBreakdowns": {},
  "mcap": 3352293797.19169,
  "staking": 633475095.9044864,
  "pool2": 2481895.8792042905
}
```

### pools

https://yields.llama.fi/pools
GET：获取所收录资金池数据
project 应该是对应 protocols 接口返回内容中的 slug 字段，返回数据量较大，未压缩数据约 10-15mb。
response 示例：

```json
{
    "status": "success",
    "data": [
        {
            "chain": "Ethereum",
            "project": "lido",
            "symbol": "STETH",
            "tvlUsd": 22520760573,
            "apyBase": 2.68,
            "apyReward": null,
            "apy": 2.68,
            "rewardTokens": null,
            "pool": "747c1d2a-c668-4682-b9f9-296708a3dd90",
            "apyPct1D": -0.121,
            "apyPct7D": 0.055,
            "apyPct30D": -0.121,
            "stablecoin": false,
            "ilRisk": "no",
            "exposure": "single",
            "predictions": {
                "predictedClass": "Stable/Up",
                "predictedProbability": 75,
                "binnedConfidence": 3
            },
            "poolMeta": null,
            "mu": 3.82382,
            "sigma": 0.05232,
            "count": 1089,
            "outlier": false,
            "underlyingTokens": [
                "0x0000000000000000000000000000000000000000"
            ],
            "il7d": null,
            "apyBase7d": null,
            "apyMean30d": 2.84169,
            "volumeUsd1d": null,
            "volumeUsd7d": null,
            "apyBaseInception": null
        }
,
        {
            "chain": "Ethereum",
            "project": "ether.fi-stake",
            "symbol": "WEETH",
            "tvlUsd": 6069862567,
            "apyBase": 2.85356,
            "apyReward": 0.52055,
            "apy": 3.37411,
            "rewardTokens": [
                "0x8F08B70456eb22f6109F57b8fafE862ED28E6040"
            ],
            "pool": "46bd2bdf-6d92-4066-b482-e885ee172264",
            "apyPct1D": 0.06517,
            "apyPct7D": -0.31929,
            "apyPct30D": 0.48714,
            "stablecoin": false,
            "ilRisk": "no",
            "exposure": "single",
            "predictions": {
                "predictedClass": "Stable/Up",
                "predictedProbability": 56.00000000000001,
                "binnedConfidence": 1
            },
            "poolMeta": null,
            "mu": 3.27357,
            "sigma": 0.04344,
            "count": 355,
            "outlier": false,
            "underlyingTokens": [
                "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
            ],
            "il7d": null,
            "apyBase7d": 2.81486,
            "apyMean30d": 3.33796,
            "volumeUsd1d": null,
            "volumeUsd7d": null,
            "apyBaseInception": null
        }
		...
    ]
}
```

### pool chart

https://yields.llama.fi/chart/{{pool-id}}
GET: 获取指定 pool 的近 7 天数据历史变化趋势，pool-id 对应的是 pools 接口获得的数据中的 pool 字段。
示例： https://yields.llama.fi/chart/d829b642-1dad-40c5-a2e9-78e8528c937f
response：

```json
{
  "status": "success",
  "data": [
    {
      "timestamp": "2025-05-14T23:01:10.331Z",
      "tvlUsd": 2292,
      "apy": 2624.11364,
      "apyBase": 12.21444,
      "apyReward": 2611.8992,
      "il7d": null,
      "apyBase7d": null
    },
    {
      "timestamp": "2025-05-15T23:01:05.674Z",
      "tvlUsd": 5992,
      "apy": 952.4427,
      "apyBase": 6.93762,
      "apyReward": 945.50509,
      "il7d": null,
      "apyBase7d": null
    },
    {
      "timestamp": "2025-05-16T23:01:08.721Z",
      "tvlUsd": 10092,
      "apy": 544.13088,
      "apyBase": 4.03169,
      "apyReward": 540.09919,
      "il7d": null,
      "apyBase7d": null
    },
    {
      "timestamp": "2025-05-17T23:03:08.874Z",
      "tvlUsd": 12030,
      "apy": 433.79737,
      "apyBase": 7.18501,
      "apyReward": 426.61236,
      "il7d": null,
      "apyBase7d": null
    },
    {
      "timestamp": "2025-05-18T23:00:57.503Z",
      "tvlUsd": 12517,
      "apy": 428.59188,
      "apyBase": 7.6472,
      "apyReward": 420.94469,
      "il7d": null,
      "apyBase7d": null
    },
    {
      "timestamp": "2025-05-19T23:01:19.915Z",
      "tvlUsd": 13752,
      "apy": 383.33788,
      "apyBase": 6.32944,
      "apyReward": 377.00843,
      "il7d": null,
      "apyBase7d": null
    },
    {
      "timestamp": "2025-05-20T23:01:11.537Z",
      "tvlUsd": 12160,
      "apy": 430.73625,
      "apyBase": 2.75167,
      "apyReward": 427.98458,
      "il7d": null,
      "apyBase7d": null
    },
    {
      "timestamp": "2025-05-21T14:02:08.648Z",
      "tvlUsd": 12928,
      "apy": 420.97973,
      "apyBase": 14.48989,
      "apyReward": 406.48984,
      "il7d": null,
      "apyBase7d": null
    }
  ]
}
```

### stablecoins

https://stablecoins.llama.fi/stablecoins
GET：获取收录的稳定币的数据
response 示例：

```json
{
    "peggedAssets": [
    ...
        {
            "id": "15",
            "name": "Dola",
            "symbol": "DOLA",
            "gecko_id": "dola-usd",
            "pegType": "peggedUSD",
            "priceSource": "defillama",
            "pegMechanism": "crypto-backed",
            "circulating": {
                "peggedUSD": 203802204.63944054
            },
            "circulatingPrevDay": {
                "peggedUSD": 203802204.63944054
            },
            "circulatingPrevWeek": {
                "peggedUSD": 212812204.63944054
            },
            "circulatingPrevMonth": {
                "peggedUSD": 214256751.21725148
            },
            "chainCirculating": {
                "BSC": {
                    "current": {
                        "peggedUSD": 1793864.3910648408
                    },
                    "circulatingPrevDay": {
                        "peggedUSD": 1793864.3910648408
                    },
                    "circulatingPrevWeek": {
                        "peggedUSD": 1793864.3910648408
                    },
                    "circulatingPrevMonth": {
                        "peggedUSD": 1793864.3910648408
                    }
                },
                "OP Mainnet": {
                    "current": {
                        "peggedUSD": 386550.07412330055
                    },
                    "circulatingPrevDay": {
                        "peggedUSD": 386550.07412330055
                    },
                    "circulatingPrevWeek": {
                        "peggedUSD": 402151.09063500125
                    },
                    "circulatingPrevMonth": {
                        "peggedUSD": 463615.35983367113
                    }
                },
                "Ethereum": {
                    "current": {
                        "peggedUSD": 197191076.7967329
                    },
                    "circulatingPrevDay": {
                        "peggedUSD": 197191076.79673293
                    },
                    "circulatingPrevWeek": {
                        "peggedUSD": 206137204.7802212
                    },
                    "circulatingPrevMonth": {
                        "peggedUSD": 207233389.3821901
                    }
                },
                "Avalanche": {
                    "current": {
                        "peggedUSD": 62151.84919545836
                    },
                    "circulatingPrevDay": {
                        "peggedUSD": 62151.84919545836
                    },
                    "circulatingPrevWeek": {
                        "peggedUSD": 62151.84919545836
                    },
                    "circulatingPrevMonth": {
                        "peggedUSD": 62151.84919545836
                    }
                },
                "Polygon": {
                    "current": {
                        "peggedUSD": 3796.6248660188994
                    },
                    "circulatingPrevDay": {
                        "peggedUSD": 3796.6248660188994
                    },
                    "circulatingPrevWeek": {
                        "peggedUSD": 3796.6248660188994
                    },
                    "circulatingPrevMonth": {
                        "peggedUSD": 3796.6248660188994
                    }
                },
                "Arbitrum": {
                    "current": {
                        "peggedUSD": 1988852.6439925083
                    },
                    "circulatingPrevDay": {
                        "peggedUSD": 1988852.6439925083
                    },
                    "circulatingPrevWeek": {
                        "peggedUSD": 1988852.6439925083
                    },
                    "circulatingPrevMonth": {
                        "peggedUSD": 1988852.6439925083
                    }
                },
                "Base": {
                    "current": {
                        "peggedUSD": 1912132.8316415101
                    },
                    "circulatingPrevDay": {
                        "peggedUSD": 1912132.8316415101
                    },
                    "circulatingPrevWeek": {
                        "peggedUSD": 1960403.8316415101
                    },
                    "circulatingPrevMonth": {
                        "peggedUSD": 2247301.538284899
                    }
                },
                "Fantom": {
                    "current": {
                        "peggedUSD": 463779.4278239825
                    },
                    "circulatingPrevDay": {
                        "peggedUSD": 463779.4278239825
                    },
                    "circulatingPrevWeek": {
                        "peggedUSD": 463779.4278239825
                    },
                    "circulatingPrevMonth": {
                        "peggedUSD": 463779.4278239825
                    }
                }
            },
            "chains": [
                "Ethereum",
                "Arbitrum",
                "Base",
                "BSC",
                "Fantom",
                "OP Mainnet",
                "Avalanche",
                "Polygon"
            ],
            "price": 1
        },
        ...
    ]
}
```
