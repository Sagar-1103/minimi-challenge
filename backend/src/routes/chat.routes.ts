import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendMessage } from "../controllers/chat.controller";
import { streamChat } from "../controllers/chat-stream.controller";
import { safetyMiddleware } from "../middlewares/safety.middleware";

const chatRouter = Router();

// Synchronous chat response endpoint
chatRouter.post("/", safetyMiddleware, asyncHandler(sendMessage));

// SSE streaming chat response endpoint
chatRouter.post("/stream", safetyMiddleware, asyncHandler(streamChat));

export default chatRouter;
