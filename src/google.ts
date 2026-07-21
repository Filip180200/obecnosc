import { google, type drive_v3, type sheets_v4 } from "googleapis";
import { normalizeName, type StudentAttendanceSummary, type StudentStatus } from "./attendance.js";

const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const HEADER_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/;

export interface GoogleCourse {
  course: string;
  spreadsheetId: string;
}

export interface GoogleSession {
  id: string;
  label: string;
  timestamp: number;
  columnIndex: number;
}

export interface GoogleAttendanceConfig {
  folderId: string;
  clientEmail: string;
  privateKey: string;
}

interface SheetContext {
  spreadsheetId: string;
  sheetTitle: string;
  sessions: GoogleSession[];
}

interface StudentRow {
  rowNumber: number;
  privateId: string;
  firstName: string;
  lastName: string;
  values: string[];
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function columnName(zeroBasedIndex: number): string {
  let value = zeroBasedIndex + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export function parseGoogleSessionHeader(label: string): number | null {
  const match = HEADER_PATTERN.exec(label.trim());
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0
  );
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute)
  ) return null;
  return Math.floor(date.getTime() / 1000);
}

export class GoogleAttendanceService {
  private readonly drive: drive_v3.Drive;
  private readonly sheets: sheets_v4.Sheets;
  private courseCache: { expiresAt: number; value: GoogleCourse[] } | null = null;
  private readonly contextCache = new Map<string, { expiresAt: number; value: SheetContext }>();

  constructor(private readonly config: GoogleAttendanceConfig) {
    const auth = new google.auth.JWT({
      email: config.clientEmail,
      key: config.privateKey,
      scopes: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/spreadsheets"
      ]
    });
    this.drive = google.drive({ version: "v3", auth });
    this.sheets = google.sheets({ version: "v4", auth });
  }

  async listCourses(): Promise<GoogleCourse[]> {
    const now = Date.now();
    if (this.courseCache && this.courseCache.expiresAt > now) return this.courseCache.value;

    const folderId = this.config.folderId.replace(/'/g, "\\'");
    const response = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType = '${GOOGLE_SHEET_MIME}'`,
      fields: "files(id,name)",
      orderBy: "name",
      pageSize: 1000
    });

    const value = (response.data.files ?? [])
      .map((file) => file.id && file.name ? { spreadsheetId: file.id, course: file.name.trim() } : null)
      .filter((course): course is GoogleCourse => Boolean(course))
      .sort((one, two) => one.course.localeCompare(two.course, "pl"));

    this.courseCache = { expiresAt: now + 30_000, value };
    return value;
  }

  private async context(spreadsheetId: string): Promise<SheetContext> {
    const cached = this.contextCache.get(spreadsheetId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const metadata = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties(title,index)"
    });
    const firstSheet = (metadata.data.sheets ?? [])
      .map((sheet) => sheet.properties)
      .filter((properties): properties is NonNullable<typeof properties> => Boolean(properties?.title))
      .sort((one, two) => Number(one.index ?? 0) - Number(two.index ?? 0))[0];

    if (!firstSheet?.title) throw new Error("Arkusz Google nie zawiera zakładki.");

    const headerResponse = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${firstSheet.title.replace(/'/g, "''")}'!1:1`,
      majorDimension: "ROWS",
      valueRenderOption: "FORMATTED_VALUE"
    });
    const headers = (headerResponse.data.values?.[0] ?? []).map(clean);

    if (headers[0] !== "ID" || headers[1] !== "Imię" || headers[2] !== "Nazwisko") {
      throw new Error('Pierwsze kolumny muszą mieć nagłówki: ID | Imię | Nazwisko.');
    }

    const sessions: GoogleSession[] = [];
    headers.slice(3).forEach((header, offset) => {
      if (!header) return;
      const timestamp = parseGoogleSessionHeader(header);
      if (timestamp === null) {
        throw new Error(`Nieprawidłowy nagłówek sesji „${header}”. Użyj DD.MM.RRRR GG:MM.`);
      }
      const columnIndex = offset + 3;
      sessions.push({
        id: columnName(columnIndex),
        label: header,
        timestamp,
        columnIndex
      });
    });

    const value = {
      spreadsheetId,
      sheetTitle: firstSheet.title,
      sessions
    };
    this.contextCache.set(spreadsheetId, { expiresAt: Date.now() + 30_000, value });
    return value;
  }

  async listSessions(spreadsheetId: string): Promise<GoogleSession[]> {
    return (await this.context(spreadsheetId)).sessions
      .slice()
      .sort((one, two) => one.timestamp - two.timestamp);
  }

  async validateSession(spreadsheetId: string, sessionId: string): Promise<void> {
    if (!(await this.listSessions(spreadsheetId)).some((session) => session.id === sessionId)) {
      throw new Error("Wybrana sesja nie należy do wskazanego kursu.");
    }
  }

  private async rows(context: SheetContext): Promise<StudentRow[]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: context.spreadsheetId,
      range: `'${context.sheetTitle.replace(/'/g, "''")}'!A2:ZZ`,
      majorDimension: "ROWS",
      valueRenderOption: "FORMATTED_VALUE"
    });

    return (response.data.values ?? [])
      .map((values, index) => ({
        rowNumber: index + 2,
        privateId: clean(values[0]),
        firstName: clean(values[1]),
        lastName: clean(values[2]),
        values: values.map(clean)
      }))
      .filter((row) => row.firstName && row.lastName);
  }

  private session(context: SheetContext, sessionId: string): GoogleSession {
    const session = context.sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error("Nie znaleziono sesji w arkuszu.");
    return session;
  }

  async stats(
    spreadsheetId: string,
    sessionId: string
  ): Promise<{ present: number; total: number; students: StudentStatus[] }> {
    const context = await this.context(spreadsheetId);
    const session = this.session(context, sessionId);
    const rows = await this.rows(context);

    const students = rows.map((row) => {
      const rawStatus = clean(row.values[session.columnIndex]);
      return {
        id: row.rowNumber,
        privateId: row.privateId,
        name: `${row.firstName} ${row.lastName}`.trim(),
        present: rawStatus === "Obecny",
        attendanceStatus:
          rawStatus === "Obecny"
            ? "present"
            : rawStatus === "Nieobecny"
              ? "absent"
              : "unset"
      } satisfies StudentStatus;
    }).sort((one, two) =>
      one.present === two.present
        ? one.name.localeCompare(two.name, "pl")
        : one.present ? -1 : 1
    );

    return {
      present: students.filter((student) => student.present).length,
      total: students.length,
      students
    };
  }

  async mark(
    spreadsheetId: string,
    sessionId: string,
    firstNameInput: unknown,
    lastNameInput: unknown,
    nowSeconds: number
  ): Promise<{
    alreadyMarked: boolean;
    student: string;
    studentId: number;
    attendance: StudentAttendanceSummary;
  }> {
    const firstName = normalizeName(firstNameInput);
    const lastName = normalizeName(lastNameInput);
    if (!firstName || !lastName) throw new Error("Uzupełnij imię i nazwisko.");

    const context = await this.context(spreadsheetId);
    const session = this.session(context, sessionId);
    const rows = await this.rows(context);
    const matches = rows.filter((row) =>
      normalizeName(row.firstName) === firstName &&
      normalizeName(row.lastName) === lastName
    );

    if (matches.length === 0) {
      throw new Error("Nie znaleziono studenta. Sprawdź pisownię imienia i nazwiska.");
    }
    if (matches.length > 1) {
      throw new Error("W arkuszu jest więcej niż jedna osoba o tym imieniu i nazwisku. Skontaktuj się z prowadzącym.");
    }

    const row = matches[0];
    if (!row) {
      throw new Error("Nie znaleziono studenta. Sprawdź pisownię imienia i nazwiska.");
    }
    const alreadyMarked = clean(row.values[session.columnIndex]) === "Obecny";
    if (!alreadyMarked) await this.writeStatus(context, session, row.rowNumber, "Obecny");

    return {
      alreadyMarked,
      student: `${row.firstName} ${row.lastName}`.trim(),
      studentId: row.rowNumber,
      attendance: this.summary(context.sessions, row, session, nowSeconds)
    };
  }

  private summary(
    sessions: GoogleSession[],
    row: StudentRow,
    activeSession: GoogleSession,
    nowSeconds: number
  ): StudentAttendanceSummary {
    let present = 0;
    let finished = 0;
    let future = 0;

    for (const session of sessions) {
      if (session.timestamp > nowSeconds) {
        future += 1;
        continue;
      }
      finished += 1;
      const status =
        session.id === activeSession.id
          ? "Obecny"
          : clean(row.values[session.columnIndex]);
      if (status === "Obecny") present += 1;
    }

    return {
      present,
      finished,
      future,
      percent: finished ? Math.round((present * 100) / finished) : 0
    };
  }

  async setStatus(
    spreadsheetId: string,
    sessionId: string,
    studentRow: number,
    status: "Obecny" | "Nieobecny" | ""
  ): Promise<{ changed: boolean }> {
    const context = await this.context(spreadsheetId);
    const session = this.session(context, sessionId);
    const row = (await this.rows(context)).find((item) => item.rowNumber === studentRow);
    if (!row) throw new Error("Nie znaleziono studenta.");

    const current = clean(row.values[session.columnIndex]);
    if (current === status) return { changed: false };
    await this.writeStatus(context, session, studentRow, status);
    return { changed: true };
  }

  private async writeStatus(
    context: SheetContext,
    session: GoogleSession,
    rowNumber: number,
    status: string
  ): Promise<void> {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: context.spreadsheetId,
      range: `'${context.sheetTitle.replace(/'/g, "''")}'!${session.id}${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [[status]] }
    });
  }
}

export function googleConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): GoogleAttendanceConfig | null {
  const folderId = (env.GOOGLE_DRIVE_FOLDER_ID ?? "").trim();
  const clientEmail = (env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "").trim();
  const privateKey = (env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "")
    .replace(/\\n/g, "\n")
    .trim();

  const enabled = Boolean(folderId || clientEmail || privateKey);
  if (!enabled) return null;
  if (!folderId || !clientEmail || !privateKey) {
    throw new Error(
      "Google wymaga GOOGLE_DRIVE_FOLDER_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL i GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY."
    );
  }
  return { folderId, clientEmail, privateKey };
}
