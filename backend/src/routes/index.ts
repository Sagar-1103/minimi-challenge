import { Request, Response, Router } from "express";
import chatRouter from "./chat.routes";
import conversationRouter from "./conversation.routes";
import { prisma } from "../lib/prisma";
import { getActiveLLMConfig } from "../config/llm";
import { env } from "../config/env";

const appRouter = Router();

// Deep health check route -> GET /api/health
appRouter.get("/health", async (_req: Request, res: Response) => {
  let dbStatus = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = "error";
  }

  const llmConfig = getActiveLLMConfig();
  const llmStatus = llmConfig.apiKey ? "ok" : "unconfigured";
  const tavilyStatus = env.TAVILY_API_KEY ? "ok" : "unconfigured";

  const checks = {
    server: "ok",
    database: dbStatus,
    llm: llmStatus,
    tavily: tavilyStatus,
  };

  const isHealthy = checks.server === "ok" && checks.database === "ok";

  return res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "healthy" : "degraded",
    checks,
    timestamp: new Date().toISOString(),
  });
});

// chat routes -> POST /api/chat & POST /api/chat/stream
appRouter.use("/chat", chatRouter);

// conversation routes -> /api/conversations
appRouter.use("/conversations", conversationRouter);

export default appRouter;
