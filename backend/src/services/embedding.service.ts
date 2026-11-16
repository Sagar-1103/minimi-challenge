import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export interface EmbeddingOptions {
  model?: string;
  timeoutMs?: number;
}

export class EmbeddingService {
  private provider: string;
  private defaultModel: string;
  private dimensions: number;
  private geminiClient?: GoogleGenAI;
  private openRouterApiKey: string;
  private openRouterBaseURL: string;
  private queryCache: Map<string, number[]> = new Map();
  private maxCacheSize = 1000;

  constructor() {
    this.provider = env.EMBEDDING_PROVIDER || "gemini";
    this.defaultModel = env.EMBEDDING_MODEL || "gemini-embedding-2";
    this.dimensions = env.EMBEDDING_DIMENSIONS || 768;

    // Initialize Google Gemini official SDK if configured
    if (this.provider === "gemini" && env.EMBEDDING_API_KEY) {
      try {
        this.geminiClient = new GoogleGenAI({ apiKey: env.EMBEDDING_API_KEY });
      } catch (err: any) {
        logger.warn(`Failed to initialize Google GenAI SDK: ${err.message}`);
      }
    }

    // OpenRouter fallback configuration
    this.openRouterApiKey = env.EMBEDDING_API_KEY || env.OPENROUTER_API_KEY || "";
    this.openRouterBaseURL = env.EMBEDDING_BASE_URL || "https://openrouter.ai/api/v1";
  }

  public getModel(): string {
    return this.defaultModel;
  }

  public getDimensions(): number {
    return this.dimensions;
  }

  public getProvider(): string {
    return this.provider;
  }

  // Generate a vector for a single text input
  async getEmbedding(text: string, options: EmbeddingOptions = {}): Promise<number[]> {
    const cleanText = text.trim();
    if (!cleanText) {
      return new Array(this.dimensions).fill(0);
    }

    // Check query cache
    const cacheKey = `${options.model || this.defaultModel}::${cleanText}`;
    if (this.queryCache.has(cacheKey)) {
      return this.queryCache.get(cacheKey)!;
    }

    const embeddings = await this.getEmbeddingsBatch([cleanText], options);
    const result = embeddings[0] || new Array(this.dimensions).fill(0);

    // Store in cache (with basic eviction if size exceeds limit)
    if (this.queryCache.size >= this.maxCacheSize) {
      const firstKey = this.queryCache.keys().next().value;
      if (firstKey) this.queryCache.delete(firstKey);
    }
    this.queryCache.set(cacheKey, result);

    return result;
  }

  // Generate embeddings for multiple text snippets in one batch
  async getEmbeddingsBatch(
    texts: string[],
    options: EmbeddingOptions = {}
  ): Promise<number[][]> {
    if (texts.length === 0) return [];

    const model = options.model || this.defaultModel;

    // 1. Google Gemini via Official @google/genai SDK
    if (this.provider === "gemini" && this.geminiClient) {
      try {
        const results = await Promise.all(
          texts.map(async (text) => {
            const clean = text.trim() ? text.trim().slice(0, 8000) : "empty";
            try {
              const res: any = await this.geminiClient!.models.embedContent({
                model,
                contents: clean,
                config: { outputDimensionality: this.dimensions },
              });
              const values = res.embeddings?.[0]?.values || res.embedding?.values;
              if (Array.isArray(values) && values.length === this.dimensions) {
                return values;
              }
              return new Array(this.dimensions).fill(0);
            } catch (itemErr: any) {
              logger.warn(`Gemini item embed error: ${itemErr.message}`);
              return new Array(this.dimensions).fill(0);
            }
          })
        );
        return results;
      } catch (err: any) {
        logger.warn(`Google GenAI embedding SDK error: ${err.message}`);
      }
    }

    // 2. OpenRouter or Custom OpenAI-compatible fallback
    if (this.openRouterApiKey) {
      return this.getEmbeddingsViaOpenRouter(texts, options);
    }

    logger.warn("No active embedding provider credentials configured; returning zero vectors");
    return texts.map(() => new Array(this.dimensions).fill(0));
  }

  // Fallback for OpenRouter / OpenAI endpoints
  private async getEmbeddingsViaOpenRouter(
    texts: string[],
    options: EmbeddingOptions = {}
  ): Promise<number[][]> {
    const model = options.model || this.defaultModel;
    const timeoutMs = options.timeoutMs ?? 8000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.openRouterBaseURL}/embeddings`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.openRouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "Minimi Agent",
        },
        body: JSON.stringify({
          model,
          input: texts.map((t) => (t.trim() ? t.trim().slice(0, 8000) : "empty")),
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter Embeddings API failed (${response.status}): ${errText}`);
      }

      const json: any = await response.json();
      if (!json.data || !Array.isArray(json.data)) {
        throw new Error(`Malformed embeddings response from provider`);
      }

      const sorted = json.data.sort((a: any, b: any) => a.index - b.index);
      return sorted.map((d: any) => d.embedding);
    } catch (err: any) {
      clearTimeout(timer);
      logger.warn(`Fallback embedding generation failed: ${err.message}`);
      return texts.map(() => new Array(this.dimensions).fill(0));
    }
  }
}

export const embeddingService = new EmbeddingService();
