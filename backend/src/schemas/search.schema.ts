import { z } from "zod";

export const webSearchArgsSchema = z.object({
  query: z
    .string("Search query is required")
    .trim()
    .min(1, "Search query cannot be empty"),
});

export type WebSearchArgs = z.infer<typeof webSearchArgsSchema>;
