import type { Request, Response, NextFunction } from "express";
import { promptProtection } from "../services/safety/prompt-protection";
import { contentFilter } from "../services/safety/content-filter";

// Middleware to intercept prompt extraction attempts and harmful queries before execution
export function safetyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): any {
  const { message } = req.body || {};

  if (typeof message === "string") {
    // Check for system prompt extraction attempts
    if (promptProtection.detectSystemPromptExtraction(message)) {
      return res.status(200).json({
        answer: promptProtection.getRefusalResponse(),
        conversationId: req.body.conversationId,
        messageId: `msg_${Date.now()}`,
        sources: [],
        steps: [
          {
            index: 1,
            type: "final_answer",
            output: promptProtection.getRefusalResponse(),
            timestamp: new Date().toISOString(),
          },
        ],
      });
    }

    // Check for prohibited content
    const safetyCheck = contentFilter.checkUserMessage(message);
    if (!safetyCheck.safe) {
      return res.status(400).json({
        error: "CONTENT_FILTERED",
        message: safetyCheck.reason || "I cannot assist with that request.",
      });
    }
  }

  next();
}
