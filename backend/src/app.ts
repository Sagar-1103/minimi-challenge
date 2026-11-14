import express from "express";
import cors from "cors";
import appRouter from "./routes";
import { errorHandler } from "./middlewares/errorHandler";

const app = express();

app.use(
  cors({
    origin: "*",
  })
);

app.use(express.json());

app.use("/api", appRouter);

app.use(errorHandler);

export default app;