import { z } from "zod";

export const envSchema = z
  .object({
    PORT: z
      .string()
      .default("8000")
      .transform((val) => Number(val))
      .refine((val) => !isNaN(val) && val > 0, "PORT must be a positive number"),
    API_BASE_URL: z.string().default("http://localhost:8000"),
    DATABASE_URL: z.string().default("postgresql://user:password@localhost:5432/minimi_db"),
    LLM_PROVIDER: z.enum(["deepseek", "openrouter"]).default("deepseek"),
    DEEPSEEK_API_KEY: z.string().optional().default(""),
    DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
    DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
    OPENROUTER_API_KEY: z.string().optional().default(""),
    OPENROUTER_MODEL: z.string().default("deepseek/deepseek-chat"),
    OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
    TAVILY_API_KEY: z.string().min(1, "TAVILY_API_KEY is required"),
    EMBEDDING_PROVIDER: z.string().default("gemini"),
    EMBEDDING_MODEL: z.string().default("gemini-embedding-2"),
    EMBEDDING_API_KEY: z.string().optional().default(""),
    EMBEDDING_BASE_URL: z.string().default("https://generativelanguage.googleapis.com/v1beta"),
    EMBEDDING_DIMENSIONS: z
      .string()
      .default("768")
      .transform((val) => Number(val))
      .refine((val) => !isNaN(val) && val > 0, "EMBEDDING_DIMENSIONS must be a positive number"),
    VECTOR_SEARCH_THRESHOLD: z
      .string()
      .default("0.45")
      .transform((val) => Number(val))
      .refine(
        (val) => !isNaN(val) && val >= 0 && val <= 1,
        "VECTOR_SEARCH_THRESHOLD must be between 0 and 1"
      ),
    VECTOR_SEARCH_LIMIT: z
      .string()
      .default("5")
      .transform((val) => Number(val))
      .refine((val) => !isNaN(val) && val > 0, "VECTOR_SEARCH_LIMIT must be a positive number"),
  })
  .superRefine((data, ctx) => {
    if (data.LLM_PROVIDER === "deepseek" && (!data.DEEPSEEK_API_KEY || data.DEEPSEEK_API_KEY.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DEEPSEEK_API_KEY"],
        message: 'DEEPSEEK_API_KEY is required when LLM_PROVIDER is "deepseek"',
      });
    }

    if (data.LLM_PROVIDER === "openrouter" && (!data.OPENROUTER_API_KEY || data.OPENROUTER_API_KEY.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENROUTER_API_KEY"],
        message: 'OPENROUTER_API_KEY is required when LLM_PROVIDER is "openrouter"',
      });
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;
