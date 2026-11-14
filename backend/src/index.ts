import app from "./app";
import { env } from "./constants/env";

app.listen(env.PORT, () => {
  console.log(`Backend server running on http://localhost:${env.PORT}`);
});