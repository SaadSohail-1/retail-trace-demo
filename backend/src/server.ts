import { app } from "./app.js";
import { prisma } from "./config/database.js";
import { env } from "./config/env.js";

async function startServer(): Promise<void> {
  await prisma.$connect();
  app.listen(env.port, () => {
    console.log(`Verdant Store backend listening on port ${env.port}`);
  });
}

startServer().catch((error: unknown) => {
  console.error("Failed to start the backend:", error);
  process.exitCode = 1;
});
