import type { AppConfig, CourseConfig } from "./types.js";

const DEFAULT_COURSES: CourseConfig[] = [
  { course: "Statystyka", attendanceId: 61195 },
  { course: "Psychologia społeczna", attendanceId: 61234 }
];

function required(env: NodeJS.ProcessEnv, name: string, production: boolean): string {
  const value = env[name]?.trim() ?? "";
  if (production && !value) throw new Error(`Brak wymaganej zmiennej ${name}.`);
  return value;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, minimum = 1): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} musi być liczbą całkowitą >= ${minimum}.`);
  return value;
}

function optionalInteger(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} musi być dodatnią liczbą całkowitą.`);
  return value;
}

function boolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} musi mieć wartość true albo false.`);
}

function url(env: NodeJS.ProcessEnv, name: string, fallback: string, production: boolean): string {
  const raw = required(env, name, production) || fallback;
  const parsed = new URL(raw);
  if (production && parsed.protocol !== "https:") throw new Error(`${name} musi używać HTTPS w produkcji.`);
  return parsed.toString().replace(/\/$/, "");
}

function courses(env: NodeJS.ProcessEnv): CourseConfig[] {
  const raw = env.COURSES_JSON?.trim();
  if (!raw) return DEFAULT_COURSES;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("COURSES_JSON nie jest poprawnym JSON-em."); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("COURSES_JSON musi być niepustą tablicą.");
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`COURSES_JSON[${index}] ma nieprawidłowy format.`);
    const record = item as Record<string, unknown>;
    const course = typeof record.course === "string" ? record.course.trim() : "";
    const attendanceId = Number(record.attendanceId);
    if (!course || !Number.isInteger(attendanceId) || attendanceId <= 0) {
      throw new Error(`COURSES_JSON[${index}] wymaga course i dodatniego attendanceId.`);
    }
    return { course, attendanceId };
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnvRaw = env.NODE_ENV?.trim() || "development";
  if (!["development", "test", "production"].includes(nodeEnvRaw)) throw new Error("NODE_ENV ma nieprawidłową wartość.");
  const nodeEnv = nodeEnvRaw as AppConfig["nodeEnv"];
  const production = nodeEnv === "production";
  const authSecret = required(env, "AUTH_SECRET", production) || "test-auth-secret-at-least-32-characters";
  const adminPassword = required(env, "ADMIN_PASSWORD", production) || "development-password";
  const moodleToken = required(env, "MOODLE_TOKEN", production);
  if (production && authSecret.length < 32) throw new Error("AUTH_SECRET musi mieć co najmniej 32 znaki.");
  if (production && adminPassword.length < 12) throw new Error("ADMIN_PASSWORD musi mieć co najmniej 12 znaków.");

  const presentStatusAcronym = (env.MOODLE_PRESENT_STATUS_ACRONYM || "P").trim().toUpperCase();
  const absentStatusAcronym = (env.MOODLE_ABSENT_STATUS_ACRONYM || "A").trim().toUpperCase();
  if (!presentStatusAcronym || !absentStatusAcronym || presentStatusAcronym === absentStatusAcronym) {
    throw new Error("Akronimy statusów Moodle muszą być niepuste i różne.");
  }

  return {
    nodeEnv,
    port: integer(env, "PORT", 3000),
    publicUrl: url(env, "PUBLIC_URL", "http://localhost:3000", production),
    allowedOrigin: url(env, "ALLOWED_ORIGIN", "http://localhost:3000", production),
    trustProxy: boolean(env, "TRUST_PROXY", false),
    databasePath: env.DATABASE_PATH?.trim() || "./data/attendance.sqlite3",
    moodleBaseUrl: url(env, "MOODLE_BASE_URL", "https://moodle2.e-wsb.pl", production),
    moodleToken,
    moodleTimeoutMs: integer(env, "MOODLE_TIMEOUT_MS", 10_000, 1000),
    adminPassword,
    authSecret,
    adminSessionSeconds: integer(env, "ADMIN_SESSION_SECONDS", 28_800, 300),
    loginWindowSeconds: integer(env, "LOGIN_WINDOW_SECONDS", 900, 60),
    maxLoginAttempts: integer(env, "MAX_LOGIN_ATTEMPTS", 5),
    publicFailureWindowSeconds: integer(
      env,
      "PUBLIC_FAILURE_WINDOW_SECONDS",
      900,
      60
    ),
    maxPublicFailures: integer(env, "MAX_PUBLIC_FAILURES", 60),
    presentStatusAcronym,
    absentStatusAcronym,
    moodleTakenById: optionalInteger(env, "MOODLE_TAKEN_BY_ID"),
    moodleStatusSet: optionalInteger(env, "MOODLE_STATUS_SET"),
    courses: courses(env),
    openSeconds: integer(env, "OPEN_SECONDS", 900, 60),
    logLevel: (["debug", "info", "warn", "error"].includes(env.LOG_LEVEL || "") ? env.LOG_LEVEL : "info") as AppConfig["logLevel"]
  };
}
