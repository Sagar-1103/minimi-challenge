import { Request, Response, Router } from "express";
import chatRouter from "./chat.routes";

const appRouter = Router();

// health route -> GET /api/health
appRouter.get("/health", (_req: Request, res: Response) => {
  return res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// chat routes -> POST /api/chat
appRouter.use("/chat", chatRouter);

export default appRouter;
