import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { MoodleClient } from "../src/moodle.js";
import { safeStatusSummary } from "../src/status.js";

const index = process.argv.indexOf("--session-id");
const sessionId = index >= 0 ? Number(process.argv[index + 1]) : NaN;
if (!Number.isInteger(sessionId) || sessionId <= 0) {
  console.error("Użycie: npm run inspect:moodle-statuses -- --session-id <ID>");
  process.exit(2);
}
const config = loadConfig();
const client = new MoodleClient(config, createLogger({ logLevel: "warn" }));
const session = await client.getSession(sessionId);
console.log(JSON.stringify({ sessionId, statuses: safeStatusSummary(session.statuses) }, null, 2));
