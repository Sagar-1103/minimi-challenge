import type { Request, Response } from "express";
import { conversationService } from "../services/conversation.service";
import {
  listConversationsQuerySchema,
  conversationIdParamSchema,
  updateConversationSchema,
} from "../schemas/conversation.schema";
import { sendValidationError } from "../utils/validation";
import { NotFoundError } from "../middlewares/errorHandler";

export async function listConversations(
  req: Request,
  res: Response
): Promise<Response> {
  const queryResult = listConversationsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return sendValidationError(res, queryResult.error);
  }

  const { page, limit } = queryResult.data;
  const result = await conversationService.list(page, limit);

  return res.status(200).json({
    success: true,
    ...result,
  });
}

export async function getConversation(
  req: Request,
  res: Response
): Promise<Response> {
  const paramResult = conversationIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return sendValidationError(res, paramResult.error);
  }

  const { id } = paramResult.data;
  const conversation = await conversationService.getById(id);

  if (!conversation) {
    throw new NotFoundError(`Conversation with ID "${id}" not found`);
  }

  return res.status(200).json({
    success: true,
    conversation,
  });
}

export async function updateConversation(
  req: Request,
  res: Response
): Promise<Response> {
  const paramResult = conversationIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return sendValidationError(res, paramResult.error);
  }

  const bodyResult = updateConversationSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return sendValidationError(res, bodyResult.error);
  }

  const { id } = paramResult.data;
  const { title } = bodyResult.data;

  const updated = await conversationService.updateTitle(id, title);

  return res.status(200).json({
    success: true,
    conversation: updated,
  });
}

export async function deleteConversation(
  req: Request,
  res: Response
): Promise<Response> {
  const paramResult = conversationIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return sendValidationError(res, paramResult.error);
  }

  const { id } = paramResult.data;
  await conversationService.delete(id);

  return res.status(200).json({
    success: true,
    message: "Conversation deleted successfully",
  });
}
