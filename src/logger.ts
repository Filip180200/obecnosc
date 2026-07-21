import type { AppConfig, JsonObject } from "./types.js";

const SECRET_KEYS = new Set([
  "authorization", "cookie", "set-cookie", "password", "token", "wstoken",
  "moodle_token", "admin_password", "auth_secret", "firstname", "lastname",
  "student", "students", "users", "attendance_log"
]);

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  const output: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SECRET_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : redact(item, seen);
  }
  return output;
}

export interface Logger {
  debug(event: string, fields?: JsonObject): void;
  info(event: string, fields?: JsonObject): void;
  warn(event: string, fields?: JsonObject): void;
  error(event: string, fields?: JsonObject): void;
}

export function createLogger(config: Pick<AppConfig, "logLevel">): Logger {
  const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
  const threshold = levels[config.logLevel];
  const write = (level: keyof typeof levels, event: string, fields: JsonObject = {}): void => {
    if (levels[level] < threshold) return;
    const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...redact(fields) as JsonObject });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields)
  };
}
