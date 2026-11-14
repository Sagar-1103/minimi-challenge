import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendMessage } from "../controllers/chat.controller";

const chatRouter = Router();

chatRouter.post("/", asyncHandler(sendMessage));

export default chatRouter;
