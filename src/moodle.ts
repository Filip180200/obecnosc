import type { AppConfig, JsonObject, MoodleGateway } from "./types.js";
import type { Logger } from "./logger.js";

export class MoodleError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 502) { super(message); }
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export class MoodleClient implements MoodleGateway {
  constructor(private readonly config: AppConfig, private readonly logger: Logger) {}

  private async call(functionName: string, parameters: Record<string, string | number>, readOnly: boolean): Promise<unknown> {
    const attempts = readOnly ? 2 : 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.moodleTimeoutMs);
      try {
        const url = new URL("/webservice/rest/server.php", this.config.moodleBaseUrl);
        url.search = new URLSearchParams({
          wstoken: this.config.moodleToken,
          wsfunction: functionName,
          moodlewsrestformat: "json"
        }).toString();
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams(Object.entries(parameters).map(([key, value]) => [key, String(value)])).toString(),
          signal: controller.signal
        });
        if (!response.ok) {
          if (readOnly && attempt < attempts && response.status >= 500) continue;
          throw new MoodleError(`Moodle zwrócił HTTP ${response.status}.`, "moodle_http");
        }
        const result: unknown = await response.json();
        if (isJsonObject(result) && (result.exception || result.errorcode)) {
          throw new MoodleError("Moodle odrzucił operację.", "moodle_api");
        }
        return result;
      } catch (error) {
        const timeout = error instanceof Error && error.name === "AbortError";
        if (readOnly && attempt < attempts && (timeout || error instanceof TypeError)) continue;
        this.logger.warn("moodle_request_failed", { functionName, attempt, timeout, errorCode: error instanceof MoodleError ? error.code : "network" });
        if (error instanceof MoodleError) throw error;
        throw new MoodleError(timeout ? "Moodle nie odpowiedział w wymaganym czasie." : "Nie udało się połączyć z Moodle.", timeout ? "moodle_timeout" : "moodle_network");
      } finally {
        clearTimeout(timer);
      }
    }
    throw new MoodleError("Nie udało się wykonać żądania Moodle.", "moodle_unknown");
  }

  async getSessions(attendanceId: number): Promise<JsonObject[]> {
    const result = await this.call("mod_attendance_get_sessions", { attendanceid: attendanceId }, true);
    if (!Array.isArray(result)) throw new MoodleError("Moodle zwrócił nieprawidłową listę sesji.", "moodle_contract");
    return result.filter((item): item is JsonObject => Boolean(item && typeof item === "object"));
  }

  async getSession(sessionId: number): Promise<JsonObject> {
    const result = await this.call("mod_attendance_get_session", { sessionid: sessionId }, true);
    if (!isJsonObject(result)) throw new MoodleError("Moodle zwrócił nieprawidłową sesję.", "moodle_contract");
    return result;
  }

  async updateUserStatus(payload: Record<string, number>): Promise<JsonObject> {
    const result = await this.call("mod_attendance_update_user_status", payload, false);
    if (!isJsonObject(result)) return { ok: true };
    return result;
  }
}
