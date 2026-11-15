import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import {
  listConversations,
  getConversation,
  updateConversation,
  deleteConversation,
} from "../controllers/conversation.controller";

const conversationRouter = Router();

conversationRouter.get("/", asyncHandler(listConversations));
conversationRouter.get("/:id", asyncHandler(getConversation));
conversationRouter.patch("/:id", asyncHandler(updateConversation));
conversationRouter.delete("/:id", asyncHandler(deleteConversation));

export default conversationRouter;
