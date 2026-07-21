import type { AppConfig, JsonObject, MoodleGateway } from "./types.js";
import { buildAttendanceUpdatePayload, resolveStatusId } from "./status.js";

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeName(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLocaleLowerCase("pl").normalize("NFD").replace(/\p{Diacritic}/gu, "")
    : "";
}

function array(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item && typeof item === "object")) : [];
}

export interface StudentStatus {
  id: number;
  name: string;
  present: boolean;
}

export class AttendanceService {
  constructor(private readonly config: AppConfig, private readonly moodle: MoodleGateway) {}

  async validateSession(attendanceId: number, sessionId: number): Promise<void> {
    const sessions = await this.moodle.getSessions(attendanceId);
    if (!sessions.some((item) => positiveInteger(item.id) === sessionId)) throw new Error("Wybrana sesja nie należy do wskazanego kursu.");
  }

  async listSessions(attendanceId: number): Promise<JsonObject[]> {
    const sessions = await this.moodle.getSessions(attendanceId);
    return sessions.sort((one, two) => Number(one.sessdate ?? 0) - Number(two.sessdate ?? 0));
  }

  async stats(sessionId: number): Promise<{ present: number; total: number; students: StudentStatus[] }> {
    const session = await this.moodle.getSession(sessionId);
    const users = array(session.users);
    const presentStatusId = resolveStatusId(session.statuses, this.config.presentStatusAcronym);
    const presentIds = new Set(array(session.attendance_log)
      .filter((entry) => positiveInteger(entry.statusid) === presentStatusId)
      .map((entry) => positiveInteger(entry.studentid))
      .filter((id): id is number => id !== null));
    const students = users.map((user) => {
      const id = positiveInteger(user.id);
      const firstName = typeof user.firstname === "string" ? user.firstname.trim() : "";
      const lastName = typeof user.lastname === "string" ? user.lastname.trim() : "";
      return id ? { id, name: `${firstName} ${lastName}`.trim(), present: presentIds.has(id) } : null;
    }).filter((student): student is StudentStatus => student !== null)
      .sort((one, two) => one.present === two.present ? one.name.localeCompare(two.name, "pl") : one.present ? -1 : 1);
    return { present: students.filter((student) => student.present).length, total: students.length, students };
  }

  async mark(sessionId: number, firstNameInput: unknown, lastNameInput: unknown): Promise<{ alreadyMarked: boolean; student: string }> {
    const firstName = normalizeName(firstNameInput);
    const lastName = normalizeName(lastNameInput);
    if (!firstName || !lastName) throw new Error("Uzupełnij imię i nazwisko.");
    const session = await this.moodle.getSession(sessionId);
    const users = array(session.users);
    const student = users.find((user) => normalizeName(user.firstname) === firstName && normalizeName(user.lastname) === lastName);
    const studentId = positiveInteger(student?.id);
    if (!student || !studentId) throw new Error("Nie znaleziono studenta. Sprawdź pisownię imienia i nazwiska.");
    const payload = buildAttendanceUpdatePayload(this.config, sessionId, studentId, session);
    const alreadyMarked = array(session.attendance_log).some((entry) => positiveInteger(entry.studentid) === studentId && positiveInteger(entry.statusid) === payload.statusid);
    if (!alreadyMarked) await this.moodle.updateUserStatus(payload);
    const displayName = `${String(student.firstname ?? "").trim()} ${String(student.lastname ?? "").trim()}`.trim();
    return { alreadyMarked, student: displayName };
  }

  async toggle(sessionId: number, studentId: number, present: boolean): Promise<{ changed: boolean }> {
    const session = await this.moodle.getSession(sessionId);
    const student = array(session.users).find((item) => positiveInteger(item.id) === studentId);
    if (!student) throw new Error("Nie znaleziono studenta.");
    const statusId = resolveStatusId(session.statuses, present ? this.config.presentStatusAcronym : this.config.absentStatusAcronym);
    const current = array(session.attendance_log).find((entry) => positiveInteger(entry.studentid) === studentId);
    const alreadyMarked = positiveInteger(current?.statusid) === statusId;
    if (!alreadyMarked) await this.moodle.updateUserStatus(buildAttendanceUpdatePayload(this.config, sessionId, studentId, session, statusId));
    return { changed: !alreadyMarked };
  }
}
