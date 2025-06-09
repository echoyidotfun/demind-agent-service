import dotenv from "dotenv";
dotenv.config();

// 设置AI SDK环境变量
process.env.AI_SDK_OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
process.env.AI_SDK_OPENAI_API_KEY = process.env.OPENAI_API_KEY;

import { DefiRadarAgent } from "../ai/agents/defiRadar.agent";

// 添加延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const testAgent = async () => {
  console.log("Testing DefiRadarAgent with third-party API...");
  console.log("Using base URL:", process.env.AI_SDK_OPENAI_BASE_URL);

  try {
    // 仅执行一个查询测试
    console.log("\n===== TEST: 查询高收益以太坊池子 =====");

    // 添加强制使用缓存的标志（如果api支持）
    const response = await DefiRadarAgent.generate([
      {
        role: "user",
        content: "查找在以太坊上APY超过20%的高收益资金池，优先使用缓存数据",
      },
    ]);

    console.log("Agent response:");
    console.log(response.text);

    console.log("\nTest completed successfully!");
  } catch (error) {
    console.error("Error testing agent:", error);
  }
};

testAgent();
