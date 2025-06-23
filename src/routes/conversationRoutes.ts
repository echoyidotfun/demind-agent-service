import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  createSSEHandler,
  createHeartbeatHandler,
} from "../lib/sse/sseHandler";

// Conversation request schema
const conversationRequestSchema = z.object({
  message: z.string().min(1).max(1000),
  userId: z.string().min(1),
  sessionId: z.string().optional(),
});

// Create conversation router
const conversationRouter = new Hono();

/**
 * Chat endpoint - handles conversation with DeFi advisor
 * SSE stream for responses
 */
conversationRouter.post(
  "/chat",
  zValidator("json", conversationRequestSchema),
  async (c) => {
    const { message, userId, sessionId = randomUUID() } = c.req.valid("json");

    return createSSEHandler({
      onConnect: async (stream) => {
        // Start heartbeat to keep connection alive
        const heartbeat = createHeartbeatHandler(stream);

        try {
          // Get the agent instance
          const agent = global.mastra.getAgent("conversational-agent");
          if (!agent) {
            throw new Error("Conversational agent not found");
          }

          // Send connected event
          await stream.writeSSE({
            data: JSON.stringify({
              status: "connected",
              sessionId,
            }),
            event: "connected",
          });

          // Get agent response
          const agentResponse = await agent.generate(
            [{ role: "user", content: message }],
            {
              resourceId: userId,
              threadId: sessionId,
            }
          );

          // Send full response
          await stream.writeSSE({
            data: JSON.stringify({
              type: "text",
              content: agentResponse.text,
            }),
            event: "message",
          });

          // Get suggested follow-up questions
          const suggestionsAgent = global.mastra.getAgent(
            "suggested-questions-agent"
          );
          if (suggestionsAgent) {
            const suggestedQuestions = await suggestionsAgent.generate("", {
              resourceId: userId,
              threadId: sessionId,
            });

            await stream.writeSSE({
              data: JSON.stringify({
                suggestions: suggestedQuestions,
              }),
              event: "suggestions",
            });
          }

          // Send completion event
          await stream.writeSSE({
            data: JSON.stringify({
              status: "completed",
            }),
            event: "completed",
          });
        } catch (error) {
          console.error("Chat error:", error);
          await stream.writeSSE({
            data: JSON.stringify({
              error: "An error occurred during the conversation",
              details: error instanceof Error ? error.message : "Unknown error",
            }),
            event: "error",
          });
        } finally {
          heartbeat.stop();
        }
      },
    })(c);
  }
);

export default conversationRouter;
