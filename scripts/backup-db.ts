import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db.js";

const config = loadConfig();
const backupDirectory = process.env.BACKUP_DIRECTORY?.trim() || "./backups";
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || "14");
if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error("BACKUP_RETENTION_DAYS musi być dodatnią liczbą całkowitą.");
fs.mkdirSync(backupDirectory, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(backupDirectory, `attendance-${timestamp}.sqlite3`);
const db = openDatabase(config.databasePath);
await db.backup(destination);
db.close();
const check = openDatabase(destination);
const integrity = check.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
check.close();
if (integrity?.integrity_check !== "ok") throw new Error("Kopia SQLite nie przeszła PRAGMA integrity_check.");
const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
for (const entry of fs.readdirSync(backupDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.startsWith("attendance-") || !entry.name.endsWith(".sqlite3")) continue;
  const candidate = path.join(backupDirectory, entry.name);
  if (fs.statSync(candidate).mtimeMs < cutoff) fs.unlinkSync(candidate);
}
console.log(destination);
