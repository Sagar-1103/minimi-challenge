import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const requiredEnv = (key: string) => {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Environment variable "${key}" not defined`)
    }
    return value;
}

const optionalEnv = (key: string, defaultValue: string) => {
    const value = process.env[key];
    return value ?? defaultValue;
}

export const env = {
    PORT: Number(optionalEnv("PORT","8000")),
    DATABASE_URL: requiredEnv("DATABASE_URL"),
}