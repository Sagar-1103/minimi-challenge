import type { Response } from "express";
import type { ZodError } from "zod";

export interface ValidationErrorResponse {
  success: false;
  error: "validation_error";
  issues: Array<{
    path: string;
    message: string;
  }>;
}

export function formatValidationError(error: ZodError): ValidationErrorResponse {
  return {
    success: false,
    error: "validation_error",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export function sendValidationError(res: Response, error: ZodError): Response {
  return res.status(400).json(formatValidationError(error));
}
