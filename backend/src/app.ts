import express, { Request, Response } from "express";
import cors from "cors";

const app = express();

app.use(cors({
    origin: "*",
}));

app.use(express.json());

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;