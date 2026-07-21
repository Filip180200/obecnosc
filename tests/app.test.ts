import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDatabase, StateRepository, type AppDatabase } from "../src/db.js";
import type { JsonObject, MoodleGateway } from "../src/types.js";
import type { Logger } from "../src/logger.js";

class FakeMoodle implements MoodleGateway {
  updates: Record<string, number>[] = [];
  getSessionsCalls = 0;
  sessions: JsonObject[] = [{ id: 100, sessdate: 1 }];
  session: JsonObject = {
    id: 100,
    lasttakenby: 77,
    statusset: 3,
    statuses: [
      { id: 20, acronym: "A", description: "Nieobecny" },
      { id: 10, acronym: "P", description: "Obecny" }
    ],
    users: [
      { id: 1, firstname: "Jan", lastname: "Kowalski" },
      { id: 2, firstname: "Anna", lastname: "Nowak" }
    ],
    attendance_log: []
  };
  async getSessions(): Promise<JsonObject[]> {
    this.getSessionsCalls += 1;
    return structuredClone(this.sessions);
  }
  async getSession(): Promise<JsonObject> { return structuredClone(this.session); }
  async updateUserStatus(payload: Record<string, number>): Promise<JsonObject> { this.updates.push(payload); return { ok: true }; }
}

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const origin = "http://localhost:3000";
let db: AppDatabase;
let moodle: FakeMoodle;
let now: number;

function makeApp(overrides: NodeJS.ProcessEnv = {}) {
  const config = loadConfig({
    NODE_ENV: "test", PUBLIC_URL: origin, ALLOWED_ORIGIN: origin,
    DATABASE_PATH: ":memory:", ADMIN_PASSWORD: "correct-password",
    AUTH_SECRET: "test-auth-secret-at-least-32-characters", MOODLE_BASE_URL: "https://moodle.example",
    MOODLE_TOKEN: "test", MOODLE_PRESENT_STATUS_ACRONYM: "P", MOODLE_ABSENT_STATUS_ACRONYM: "A",
    ...overrides
  });
  return createApp({ config, db, moodle, logger, clock: { nowSeconds: () => now } });
}

async function login(app: ReturnType<typeof makeApp>): Promise<string> {
  const response = await app.request("/api/auth/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ password: "correct-password" }) });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

beforeEach(() => { db = openDatabase(":memory:"); moodle = new FakeMoodle(); now = 1_000_000; });
afterEach(() => db.close());

describe("public API", () => {
  it("odrzuca zapis przy zamkniętej liście", async () => {
    const response = await makeApp().request("/api/public/attendance", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ firstName: "Jan", lastName: "Kowalski" }) });
    expect(response.status).toBe(409);
  });

  it("pozwala kolejno wpisać kilka osób z jednego klienta", async () => {
    new StateRepository(db).save({ isOpen: true, attendanceId: 61195, sessionId: 100, openedAt: now });
    const app = makeApp();
    for (const person of [{ firstName: "Jan", lastName: "Kowalski" }, { firstName: "Anna", lastName: "Nowak" }]) {
      const response = await app.request("/api/public/attendance", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(person) });
      expect(response.status).toBe(200);
    }
    expect(moodle.updates).toHaveLength(2);
  });

  it("jest idempotentny dla już obecnej osoby", async () => {
    new StateRepository(db).save({ isOpen: true, attendanceId: 61195, sessionId: 100, openedAt: now });
    moodle.session.attendance_log = [{ studentid: 1, statusid: 10 }];
    const response = await makeApp().request("/api/public/attendance", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ firstName: "Jan", lastName: "Kowalski" }) });
    expect(response.status).toBe(200);
    expect((await response.json()).alreadyMarked).toBe(true);
    expect(moodle.updates).toHaveLength(0);
  });

  it("zwraca historię frekwencji jednym wywołaniem listy sesji", async () => {
    new StateRepository(db).save({ isOpen: true, attendanceId: 61195, sessionId: 100, openedAt: now });
    const statuses = [
      { id: 20, acronym: "A", description: "Nieobecny" },
      { id: 10, acronym: "P", description: "Obecny" }
    ];
    moodle.sessions = [
      {
        id: 90,
        sessdate: now - 10_000,
        statuses,
        users: moodle.session.users,
        attendance_log: [{ studentid: 1, statusid: 10 }]
      },
      {
        id: 100,
        sessdate: now - 100,
        statuses,
        users: moodle.session.users,
        attendance_log: [{ studentid: 1, statusid: 20 }]
      },
      {
        id: 110,
        sessdate: now + 10_000,
        statuses,
        users: moodle.session.users,
        attendance_log: []
      }
    ];

    const response = await makeApp().request("/api/public/attendance", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ firstName: "Jan", lastName: "Kowalski" })
    });
    const data = await response.json() as {
      attendance: { present: number; finished: number; future: number; percent: number };
    };

    expect(response.status).toBe(200);
    expect(data.attendance).toEqual({ present: 1, finished: 2, future: 1, percent: 50 });
    expect(moodle.getSessionsCalls).toBe(1);
  });

  it("publiczne statystyki nie ujawniają studentów", async () => {
    new StateRepository(db).save({ isOpen: true, attendanceId: 61195, sessionId: 100, openedAt: now });
    moodle.session.attendance_log = [{ studentid: 1, statusid: 10 }];
    const response = await makeApp().request("/api/public/stats");
    const data = await response.json() as Record<string, unknown>;
    expect(data).toEqual({ present: 1, total: 2 });
    expect(data).not.toHaveProperty("students");
    expect(data).not.toHaveProperty("names");
  });

  it("automatycznie zamyka listę po 15 minutach", async () => {
    new StateRepository(db).save({ isOpen: true, attendanceId: 61195, sessionId: 100, openedAt: now - 901 });
    const response = await makeApp().request("/api/public/state");
    expect(await response.json()).toEqual({ isOpen: false });
  });

  it("odrzuca obcy Origin", async () => {
    const response = await makeApp().request("/api/public/attendance", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect(response.status).toBe(403);
  });

  it("ogranicza serię błędnych nazw, ale nie ogranicza poprawnych osób per telefon", async () => {
    new StateRepository(db).save({ isOpen: true, attendanceId: 61195, sessionId: 100, openedAt: now });
    const app = makeApp({
      TRUST_PROXY: "true",
      MAX_PUBLIC_FAILURES: "2",
      PUBLIC_FAILURE_WINDOW_SECONDS: "900"
    });
    const headers = {
      origin,
      "content-type": "application/json",
      "x-real-ip": "203.0.113.10"
    };

    for (let index = 0; index < 2; index += 1) {
      const response = await app.request("/api/public/attendance", {
        method: "POST",
        headers,
        body: JSON.stringify({
          firstName: `Błędne${index}`,
          lastName: "Nazwisko"
        })
      });
      expect(response.status).toBe(404);
    }

    const blocked = await app.request("/api/public/attendance", {
      method: "POST",
      headers,
      body: JSON.stringify({
        firstName: "Jeszcze",
        lastName: "Błędne"
      })
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });
});

describe("admin API", () => {
  it("wymaga sesji administratora", async () => {
    expect((await makeApp().request("/api/admin/state")).status).toBe(401);
  });

  it("zwraca pełną listę tylko administratorowi", async () => {
    new StateRepository(db).save({ isOpen: true, attendanceId: 61195, sessionId: 100, openedAt: now });
    const app = makeApp();
    const cookie = await login(app);
    const response = await app.request("/api/admin/stats", { headers: { cookie } });
    const data = await response.json() as { students: unknown[] };
    expect(response.status).toBe(200);
    expect(data.students).toHaveLength(2);
  });

  it("ustawia cookie administratora z prefiksem __Host-", async () => {
    const response = await makeApp().request("/api/auth/login", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ password: "correct-password" })
    });
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-attendance_admin="
    );
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
  });

  it("unieważnia sesję po wylogowaniu po stronie serwera", async () => {
    const app = makeApp();
    const cookie = await login(app);
    const logout = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { origin, cookie }
    });
    expect(logout.status).toBe(204);
    expect(
      (await app.request("/api/admin/state", { headers: { cookie } })).status
    ).toBe(401);
  });

  it("nowe logowanie unieważnia poprzednią sesję administratora", async () => {
    const app = makeApp();
    const firstCookie = await login(app);
    const secondCookie = await login(app);
    expect(
      (
        await app.request("/api/admin/state", {
          headers: { cookie: firstCookie }
        })
      ).status
    ).toBe(401);
    expect(
      (
        await app.request("/api/admin/state", {
          headers: { cookie: secondCookie }
        })
      ).status
    ).toBe(200);
  });

  it("waliduje sessionId względem kursu", async () => {
    const app = makeApp();
    const cookie = await login(app);
    const response = await app.request("/api/admin/state", {
      method: "POST", headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ isOpen: true, attendanceId: 61195, sessionId: 999 })
    });
    expect(response.status).toBe(400);
  });

  it("akceptuje sesję zwróconą przez Moodle", async () => {
    const app = makeApp();
    const cookie = await login(app);
    const response = await app.request("/api/admin/state", {
      method: "POST", headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ isOpen: true, attendanceId: 61195, sessionId: 100 })
    });
    expect(response.status).toBe(200);
  });

  it("status obecny jest wybierany po akronimie, nie kolejności", async () => {
    new StateRepository(db).save({ isOpen: true, attendanceId: 61195, sessionId: 100, openedAt: now });
    const response = await makeApp().request("/api/public/attendance", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ firstName: "Jan", lastName: "Kowalski" }) });
    expect(response.status).toBe(200);
    expect(moodle.updates[0]?.statusid).toBe(10);
  });

  it("nie używa fallbacku 1 dla takenbyid i statusset", async () => {
    new StateRepository(db).save({ isOpen: true, attendanceId: 61195, sessionId: 100, openedAt: now });
    delete moodle.session.lasttakenby;
    delete moodle.session.statusset;
    const response = await makeApp().request("/api/public/attendance", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ firstName: "Jan", lastName: "Kowalski" }) });
    expect(response.status).toBe(502);
    expect(moodle.updates).toHaveLength(0);
  });
});

it("healthcheck nie wymaga Moodle", async () => {
  const response = await makeApp().request("/healthz");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

it("nie ujawnia wewnętrznego błędu w produkcji", async () => {
  new StateRepository(db).save({
    isOpen: true,
    attendanceId: 61195,
    sessionId: 100,
    openedAt: now
  });
  moodle.getSession = async () => {
    throw new Error("INTERNAL_SECRET_DETAIL");
  };
  const app = makeApp({
    NODE_ENV: "production",
    PUBLIC_URL: "https://ob.edu.pl",
    ALLOWED_ORIGIN: "https://ob.edu.pl",
    ADMIN_PASSWORD: "production-password-long",
    AUTH_SECRET: "production-auth-secret-at-least-32-characters"
  });
  const response = await app.request("/api/public/stats");
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "Wystąpił błąd serwera. Spróbuj ponownie."
  });
});
