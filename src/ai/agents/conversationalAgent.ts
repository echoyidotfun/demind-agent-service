import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { Memory } from "@mastra/memory";
import { PostgresStore, PgVector } from "@mastra/pg";
import {
  findDefiInvestmentOpportunitiesTool,
  findTrendingTokenPoolsTool,
} from "../tools/defiRadar.tool";

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

    // Configure working memory
    workingMemory: {
      enabled: true,
      template: `
# User Profile

## Personal Info
- User ID: 
- Preferred Language:
- Experience Level: [Beginner/Intermediate/Advanced]

## Investment Preferences
- Risk Tolerance: [Low/Medium/High]
- Investment Focus: [Yield Farming/Liquidity Mining/Staking/Other]
- Preferred Chains:
- Preferred Tokens:
- Investment Timeline:

## Session Context
- Current Topic:
- Open Questions:
- Recent Interests:
      `,
    },

    // Enable thread title generation
    threads: {
      generateTitle: true,
    },
  },
});

// Create conversation agent
export const conversationalAgent = new Agent({
  name: "conversational-agent",
  instructions: `You are an intelligent DeFi investment advisor specializing in providing insights about cryptocurrency and DeFi protocols.

IMPORTANT RULES:
- Always respond in English only, as the user interface is in English
- Be concise yet informative in your responses
- If you don't know something, admit it rather than making up information
- Focus on providing factual information about DeFi protocols, liquidity pools, yield opportunities, and investment strategies
- Maintain a professional and helpful tone
- Remember user preferences and previous interactions from your working memory
- Update your working memory with relevant user information when discovered

When discussing investment opportunities:
- Explain risks and potential returns
- Provide context about protocols mentioned
- Consider gas fees and transaction costs
- Mention security considerations when relevant
- Avoid making specific price predictions

You can discuss topics including:
- DeFi protocols and their performance metrics
- Yield farming strategies
- Liquidity pool opportunities
- Staking rewards
- Protocol governance
- Risk assessment of DeFi investments
- Gas optimization strategies
- DeFi trends and news

VERY IMPORTANT: All responses must be in English as they will be directly displayed to users on an English interface.`,
  model: openai("gpt-4o"),
  memory,
  tools: {
    findDefiInvestmentOpportunities: findDefiInvestmentOpportunitiesTool,
    findTrendingTokenPools: findTrendingTokenPoolsTool,
  },
  defaultGenerateOptions: {
    temperature: 0.7,
  },
  defaultStreamOptions: {
    maxSteps: 10,
    onStepFinish: ({ text, toolCalls, toolResults }) => {
      console.log("Step completed:", {
        textPreview: text?.substring(0, 100) + "...",
        toolCall: toolCalls?.length
          ? (toolCalls[0] as any).toolName || "none"
          : "none",
        hasResults: !!toolResults?.length,
      });
    },
  },
});

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
});
