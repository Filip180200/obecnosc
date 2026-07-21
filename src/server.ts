import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { createLogger } from "./logger.js";
import { MoodleClient } from "./moodle.js";
import {
  GoogleAttendanceService,
  googleConfigFromEnv
} from "./google.js";
import { createApp } from "./app.js";

const config = loadConfig();
const logger = createLogger(config);
const db = openDatabase(config.databasePath);
const moodle = new MoodleClient(config, logger);
const googleConfig = googleConfigFromEnv();
const googleAttendance = googleConfig
  ? new GoogleAttendanceService(googleConfig)
  : null;
const clock = {
  nowSeconds: () => Math.floor(Date.now() / 1000)
};
const app = createApp({
  config,
  db,
  moodle,
  google: googleAttendance,
  logger,
  clock
});

const server = serve(
  { fetch: app.fetch, port: config.port },
  (info) => {
    logger.info("server_started", {
      port: info.port,
      nodeEnv: config.nodeEnv,
      databasePath: config.databasePath,
      googleEnabled: Boolean(googleAttendance)
    });
  }
);

let closing = false;
const shutdown = (signal: string): void => {
  if (closing) return;
  closing = true;
  logger.info("server_stopping", { signal });
  server.close((error) => {
    try {
      db.close();
    } finally {
      if (error) {
        logger.error("server_shutdown_failed", {
          errorCode: "close_error"
        });
        process.exitCode = 1;
      }
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
