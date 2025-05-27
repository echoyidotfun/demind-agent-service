import { prisma } from "../lib/db/client";

// EVM兼容链白名单，与DeFiLlamaSyncService中的保持一致
const EVM_CHAINS = new Set([
  // 主流EVM兼容链
  "ethereum",
  "Ethereum",
  "bsc",
  "Binance",
  "polygon",
  "Polygon",
  "arbitrum",
  "Arbitrum",
  "optimism",
  "Optimism",
  "avalanche",
  "Avalanche",
  "base",
  "Base",
  "zksync",
  "zkSync",
  "zkSync Era",
  "fantom",
  "Fantom",
  "cronos",
  "Cronos",
  "gnosis",
  "Gnosis",
  "harmony",
  "Harmony",
  "moonbeam",
  "Moonbeam",
  "moonriver",
  "Moonriver",
  "linea",
  "Linea",
  "kava",
  "Kava",
  "aurora",
  "Aurora",
  "metis",
  "Metis",
  "celo",
  "Celo",

  // 其他EVM链
  "blast",
  "Blast",
  "scroll",
  "Scroll",
  "mode",
  "Mode",
  "mantle",
  "Mantle",
  "polygon_zkevm",
  "Polygon zkEVM",
  "op_bnb",
  "Op_Bnb",
  "boba",
  "Boba",
  "canto",
  "Canto",
  "filecoin",
  "Filecoin",
  "klaytn",
  "Klaytn",
  "telos",
  "Telos",
  "okexchain",
  "OKExChain",
  "heco",
  "Heco",
  "fuse",
  "Fuse",
  "syscoin",
  "Syscoin",
  "tron",
  "Tron",
  "kucoin",
  "Kucoin",
  "xdai",
  "xDai",
  "theta",
  "Theta",
  "conflux",
  "Conflux",
  "evmos",
  "Evmos",
  "oasis",
  "Oasis",
  "meter",
  "Meter",
  "dogechain",
  "Dogechain",
  "elastos",
  "Elastos",
  "ronin",
  "Ronin",
  "thundercore",
  "ThunderCore",
  "smartbch",
  "smartBCH",
  "palm",
  "Palm",
  "hoo",
  "Hoo",
  "milkomeda",
  "Milkomeda",
  "cube",
  "Cube",
  "vision",
  "Vision",
  "bitgert",
  "Bitgert",
  "energyweb",
  "EnergyWeb",
  "onus",
  "Onus",
  "tomb",
  "Tombchain",
  "ethereumpow",
  "EthereumPoW",
  "ethereumclassic",
  "EthereumClassic",
  "callisto",
  "Callisto",
  "rsk",
  "RSK",
]);

/**
 * 检查协议是否支持至少一个EVM兼容链
 */
function isProtocolEVMCompatible(protocol: any): boolean {
  // 如果chain字段是EVM兼容链
  if (protocol.chain && EVM_CHAINS.has(protocol.chain)) {
    return true;
  }

  // 如果chains数组中包含至少一个EVM兼容链
  if (
    protocol.chains &&
    Array.isArray(protocol.chains) &&
    protocol.chains.length > 0
  ) {
    return protocol.chains.some((chain: string) => EVM_CHAINS.has(chain));
  }

  return false;
}

/**
 * 清理非EVM链的数据
 */
async function cleanNonEVMData() {
  console.log("开始清理非EVM链数据...");

  try {
    // 1. 获取所有协议及其链信息
    console.log("正在加载所有协议数据...");
    const allProtocols = await prisma.protocol.findMany({
      select: {
        id: true,
        slug: true,
        chain: true,
        chains: true,
      },
    });
    console.log(`加载了 ${allProtocols.length} 个协议数据`);

    // 2. 筛选出非EVM兼容协议
    const nonEVMProtocols = allProtocols.filter(
      (protocol) => !isProtocolEVMCompatible(protocol)
    );
    console.log(`检测到 ${nonEVMProtocols.length} 个非EVM兼容协议`);

    if (nonEVMProtocols.length > 0) {
      // 收集非EVM协议的ID和slug
      const nonEVMProtocolIds = nonEVMProtocols.map((p) => p.id);
      const nonEVMProtocolSlugs = nonEVMProtocols.map((p) => p.slug);

      console.log("删除非EVM协议相关的资金池图表数据...");
      // 3. 删除这些协议相关的资金池图表数据
      const deletedPoolCharts = await prisma.$transaction(async (prisma) => {
        // 首先找出所有非EVM协议的资金池ID
        const poolsToDelete = await prisma.pool.findMany({
          where: { project: { in: nonEVMProtocolSlugs } },
          select: { id: true },
        });

        const poolIds = poolsToDelete.map((p) => p.id);
        console.log(`找到 ${poolIds.length} 个需要删除的资金池ID`);

        if (poolIds.length > 0) {
          // 删除资金池图表数据
          const deletedCharts = await prisma.poolChart.deleteMany({
            where: { poolId: { in: poolIds } },
          });
          return deletedCharts.count;
        }
        return 0;
      });
      console.log(`已删除 ${deletedPoolCharts} 条资金池图表数据`);

      console.log("删除非EVM协议相关的资金池Token关联数据...");
      // 4. 删除这些协议相关的资金池Token关联
      const deletedPoolTokens = await prisma.$transaction(async (prisma) => {
        // 找出所有非EVM协议的资金池ID
        const poolsToDelete = await prisma.pool.findMany({
          where: { project: { in: nonEVMProtocolSlugs } },
          select: { id: true },
        });

        const poolIds = poolsToDelete.map((p) => p.id);
        if (poolIds.length > 0) {
          // 删除资金池Token关联
          const deletedTokens = await prisma.poolToken.deleteMany({
            where: { poolId: { in: poolIds } },
          });
          return deletedTokens.count;
        }
        return 0;
      });
      console.log(`已删除 ${deletedPoolTokens} 条资金池Token关联数据`);

      console.log("删除非EVM协议相关的资金池数据...");
      // 5. 删除这些协议相关的资金池
      const deletedPools = await prisma.pool.deleteMany({
        where: { project: { in: nonEVMProtocolSlugs } },
      });
      console.log(`已删除 ${deletedPools.count} 个资金池数据`);

      console.log("删除非EVM链协议数据...");
      // 6. 删除非EVM协议本身
      const deletedProtocols = await prisma.protocol.deleteMany({
        where: { id: { in: nonEVMProtocolIds } },
      });
      console.log(`已删除 ${deletedProtocols.count} 个非EVM协议数据`);

      console.log("-------------------------");
      console.log("清理非EVM链资金池数据...");
      // 7. 删除所有其他非EVM链的资金池（可能属于EVM协议但部署在非EVM链上）
      // 先获取所有非EVM链的资金池
      const nonEVMChainPools = await prisma.pool.findMany({
        where: {
          chain: { notIn: Array.from(EVM_CHAINS) },
        },
        select: { id: true, chain: true },
      });

      if (nonEVMChainPools.length > 0) {
        const nonEVMPoolIds = nonEVMChainPools.map((p) => p.id);

        // 统计每个链的池子数量
        const chainCounts: Record<string, number> = {};
        nonEVMChainPools.forEach((pool) => {
          if (!chainCounts[pool.chain]) chainCounts[pool.chain] = 0;
          chainCounts[pool.chain]++;
        });

        console.log("以下非EVM链的资金池将被删除:");
        Object.entries(chainCounts)
          .sort((a, b) => b[1] - a[1])
          .forEach(([chain, count]) => {
            console.log(`  - ${chain}: ${count}个资金池`);
          });

        // 删除这些资金池相关的图表数据
        console.log("删除非EVM链资金池的图表数据...");
        const deletedNonEVMPoolCharts = await prisma.poolChart.deleteMany({
          where: { poolId: { in: nonEVMPoolIds } },
        });
        console.log(
          `已删除 ${deletedNonEVMPoolCharts.count} 条非EVM链资金池图表数据`
        );

        // 删除这些资金池相关的Token关联
        console.log("删除非EVM链资金池的Token关联数据...");
        const deletedNonEVMPoolTokens = await prisma.poolToken.deleteMany({
          where: { poolId: { in: nonEVMPoolIds } },
        });
        console.log(
          `已删除 ${deletedNonEVMPoolTokens.count} 条非EVM链资金池Token关联数据`
        );

        // 删除非EVM链的资金池
        console.log("删除非EVM链资金池数据...");
        const deletedNonEVMPools = await prisma.pool.deleteMany({
          where: { id: { in: nonEVMPoolIds } },
        });
        console.log(`已删除 ${deletedNonEVMPools.count} 个非EVM链资金池数据`);
      } else {
        console.log("没有检测到其他非EVM链资金池");
      }
    } else {
      console.log("没有检测到非EVM兼容协议，无需清理");
    }

    console.log("清理非EVM链数据完成！");
  } catch (error) {
    console.error("清理非EVM链数据时发生错误:", error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanNonEVMData()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("执行脚本时发生错误:", error);
    process.exit(1);
  });
