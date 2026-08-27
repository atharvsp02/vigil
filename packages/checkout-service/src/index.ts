import { loadConfig } from "./config.js";
import { openDatabase, pruneLogs } from "./db.js";
import { createApp } from "./app.js";
import { seedDeployHistory } from "./seed.js";

const config = loadConfig();
const db = openDatabase(config.DATABASE_PATH);
seedDeployHistory(db);

let boundPort = config.PORT;
const app = createApp({
  db,
  serviceName: config.SERVICE_NAME,
  adminToken: config.ADMIN_TOKEN,
  replayToken: config.REPLAY_TOKEN,
  selfBaseUrl: () => `http://127.0.0.1:${boundPort}`,
});

const server = app.listen(config.PORT, () => {
  const address = server.address();
  if (address && typeof address === "object") {
    boundPort = address.port;
  }
  process.stdout.write(
    `${JSON.stringify({ event: "listening", service: config.SERVICE_NAME, port: boundPort })}\n`,
  );
});

const pruneTimer = setInterval(() => {
  const cutoff = new Date(Date.now() - config.LOG_RETENTION_HOURS * 3_600_000).toISOString();
  pruneLogs(db, cutoff);
}, 600_000);
pruneTimer.unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
