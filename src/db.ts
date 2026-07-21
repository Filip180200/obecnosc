import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS attendance_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        is_open INTEGER NOT NULL DEFAULT 0 CHECK (is_open IN (0, 1)),
        session_id INTEGER,
        attendance_id INTEGER,
        opened_at INTEGER
      );
      INSERT OR IGNORE INTO attendance_state (id, is_open) VALUES (1, 0);

      CREATE TABLE IF NOT EXISTS login_attempts (
        ip TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL CHECK (attempts >= 0),
        reset_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_login_attempts_reset_at ON login_attempts(reset_at);
    `
  }
] as const;

export type AppDatabase = DatabaseType;

export function migrateDatabase(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set((db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((row) => row.version));
  const apply = db.transaction((version: number, sql: string) => {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(version, Math.floor(Date.now() / 1000));
  });
  for (const migration of MIGRATIONS) if (!applied.has(migration.version)) apply(migration.version, migration.sql);
}

export function openDatabase(databasePath: string): AppDatabase {
  if (databasePath !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrateDatabase(db);
  return db;
}

export interface AttendanceState {
  isOpen: boolean;
  sessionId: number | null;
  attendanceId: number | null;
  openedAt: number | null;
}

export class StateRepository {
  constructor(private readonly db: AppDatabase) {}

  get(nowSeconds: number, openSeconds: number): AttendanceState {
    const row = this.db.prepare("SELECT is_open, session_id, attendance_id, opened_at FROM attendance_state WHERE id = 1").get() as {
      is_open: number; session_id: number | null; attendance_id: number | null; opened_at: number | null;
    };
    const expired = Boolean(row.is_open && row.opened_at && row.opened_at + openSeconds <= nowSeconds);
    if (expired) this.db.prepare("UPDATE attendance_state SET is_open = 0, opened_at = NULL WHERE id = 1").run();
    return {
      isOpen: Boolean(row.is_open) && !expired,
      sessionId: row.session_id,
      attendanceId: row.attendance_id,
      openedAt: expired ? null : row.opened_at
    };
  }

  save(input: { isOpen: boolean; sessionId: number | null; attendanceId: number | null; openedAt: number | null }): void {
    this.db.prepare(`UPDATE attendance_state SET is_open = ?, session_id = ?, attendance_id = ?, opened_at = ? WHERE id = 1`)
      .run(input.isOpen ? 1 : 0, input.sessionId, input.attendanceId, input.openedAt);
  }
}

export class LoginAttemptRepository {
  constructor(private readonly db: AppDatabase) {}

  cleanup(nowSeconds: number): void {
    this.db.prepare("DELETE FROM login_attempts WHERE reset_at <= ?").run(nowSeconds);
  }

  get(ip: string): { attempts: number; resetAt: number } | null {
    const row = this.db.prepare("SELECT attempts, reset_at FROM login_attempts WHERE ip = ?").get(ip) as { attempts: number; reset_at: number } | undefined;
    return row ? { attempts: row.attempts, resetAt: row.reset_at } : null;
  }

  fail(ip: string, attempts: number, resetAt: number, nowSeconds: number): void {
    this.db.prepare(`
      INSERT INTO login_attempts(ip, attempts, reset_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET attempts = excluded.attempts, reset_at = excluded.reset_at, updated_at = excluded.updated_at
    `).run(ip, attempts, resetAt, nowSeconds);
  }

  clear(ip: string): void {
    this.db.prepare("DELETE FROM login_attempts WHERE ip = ?").run(ip);
  }
}
