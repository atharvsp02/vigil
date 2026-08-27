import express from "express";
import type { Express } from "express";
import type { Db } from "./db.js";
import { Logger } from "./logger.js";
import { adminRouter } from "./routes/admin.js";
import { checkoutRouter } from "./routes/checkout.js";
import { observabilityRouter } from "./routes/observability.js";

export interface AppOptions {
  db: Db;
  serviceName: string;
  adminToken: string;
  replayToken: string;
  selfBaseUrl: () => string;
  echoLogsToStdout?: boolean;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  const logger = new Logger(options.db, options.serviceName, options.echoLogsToStdout ?? true);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.use(checkoutRouter(options.db, logger));
  app.use(observabilityRouter(options.db, options.serviceName, options.replayToken));
  app.use(
    "/admin",
    adminRouter(options.db, logger, {
      adminToken: options.adminToken,
      selfBaseUrl: options.selfBaseUrl,
    }),
  );

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}
