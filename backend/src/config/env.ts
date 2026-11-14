import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import dotenv from "dotenv";
import { envSchema } from "../schemas/env.schema";

const __dirname = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));

const candidatePaths = [
  path.resolve(__dirname, "../../../.env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../.env"),
];

for (const envPath of candidatePaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  const formattedIssues = parseResult.error.issues
    .map((issue) => ` - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Environment configuration error:\n${formattedIssues}`);
}

export const env = parseResult.data;