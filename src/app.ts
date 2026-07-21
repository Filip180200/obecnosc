import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import QRCode from "qrcode";
import { serveStatic } from "@hono/node-server/serve-static";
import type { AppConfig, Clock, MoodleGateway } from "./types.js";
import type { Logger } from "./logger.js";
import type { AppDatabase } from "./db.js";
import { LoginAttemptRepository, StateRepository } from "./db.js";
import { AttendanceService } from "./attendance.js";
import type { GoogleAttendanceService } from "./google.js";
import { SourceStateRepository, type AttendanceSource } from "./source-state.js";
import { MoodleError } from "./moodle.js";
import { StatusMappingError } from "./status.js";
import {
  clientIp,
  constantEqual,
  createAdminSession,
  expiredSessionCookie,
  readCookie,
  sessionCookie,
  verifyAdminSession
} from "./security.js";

type Variables = { requestId: string };
type AppEnv = { Variables: Variables };

export interface AppDependencies {
  config: AppConfig;
  db: AppDatabase;
  moodle: MoodleGateway;
  google?: GoogleAttendanceService | null;
  logger: Logger;
  clock: Clock;
}

function jsonError(message: string): { error: string } {
  return { error: message };
}
function numberId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function stringId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function createApp(dependencies: AppDependencies): Hono<AppEnv> {
  const { config, db, moodle, google = null, logger, clock } = dependencies;
  const stateRepository = new StateRepository(db);
  const sourceRepository = new SourceStateRepository(db);
  const loginAttempts = new LoginAttemptRepository(db);
  const attendance = new AttendanceService(config, moodle);
  const app = new Hono<AppEnv>();

  app.use("*", async (context, next) => {
    const requestId =
      context.req.header("x-request-id")?.slice(0, 100) || randomUUID();
    context.set("requestId", requestId);
    context.header("X-Request-Id", requestId);
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
    context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    context.header("X-Frame-Options", "DENY");
    context.header("Cross-Origin-Opener-Policy", "same-origin");
    context.header("Cache-Control", "no-store");
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    );
    const started = performance.now();
    try {
      await next();
    } finally {
      logger.info("http_request", {
        requestId,
        method: context.req.method,
        route: new URL(context.req.url).pathname,
        status: context.res.status,
        durationMs: Math.round((performance.now() - started) * 10) / 10
      });
    }
  });

  app.use("/api/*", async (context, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(context.req.method)) {
      const origin = context.req.header("origin");
      if (origin !== config.allowedOrigin) {
        return context.json(jsonError("Niedozwolone źródło żądania."), 403);
      }
    }
    await next();
  });

  const state = () => ({
    ...stateRepository.get(clock.nowSeconds(), config.openSeconds),
    ...sourceRepository.get()
  });
  const isAdmin = (cookieHeader: string | undefined) =>
    verifyAdminSession(
      config,
      readCookie(cookieHeader, "attendance_admin"),
      clock.nowSeconds()
    );
  const requireAdmin = async (
    context: Parameters<Parameters<typeof app.use>[1]>[0],
    next: () => Promise<void>
  ) => {
    if (!isAdmin(context.req.header("cookie"))) {
      return context.json(
        jsonError("Sesja wygasła. Zaloguj się ponownie."),
        401
      );
    }
    await next();
  };

  app.get("/healthz", (context) => {
    db.prepare("SELECT 1").get();
    return context.json({ ok: true });
  });

  app.post("/api/auth/login", async (context) => {
    const ip = clientIp(context.req.raw.headers, config.trustProxy);
    const now = clock.nowSeconds();
    loginAttempts.cleanup(now);
    const previous = loginAttempts.get(ip);
    if (
      previous &&
      previous.resetAt > now &&
      previous.attempts >= config.maxLoginAttempts
    ) {
      return context.json(
        jsonError("Zbyt wiele prób. Odczekaj przed kolejną próbą."),
        429
      );
    }
    const body = await context.req
      .json<{ password?: unknown }>()
      .catch(() => null);
    const password = typeof body?.password === "string" ? body.password : "";
    if (!constantEqual(password, config.adminPassword)) {
      const attempts =
        previous && previous.resetAt > now ? previous.attempts + 1 : 1;
      loginAttempts.fail(
        ip,
        attempts,
        now + config.loginWindowSeconds,
        now
      );
      return context.json(jsonError("Nieprawidłowe hasło."), 401);
    }
    loginAttempts.clear(ip);
    context.header(
      "Set-Cookie",
      sessionCookie(
        createAdminSession(config, now),
        config.adminSessionSeconds
      )
    );
    return context.json({ ok: true });
  });

  app.post("/api/auth/logout", (context) => {
    context.header("Set-Cookie", expiredSessionCookie());
    return context.body(null, 204);
  });

  app.get("/api/public/state", (context) =>
    context.json({ isOpen: state().isOpen })
  );

  app.get("/api/public/stats", async (context) => {
    const current = state();
    if (current.source === "google") {
      if (
        !google ||
        !current.googleCourseId ||
        !current.googleSessionId
      ) return context.json({ present: 0, total: 0 });
      const result = await google.stats(
        current.googleCourseId,
        current.googleSessionId
      );
      return context.json({
        present: result.present,
        total: result.total
      });
    }
    if (!current.sessionId) {
      return context.json({ present: 0, total: 0 });
    }
    const result = await attendance.stats(current.sessionId);
    return context.json({
      present: result.present,
      total: result.total
    });
  });

  app.get("/api/public/qr", async (context) => {
    const svg = await QRCode.toString(config.publicUrl, {
      type: "svg",
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M"
    });
    return context.body(svg, 200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    });
  });

  app.post("/api/public/attendance", async (context) => {
    const current = state();
    if (!current.isOpen) {
      return context.json(
        jsonError("Lista obecności jest aktualnie zamknięta."),
        409
      );
    }
    const body = await context.req
      .json<{ firstName?: unknown; lastName?: unknown }>()
      .catch(() => null);
    if (!body) {
      return context.json(jsonError("Nieprawidłowe dane żądania."), 400);
    }

    try {
      if (current.source === "google") {
        if (
          !google ||
          !current.googleCourseId ||
          !current.googleSessionId
        ) {
          return context.json(
            jsonError("Integracja Google nie jest skonfigurowana."),
            503
          );
        }
        const result = await google.mark(
          current.googleCourseId,
          current.googleSessionId,
          body.firstName,
          body.lastName,
          clock.nowSeconds()
        );
        return context.json({ ok: true, ...result });
      }

      if (!current.sessionId || !current.attendanceId) {
        return context.json(
          jsonError("Brak aktywnej sesji Moodle."),
          409
        );
      }

      const result = await attendance.mark(
        current.sessionId,
        body.firstName,
        body.lastName
      );
      let attendanceSummary;
      try {
        attendanceSummary = await attendance.studentAttendance(
          current.attendanceId,
          result.studentId,
          clock.nowSeconds()
        );
      } catch (error) {
        logger.warn("student_history_failed", {
          requestId: context.get("requestId"),
          errorCode: error instanceof Error ? error.name : "internal"
        });
      }
      return context.json({
        ok: true,
        ...result,
        ...(attendanceSummary
          ? { attendance: attendanceSummary }
          : {})
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (
          error.message.startsWith("Nie znaleziono studenta") ||
          error.message.startsWith("W arkuszu jest więcej")
        )
      ) {
        return context.json(jsonError(error.message), 404);
      }
      if (
        error instanceof Error &&
        error.message === "Uzupełnij imię i nazwisko."
      ) {
        return context.json(jsonError(error.message), 400);
      }
      throw error;
    }
  });

  app.use("/api/admin/*", requireAdmin);

  app.get("/api/admin/state", async (context) => {
    const current = state();
    const googleCourses = google ? await google.listCourses() : [];
    return context.json({
      ...current,
      googleEnabled: Boolean(google),
      moodleCourses: config.courses,
      googleCourses,
      courses:
        current.source === "google"
          ? googleCourses
          : config.courses
    });
  });

  app.post("/api/admin/state", async (context) => {
    const body = await context.req.json<{
      source?: unknown;
      isOpen?: unknown;
      attendanceId?: unknown;
      sessionId?: unknown;
      googleCourseId?: unknown;
      googleSessionId?: unknown;
    }>().catch(() => null);

    const source: AttendanceSource =
      body?.source === "google" ? "google" : "moodle";
    const isOpen = Boolean(body?.isOpen);
    const attendanceId = numberId(body?.attendanceId);
    const sessionId = numberId(body?.sessionId);
    const googleCourseId = stringId(body?.googleCourseId);
    const googleSessionId = stringId(body?.googleSessionId);

    if (source === "google") {
      if (!google) {
        return context.json(
          jsonError("Integracja Google nie jest skonfigurowana."),
          503
        );
      }
      if (isOpen && (!googleCourseId || !googleSessionId)) {
        return context.json(
          jsonError(
            "Wybierz kurs i sesję Google przed otwarciem listy."
          ),
          400
        );
      }
      if (googleCourseId && googleSessionId) {
        try {
          await google.validateSession(
            googleCourseId,
            googleSessionId
          );
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("nie należy")
          ) {
            return context.json(jsonError(error.message), 400);
          }
          throw error;
        }
      }
      sourceRepository.save({
        source,
        googleCourseId,
        googleSessionId
      });
      stateRepository.save({
        isOpen,
        attendanceId: null,
        sessionId: null,
        openedAt: isOpen ? clock.nowSeconds() : null
      });
    } else {
      if (isOpen && (!attendanceId || !sessionId)) {
        return context.json(
          jsonError(
            "Wybierz kurs i sesję Moodle przed otwarciem listy."
          ),
          400
        );
      }
      if (
        attendanceId &&
        !config.courses.some(
          (course) => course.attendanceId === attendanceId
        )
      ) {
        return context.json(jsonError("Nieprawidłowy kurs."), 400);
      }
      if (attendanceId && sessionId) {
        try {
          await attendance.validateSession(attendanceId, sessionId);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("nie należy")
          ) {
            return context.json(jsonError(error.message), 400);
          }
          throw error;
        }
      }
      sourceRepository.save({
        source,
        googleCourseId: null,
        googleSessionId: null
      });
      stateRepository.save({
        isOpen,
        attendanceId,
        sessionId,
        openedAt: isOpen ? clock.nowSeconds() : null
      });
    }
    return context.json(state());
  });

  app.get("/api/admin/sessions", async (context) => {
    const source =
      context.req.query("source") === "google"
        ? "google"
        : "moodle";

    if (source === "google") {
      const courseId = stringId(context.req.query("courseId"));
      if (!google || !courseId) {
        return context.json(
          jsonError("Nieprawidłowy kurs Google."),
          400
        );
      }
      return context.json({
        sessions: await google.listSessions(courseId)
      });
    }

    const attendanceId = numberId(
      context.req.query("attendanceId")
    );
    if (
      !attendanceId ||
      !config.courses.some(
        (course) => course.attendanceId === attendanceId
      )
    ) {
      return context.json(jsonError("Nieprawidłowy kurs."), 400);
    }
    return context.json({
      sessions: await attendance.listSessions(attendanceId)
    });
  });

  app.get("/api/admin/stats", async (context) => {
    const current = state();
    if (current.source === "google") {
      if (
        !google ||
        !current.googleCourseId ||
        !current.googleSessionId
      ) {
        return context.json({
          present: 0,
          total: 0,
          students: []
        });
      }
      return context.json(
        await google.stats(
          current.googleCourseId,
          current.googleSessionId
        )
      );
    }
    if (!current.sessionId) {
      return context.json({
        present: 0,
        total: 0,
        students: []
      });
    }
    return context.json(await attendance.stats(current.sessionId));
  });

  app.post("/api/admin/attendance/toggle", async (context) => {
    const body = await context.req.json<{
      studentId?: unknown;
      present?: unknown;
      status?: unknown;
    }>().catch(() => null);
    const studentId = numberId(body?.studentId);
    if (!studentId) {
      return context.json(jsonError("Nieprawidłowy student."), 400);
    }

    const current = state();
    try {
      if (current.source === "google") {
        if (
          !google ||
          !current.googleCourseId ||
          !current.googleSessionId
        ) {
          return context.json(
            jsonError("Brak aktywnej sesji Google."),
            409
          );
        }
        const status =
          body?.status === "present"
            ? "Obecny"
            : body?.status === "absent"
              ? "Nieobecny"
              : "";
        const result = await google.setStatus(
          current.googleCourseId,
          current.googleSessionId,
          studentId,
          status
        );
        return context.json({ ok: true, status, ...result });
      }

      if (!current.sessionId || !current.attendanceId) {
        return context.json(
          jsonError("Brak aktywnej sesji Moodle."),
          409
        );
      }
      const result = await attendance.toggle(
        current.sessionId,
        studentId,
        Boolean(body?.present)
      );
      return context.json({
        ok: true,
        present: Boolean(body?.present),
        ...result
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Nie znaleziono studenta."
      ) {
        return context.json(jsonError(error.message), 404);
      }
      throw error;
    }
  });

  app.all("/api/*", (context) =>
    context.json(jsonError("Nie znaleziono adresu API."), 404)
  );
  app.use("/*", serveStatic({ root: "./docs" }));

  app.onError((error, context) => {
    const requestId = context.get("requestId");
    logger.error("request_failed", {
      requestId,
      route: new URL(context.req.url).pathname,
      errorCode:
        error instanceof MoodleError
          ? error.code
          : error instanceof StatusMappingError
            ? "status_mapping"
            : "internal"
    });
    if (error instanceof MoodleError) {
      return context.json(
        jsonError(error.message),
        error.status as 502
      );
    }
    if (error instanceof StatusMappingError) {
      return context.json(jsonError(error.message), 502);
    }
    return context.json(
      jsonError(
        error instanceof Error
          ? error.message
          : "Wystąpił błąd serwera. Spróbuj ponownie."
      ),
      500
    );
  });

  return app;
}
