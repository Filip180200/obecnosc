import type { AppConfig, JsonObject } from "./types.js";

export class StatusMappingError extends Error {}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function statusAcronym(status: JsonObject): string {
  for (const key of ["acronym", "statusacronym", "shortname"]) {
    const value = normalized(status[key]);
    if (value) return value;
  }
  return "";
}

export function resolveStatusId(statuses: unknown, wantedAcronym: string): number {
  if (!Array.isArray(statuses)) throw new StatusMappingError("Moodle nie zwrócił tablicy statusów.");
  const wanted = normalized(wantedAcronym);
  const matches = statuses.filter((item): item is JsonObject => Boolean(item && typeof item === "object" && statusAcronym(item as JsonObject) === wanted));
  if (matches.length !== 1) throw new StatusMappingError(`Nie można jednoznacznie znaleźć statusu Moodle ${wanted}.`);
  const match = matches[0];
  if (!match) throw new StatusMappingError(`Nie można znaleźć statusu Moodle ${wanted}.`);
  const id = positiveInteger(match.id);
  if (!id) throw new StatusMappingError(`Status Moodle ${wanted} nie ma poprawnego ID.`);
  return id;
}

function firstPositive(session: JsonObject, keys: string[]): number | null {
  for (const key of keys) {
    const value = positiveInteger(session[key]);
    if (value) return value;
  }
  return null;
}

export function buildAttendanceUpdatePayload(
  config: Pick<AppConfig, "presentStatusAcronym" | "moodleTakenById" | "moodleStatusSet">,
  sessionId: number,
  studentId: number,
  session: JsonObject,
  explicitStatusId?: number
): Record<string, number> {
  const statusId = explicitStatusId ?? resolveStatusId(session.statuses, config.presentStatusAcronym);
  const takenById = firstPositive(session, ["lasttakenby", "takenbyid", "lasttakenbyid", "takenby"]) ?? config.moodleTakenById ?? null;
  const statusSet = firstPositive(session, ["statusset", "statussetid", "statussetvalue"]) ?? config.moodleStatusSet ?? null;
  if (!takenById) throw new StatusMappingError("Brak takenbyid w odpowiedzi Moodle i konfiguracji.");
  if (!statusSet) throw new StatusMappingError("Brak statusset w odpowiedzi Moodle i konfiguracji.");
  return { sessionid: sessionId, studentid: studentId, takenbyid: takenById, statusid: statusId, statusset: statusSet };
}

export function safeStatusSummary(statuses: unknown): JsonObject[] {
  if (!Array.isArray(statuses)) return [];
  return statuses.filter((item): item is JsonObject => Boolean(item && typeof item === "object")).map((status) => ({
    id: positiveInteger(status.id),
    acronym: statusAcronym(status),
    description: typeof status.description === "string" ? status.description : null,
    grade: typeof status.grade === "number" || typeof status.grade === "string" ? status.grade : null,
    fields: Object.keys(status).sort()
  }));
}
