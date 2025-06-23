import { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "crypto";

export interface SSEHandlerOptions {
  onConnect?: (stream: any) => Promise<void>;
  onProgress?: (event: string, data: any, stream: any) => Promise<void>;
  onError?: (error: any, stream: any) => Promise<void>;
  onComplete?: (data: any, stream: any) => Promise<void>;
}

/**
 * Generic SSE handler
 */
export function createSSEHandler(options: SSEHandlerOptions = {}) {
  return (c: Context) => {
    return streamSSE(c, async (stream) => {
      try {
        // Connection event
        if (options.onConnect) {
          await options.onConnect(stream);
        } else {
          await stream.writeSSE({
            data: JSON.stringify({
              status: "connected",
              timestamp: new Date().toISOString(),
            }),
            event: "connected",
          });
        }

        // Further processing is implemented by the caller through callbacks
      } catch (error) {
        console.error("SSE processing error:", error);
        if (options.onError) {
          await options.onError(error, stream);
        } else {
          await stream.writeSSE({
            data: JSON.stringify({
              error: "An error occurred while processing the request",
              details: error instanceof Error ? error.message : "Unknown error",
            }),
            event: "error",
          });
        }
      }
    });
  };
}

/**
 * Workflow event handler for SSE
 */
export function createWorkflowEventHandler(stream: any, runId: string) {
  return async (event: any) => {
    // Create base event data
    const eventData: Record<string, any> = {
      type: event.type,
      timestamp: new Date().toISOString(),
      runId,
    };

    // Handle different event types
    if (event.type === "workflow-start") {
      eventData.message = "Analysis started";
    } else if (event.type === "workflow-complete") {
      eventData.message = "Analysis completed";
    } else if (event.type === "workflow-error") {
      eventData.message = "Error during analysis process";
      eventData.error = event.error?.message || "Unknown error";
    } else if (event.payload && event.payload.currentStep) {
      // Handle step events
      const currentStep = event.payload.currentStep;
      eventData.stepId = currentStep.id;

      if (currentStep.status === "running") {
        eventData.stepStatus = "start";
        eventData.message = `Starting step: ${currentStep.id}`;

        // Add detailed information for specific steps
        switch (currentStep.id) {
          case "prepare-tool-input":
            eventData.detail = {
              message: "Preparing investment analysis...",
            };
            break;
          case "tool-call":
            eventData.detail = {
              message: "Fetching DeFi data...",
            };
            break;
          case "agent-generate-report":
            eventData.detail = {
              message: "Analyzing investment opportunities...",
            };
            break;
          case "wrap-analysis-report":
            eventData.detail = {
              message: "Formatting analysis report...",
            };
            break;
          case "final-data-formatter":
            eventData.detail = {
              message: "Finalizing investment recommendations...",
            };
            break;
        }
      } else if (currentStep.status === "success") {
        eventData.stepStatus = "complete";
        eventData.message = `Completed step: ${currentStep.id}`;

        // Add completion details for specific steps
        switch (currentStep.id) {
          case "tool-call":
            if (currentStep.output) {
              eventData.detail = {
                dataFetched: true,
                message: "DeFi data retrieved successfully",
                poolsCount: currentStep.output.toolOutput?.pools?.length || 0,
              };
            }
            break;
          case "agent-generate-report":
            eventData.detail = {
              message: "Investment analysis complete",
            };
            break;
          case "final-data-formatter":
            eventData.detail = {
              message: "Results ready to display",
            };
            break;
        }
      } else if (currentStep.status === "failed") {
        eventData.stepStatus = "failed";
        eventData.message = `Step failed: ${currentStep.id}`;
        eventData.error = currentStep.error?.message || "Unknown error";
        eventData.detail = {
          message: "Error during analysis process",
        };
      }
    }

    // Send event
    await stream.writeSSE({
      data: JSON.stringify(eventData),
      event: "workflowProgress",
    });
  };
}

/**
 * Create a heartbeat handler for SSE connections
 */
export function createHeartbeatHandler(stream: any, intervalMs: number = 5000) {
  const heartbeatInterval = setInterval(async () => {
    try {
      await stream.writeSSE({
        data: JSON.stringify({ time: new Date().toISOString() }),
        event: "heartbeat",
      });
    } catch (error) {
      console.error("Error sending heartbeat:", error);
      clearInterval(heartbeatInterval);
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(heartbeatInterval),
  };
}

/**
 * Abort controller registry to manage workflow abortion
 */
export class AbortControllerRegistry {
  private controllers = new Map<string, AbortController>();

  register(runId?: string): { runId: string; controller: AbortController } {
    const id = runId || `run-${randomUUID()}`;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    return { runId: id, controller };
  }

  get(runId: string): AbortController | undefined {
    return this.controllers.get(runId);
  }

  abort(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (controller) {
      controller.abort();
      this.controllers.delete(runId);
      return true;
    }
    return false;
  }

  delete(runId: string): boolean {
    return this.controllers.delete(runId);
  }
}

// Create a singleton instance
export const workflowAbortRegistry = new AbortControllerRegistry();
