import { z } from "zod";

export const chatRequestSchema = z.object({
  message: z
    .string("Message is required")
    .trim()
    .min(1, "Message cannot be empty"),
  conversationId: z
    .string("Conversation ID must be a string")
    .trim()
    .min(1, "Conversation ID cannot be empty")
    .optional(),
  timezone: z.string().optional(),
  userDate: z.string().optional(),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
