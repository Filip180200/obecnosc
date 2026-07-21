import type { AppDatabase } from "./db.js";

export type AttendanceSource = "moodle" | "google";

export interface SourceState {
  source: AttendanceSource;
  googleCourseId: string | null;
  googleSessionId: string | null;
}

export class SourceStateRepository {
  constructor(private readonly db: AppDatabase) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS attendance_source_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        source TEXT NOT NULL DEFAULT 'moodle'
          CHECK (source IN ('moodle', 'google')),
        google_course_id TEXT,
        google_session_id TEXT
      );
      INSERT OR IGNORE INTO attendance_source_state (id, source)
      VALUES (1, 'moodle');
    `);
  }

  get(): SourceState {
    const row = this.db.prepare(`
      SELECT source, google_course_id, google_session_id
      FROM attendance_source_state
      WHERE id = 1
    `).get() as {
      source: AttendanceSource;
      google_course_id: string | null;
      google_session_id: string | null;
    };

    return {
      source: row.source,
      googleCourseId: row.google_course_id,
      googleSessionId: row.google_session_id
    };
  }

  save(input: SourceState): void {
    this.db.prepare(`
      UPDATE attendance_source_state
      SET source = ?, google_course_id = ?, google_session_id = ?
      WHERE id = 1
    `).run(input.source, input.googleCourseId, input.googleSessionId);
  }
}
