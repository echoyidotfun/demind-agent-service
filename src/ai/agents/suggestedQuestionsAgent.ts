import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { Memory } from "@mastra/memory";
import { PostgresStore, PgVector } from "@mastra/pg";

const SUGGESTION_MODEL = process.env.SUGGESTION_MODEL || "gpt-4o-mini";

// 获取数据库连接URL
const PG_DATABASE_URL = process.env.PG_DATABASE_URL;

if (!PG_DATABASE_URL) {
  throw new Error("PG_DATABASE_URL is not set");
}

// Initialize memory with PostgreSQL storage
const memory = new Memory({
  storage: new PostgresStore({
    connectionString: PG_DATABASE_URL,
    // Use a schema prefix to distinguish conversation data tables
    schemaName: "memory",
  }),
  vector: new PgVector({
    connectionString: PG_DATABASE_URL,
    schemaName: "memory",
  }),
  options: {
    // Configure message history
    lastMessages: 10,

    // Configure semantic search
    semanticRecall: {
      topK: 3,
      messageRange: {
        before: 1,
        after: 1,
      },
    },

    // Enable thread title generation
    threads: {
      generateTitle: true,
    },
  },
});

// 定义生成问题的系统提示
const suggestedQuestionsPrompt = `
你是DeFi投资助手的问题推荐器。你的任务是基于用户的查询和系统的回答，生成5个用户可能感兴趣的后续问题。

这些问题应该多样化，涵盖:
1. 深入分析当前内容
2. 比较不同选择
3. 了解潜在风险
4. 相关知识扩展
5. 个人投资策略

每个问题应当具体清晰，并与DeFi投资和加密货币相关。
`;

// Define the output schema for suggested questions
export const suggestedQuestionsOutputSchema = z.array(z.string());

// Create suggested questions agent
export const suggestedQuestionsAgent = new Agent({
  name: "suggested-questions-agent",
  instructions: `Your role is to generate three follow-up questions that the user might want to ask based on the conversation history.

IMPORTANT RULES:
- Generate EXACTLY 3 follow-up questions related to the conversation
- Questions MUST be in English
- Each question should be short (15 words or less)
- Make questions specific and actionable
- Ensure questions are natural extensions of the current conversation
- Avoid repeating questions that have already been asked
- Focus on DeFi topics, investment strategies, or specific protocols mentioned
- Output ONLY the questions in an array format, nothing else

Examples of good suggested questions:
- "How does Uniswap V3 compare to Curve?"
- "What's a safe APY range for stablecoin farming?"
- "Which DEXs have the lowest impermanent loss?"
- "How can I reduce gas fees on Ethereum?"

DO NOT include any explanations, introductions, or commentary in your response - ONLY the array of questions.`,
  model: openai("gpt-4o-mini"),
  memory,
  defaultGenerateOptions: {
    temperature: 0.7,
    output: suggestedQuestionsOutputSchema,
  },
});

/**
 * 根据用户查询和系统响应生成推荐问题
 *
 * @param userQuery 用户查询
 * @param systemResponse 系统响应
 * @returns 推荐问题列表
 */
export async function generateSuggestedQuestions(
  userQuery: string,
  systemResponse: string
): Promise<string[]> {
  try {
    const prompt = `
基于以下对话，生成5个用户可能想问的后续问题:

用户问题: ${userQuery}

系统回答: ${systemResponse}

请直接列出5个问题，每行一个，不要添加编号或额外说明。
`;

    const response = await suggestedQuestionsAgent.generate([
      { role: "user", content: prompt },
    ]);

    if ("object" in response && Array.isArray(response.object)) {
      return response.object;
    }

    // 如果没有获得正确格式的回复，则解析文本
    const text = response.text || "";
    const questions = text
      .split("\n")
      .filter((line: string) => line.trim().length > 0 && line.includes("?"))
      .slice(0, 5);

    return questions;
  } catch (error) {
    console.error("生成推荐问题失败:", error);
    return [];
  }
}
