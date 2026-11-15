import { z } from "zod";

export const listConversationsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .default("1")
    .transform((val) => Number(val))
    .refine((val) => !isNaN(val) && val > 0, "page must be a positive integer"),
  limit: z
    .string()
    .optional()
    .default("20")
    .transform((val) => Number(val))
    .refine(
      (val) => !isNaN(val) && val > 0 && val <= 100,
      "limit must be between 1 and 100"
    ),
});

export const conversationIdParamSchema = z.object({
  id: z
    .string("Conversation ID is required")
    .trim()
    .min(1, "Conversation ID cannot be empty"),
});

export const updateConversationSchema = z.object({
  title: z
    .string("Title is required")
    .trim()
    .min(1, "Title cannot be empty")
    .max(100, "Title cannot exceed 100 characters"),
});

export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type UpdateConversationBody = z.infer<typeof updateConversationSchema>;
