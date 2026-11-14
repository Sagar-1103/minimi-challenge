import type { Request, Response } from "express";
import { runAgent } from "../services/agent";
import { chatRequestSchema } from "../schemas/chat.schema";
import { sendValidationError } from "../utils/validation";
import type { ChatResponse } from "../types/chat.types";

export async function sendMessage(
  req: Request,
  res: Response
): Promise<Response> {
  const parseResult = chatRequestSchema.safeParse(req.body);

  if (!parseResult.success) {
    return sendValidationError(res, parseResult.error);
  }

  const { message, conversationId } = parseResult.data;

  const result = await runAgent(message, {
    conversationId,
  });

  const response: ChatResponse = {
    answer: result.answer,
    conversationId: result.conversationId,
    messageId: result.messageId,
    sources: result.sources,
    steps: result.steps,
  };

  return res.status(200).json(response);
}
