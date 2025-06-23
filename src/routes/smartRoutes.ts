import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import {
  createWorkflowEventHandler,
  createHeartbeatHandler,
  workflowAbortRegistry,
} from "../lib/sse/sseHandler";
import {
  intentAgent,
  intentAgentOutputSchema,
} from "../ai/agents/defiRadar.agent";
import { defiRadarWorkflow } from "../ai/workflows/defiRadar.workflow";
import { conversationalAgent } from "../ai/agents/conversationalAgent";
import { generateSuggestedQuestions } from "../ai/agents/suggestedQuestionsAgent";

// Create smart router for DeFi-specific analysis routes
const smartRouter = new Hono();

// Schema for query request
const queryRequestSchema = z.object({
  query: z.string().min(1).max(2000),
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  suggest: z.boolean().optional().default(false),
});

/**
 * Smart query endpoint - handles routing between conversation and investment analysis
 * Determines user intent and processes accordingly
 */
smartRouter.get("/query", async (c) => {
  const userId = c.req.query("userId");
  const sessionId = c.req.query("sessionId");
  const query = c.req.query("query");
  const suggest = c.req.query("suggest") === "true";

  if (!userId || !sessionId || !query) {
    return c.json(
      {
        error: "Missing required parameters",
        details: "userId, sessionId and query are all required",
      },
      400
    );
  }

  return streamSSE(c, async (stream) => {
    // Start heartbeat to prevent connection timeouts
    const heartbeat = createHeartbeatHandler(stream);

    try {
      // Send connection established event
      await stream.writeSSE({
        data: JSON.stringify({
          status: "connected",
          timestamp: new Date().toISOString(),
          sessionId,
        }),
        event: "connected",
      });

      // Get intent agent to determine query type
      const intentAgent = global.mastra.getAgent("intentAgent");
      if (!intentAgent) {
        throw new Error("Intent agent not found");
      }

      // Analyze user intent
      const intentResponse = await intentAgent.generate([
        { role: "user", content: query },
      ]);

      // Parse intent data
      const defaultIntent = {
        tool: "conversation",
        params: {},
      };

      const intentData =
        "object" in intentResponse &&
        intentResponse.object &&
        typeof intentResponse.object === "object" &&
        "tool" in intentResponse.object
          ? intentResponse.object
          : defaultIntent;

      // Send intent detection result
      await stream.writeSSE({
        data: JSON.stringify({
          intentDetected: intentData.tool,
          done: false,
        }),
        event: "intent",
      });

      // Handle based on intent
      if (
        intentData.tool === "findDefiInvestmentOpportunities" ||
        intentData.tool === "findTrendingTokenPools"
      ) {
        // Inform user of analysis in progress
        await stream.writeSSE({
          data: JSON.stringify({
            content: "Analyzing your investment query, please wait...",
            done: false,
          }),
          event: "message",
        });

        // Get workflow instance
        const workflow = global.mastra.getWorkflow("defiRadarWorkflow");
        if (!workflow) {
          throw new Error("DeFi Radar workflow not found");
        }

        // Register abort controller for this run
        const { runId, controller } = workflowAbortRegistry.register();

        // Create event handler for workflow events
        const eventHandler = createWorkflowEventHandler(stream, runId);

        // Create and start the workflow run
        const workflowRun = workflow.createRun();
        workflowRun.watch(eventHandler);

        const result = await workflowRun.start({
          inputData: {
            query: query,
          },
        });

        // Send workflow result
        await stream.writeSSE({
          data: JSON.stringify({
            content: "Here's your investment opportunity analysis:",
            workflowResult: result.status === "success" ? result.result : {},
            runId,
            done: false,
          }),
          event: "message",
        });

        // Record in conversation history
        const conversationalAgent = global.mastra.getAgent(
          "conversational-agent"
        );
        if (conversationalAgent) {
          await conversationalAgent.generate(
            [
              { role: "user", content: query },
              {
                role: "assistant",
                content:
                  "I've analyzed your investment opportunities. Please refer to the detailed results in the UI.",
              },
            ],
            {
              resourceId: userId,
              threadId: sessionId,
            }
          );
        }

        // Generate suggested questions if requested
        if (suggest) {
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
                suggestedQuestions,
                done: true,
                runId,
              }),
              event: "suggested-questions",
            });
          } else {
            await stream.writeSSE({
              data: JSON.stringify({ done: true }),
              event: "done",
            });
          }
        } else {
          await stream.writeSSE({
            data: JSON.stringify({ done: true }),
            event: "done",
          });
        }
      } else {
        // Handle conversation queries with conversational agent
        const conversationalAgent = global.mastra.getAgent(
          "conversational-agent"
        );
        if (!conversationalAgent) {
          throw new Error("Conversational agent not found");
        }

        // Get a full message to work with async iteration
        const agentResponse = await conversationalAgent.generate(
          [{ role: "user", content: query }],
          {
            resourceId: userId,
            threadId: sessionId,
          }
        );

        // Send full response
        await stream.writeSSE({
          data: JSON.stringify({
            content: agentResponse.text,
            done: false,
          }),
          event: "message",
        });

        // Generate suggested questions if requested
        if (suggest) {
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
                suggestedQuestions,
                done: true,
              }),
              event: "suggested-questions",
            });
          } else {
            await stream.writeSSE({
              data: JSON.stringify({ done: true }),
              event: "done",
            });
          }
        } else {
          await stream.writeSSE({
            data: JSON.stringify({ done: true }),
            event: "done",
          });
        }
      }
    } catch (error) {
      console.error("Smart routing error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          error: "An error occurred while processing your query",
          details: error instanceof Error ? error.message : "Unknown error",
        }),
        event: "error",
      });
    } finally {
      heartbeat.stop();
    }
  });
});

/**
 * Abort running workflow
 */
smartRouter.post("/abort/:runId", async (c) => {
  const { runId } = c.req.param();
  const success = workflowAbortRegistry.abort(runId);

  return c.json({
    success,
    message: success
      ? "Analysis aborted successfully"
      : "No active analysis found with that ID",
  });
});

export { smartRouter };
