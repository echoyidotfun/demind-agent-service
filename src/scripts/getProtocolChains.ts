import { prisma } from "../lib/db/client";

async function getProtocolChains() {
  try {
    // 查询Protocol表中的所有链
    const uniqueChains = await prisma.$queryRaw<{ chain: string }[]>`
      SELECT DISTINCT unnest(chains) as chain FROM "Protocol" ORDER BY chain;
    `;

    console.log("所有区块链列表:");
    uniqueChains.forEach((record) => {
      console.log(` - ${record.chain}`);
    });

    console.log("\n总共找到", uniqueChains.length, "个不同的区块链");
  } catch (error) {
    console.error("查询链数据失败:", error);
  } finally {
    await prisma.$disconnect();
  }
}

getProtocolChains()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("执行脚本时发生错误:", error);
    process.exit(1);
  });
