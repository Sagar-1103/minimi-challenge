import type { Request, Response } from "express";
import { runAgentStreaming } from "../services/agent";
import { AgentEventEmitter } from "../services/agent-emitter";
import { chatRequestSchema } from "../schemas/chat.schema";
import { sendValidationError } from "../utils/validation";
import { logger } from "../utils/logger";

// Server-Sent Events (SSE) streaming controller for real-time tokens and tool events
export async function streamChat(req: Request, res: Response): Promise<void> {
  const parseResult = chatRequestSchema.safeParse(req.body);

  if (!parseResult.success) {
    sendValidationError(res, parseResult.error);
    return;
  }

  const { message, conversationId, timezone, userDate } = parseResult.data;

  // Set SSE streaming headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const abortController = new AbortController();

  res.on("close", () => {
    if (!res.writableEnded) {
      logger.info("Client connection closed; aborting active agent stream");
      abortController.abort();
    }
  });

  const emitter = new AgentEventEmitter();

  emitter.on("status", (data) => {
    res.write(`event: status\ndata: ${JSON.stringify(data)}\n\n`);
  });

  emitter.on("tool_start", (data) => {
    res.write(`event: tool_start\ndata: ${JSON.stringify(data)}\n\n`);
  });

  emitter.on("tool_end", (data) => {
    res.write(`event: tool_end\ndata: ${JSON.stringify(data)}\n\n`);
  });

  emitter.on("answer_start", () => {
    res.write(`event: answer_start\ndata: {}\n\n`);
  });

  emitter.on("answer_chunk", (data) => {
    res.write(`event: answer_chunk\ndata: ${JSON.stringify(data)}\n\n`);
  });

  emitter.on("answer_end", (data) => {
    res.write(`event: answer_end\ndata: ${JSON.stringify(data)}\n\n`);
  });

  emitter.on("sources", (data) => {
    res.write(`event: sources\ndata: ${JSON.stringify(data)}\n\n`);
  });

  emitter.on("error", (data) => {
    res.write(`event: error\ndata: ${JSON.stringify(data)}\n\n`);
  });

  emitter.on("done", (data) => {
    res.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`);
    res.end();
  });

  try {
    await runAgentStreaming(
      message,
      {
        conversationId,
        timezone,
        referenceDate: userDate ? new Date(userDate) : undefined,
      },
      emitter,
      abortController.signal
    );
  } catch (err: any) {
    logger.error(`Streaming agent execution error: ${err.message}`);
    emitter.emitError(err.message, "STREAM_EXECUTION_ERROR");
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}
