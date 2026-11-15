import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendMessage } from "../controllers/chat.controller";
import { safetyMiddleware } from "../middlewares/safety.middleware";

const chatRouter = Router();

chatRouter.post("/", safetyMiddleware, asyncHandler(sendMessage));

export default chatRouter;
