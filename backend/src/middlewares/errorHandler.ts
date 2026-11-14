import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../utils/logger";
import { formatValidationError } from "../utils/validation";

export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public details?: any;

  constructor(message: string, statusCode = 500, code = "INTERNAL_SERVER_ERROR", details?: any) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, "validation_error", details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 404, "NOT_FOUND", details);
  }
}

export class LLMError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 502, "LLM_ERROR", details);
  }
}

export class SearchError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 502, "SEARCH_ERROR", details);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 429, "RATE_LIMIT_ERROR", details);
  }
}

export const errorHandler: ErrorRequestHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof ZodError) {
    logger.warn(`[Validation Error] Zod validation failed: ${err.message}`);
    res.status(400).json(formatValidationError(err));
    return;
  }

  const statusCode = err.statusCode && typeof err.statusCode === "number" ? err.statusCode : 500;
  const errorCode = err.code || "INTERNAL_SERVER_ERROR";
  const message = err.message || "An unexpected error occurred";

  logger.error(`[Error Handler] ${errorCode} (${statusCode}): ${message}`, err);

  res.status(statusCode).json({
    error: errorCode,
    message,
    ...(process.env.NODE_ENV !== "production"
      ? { details: err.details ?? err.stack }
      : {}),
  });
};
