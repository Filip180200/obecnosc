const COURSES = [
  { course: "Statystyka", attendanceId: 61195 },
  { course: "Psychologia społeczna", attendanceId: 61234 },
];

const OPEN_SECONDS = 15 * 60;
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const MAX_LOGIN_ATTEMPTS = 5;
const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), env, origin);
    if (origin && origin !== env.ALLOWED_ORIGIN) return new Response("Forbidden", { status: 403 });

    try {
      const response = await route(request, env, new URL(request.url));
      return cors(response, env, origin);
    } catch (error) {
      console.error(error);
      return cors(json({ error: "Wystąpił błąd serwera. Spróbuj ponownie." }, 500), env, origin);
    }
  },
};

async function route(request, env, url) {
  const { pathname } = url;
  if (pathname === "/api/auth/login" && request.method === "POST") return login(request, env);
  if (pathname === "/api/auth/logout" && request.method === "POST") return new Response(null, { status: 204, headers: { "Set-Cookie": expiredCookie() } });
  if (pathname === "/api/public/state" && request.method === "GET") return json({ isOpen: (await state(env)).isOpen });
  if (pathname === "/api/public/attendance" && request.method === "POST") return markAttendance(request, env);

  if (!await isAdmin(request, env)) return json({ error: "Sesja wygasła. Zaloguj się ponownie." }, 401);
  if (pathname === "/api/admin/state" && request.method === "GET") return json({ ...(await state(env)), courses: COURSES });
  if (pathname === "/api/admin/state" && request.method === "POST") return saveState(request, env);
  if (pathname === "/api/admin/sessions" && request.method === "GET") return sessions(url, env);
  if (pathname === "/api/admin/stats" && request.method === "GET") return stats(env);
  return json({ error: "Nie znaleziono adresu API." }, 404);
}

async function login(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = nowSeconds();
  const previous = await env.DB.prepare("SELECT attempts, reset_at FROM login_attempts WHERE ip = ?").bind(ip).first();
  if (previous && previous.reset_at > now && previous.attempts >= MAX_LOGIN_ATTEMPTS) return json({ error: "Zbyt wiele prób. Odczekaj 15 minut." }, 429);

  const body = await request.json().catch(() => null);
  if (!body || !await constantEqual(body.password, env.ADMIN_PASSWORD)) {
    const attempts = previous && previous.reset_at > now ? previous.attempts + 1 : 1;
    await env.DB.prepare("INSERT INTO login_attempts (ip, attempts, reset_at) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET attempts = excluded.attempts, reset_at = excluded.reset_at")
      .bind(ip, attempts, now + LOGIN_WINDOW_SECONDS).run();
    return json({ error: "Nieprawidłowe hasło." }, 401);
  }
  await env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(await signedSession(env.AUTH_SECRET)) });
}

async function saveState(request, env) {
  const body = await request.json().catch(() => null);
  const isOpen = Boolean(body?.isOpen);
  const attendanceId = idOrNull(body?.attendanceId);
  const sessionId = idOrNull(body?.sessionId);
  if (isOpen && (!attendanceId || !sessionId)) return json({ error: "Wybierz kurs i sesję przed otwarciem listy." }, 400);
  if (attendanceId && !COURSES.some((course) => course.attendanceId === attendanceId)) return json({ error: "Nieprawidłowy kurs." }, 400);
  await env.DB.prepare("UPDATE attendance_state SET is_open = ?, session_id = ?, attendance_id = ?, opened_at = ? WHERE id = 1")
    .bind(isOpen ? 1 : 0, sessionId, attendanceId, isOpen ? nowSeconds() : null).run();
  return json(await state(env));
}

async function sessions(url, env) {
  const attendanceId = idOrNull(url.searchParams.get("attendanceId"));
  if (!attendanceId || !COURSES.some((course) => course.attendanceId === attendanceId)) return json({ error: "Nieprawidłowy kurs." }, 400);
  const result = await moodle(env, "mod_attendance_get_sessions", { attendanceid: attendanceId });
  if (!Array.isArray(result)) return moodleError(result);
  return json({ sessions: result.sort((a, b) => a.sessdate - b.sessdate) });
}

async function stats(env) {
  const current = await state(env);
  if (!current.sessionId) return json({ present: 0, total: 0, names: [] });
  const session = await moodle(env, "mod_attendance_get_session", { sessionid: current.sessionId });
  if (session?.exception) return moodleError(session);
  const users = new Map((session.users || []).map((user) => [Number(user.id), `${user.firstname} ${user.lastname}`]));
  const presentStatus = Number(session.statuses?.[0]?.id);
  const names = (session.attendance_log || []).filter((entry) => Number(entry.statusid) === presentStatus)
    .map((entry) => users.get(Number(entry.studentid)) || "Nieznany student").sort((a, b) => a.localeCompare(b, "pl"));
  return json({ present: names.length, total: users.size, names });
}

async function markAttendance(request, env) {
  const body = await request.json().catch(() => null);
  const firstName = normalName(body?.firstName);
  const lastName = normalName(body?.lastName);
  if (!firstName || !lastName) return json({ error: "Uzupełnij imię i nazwisko." }, 400);
  const current = await state(env);
  if (!current.isOpen || !current.sessionId || !current.attendanceId) return json({ error: "Lista obecności jest aktualnie zamknięta." }, 409);

  const session = await moodle(env, "mod_attendance_get_session", { sessionid: current.sessionId });
  if (session?.exception) return moodleError(session);
  const student = (session.users || []).find((user) => normalName(user.firstname) === firstName && normalName(user.lastname) === lastName);
  if (!student) return json({ error: "Nie znaleziono studenta. Sprawdź pisownię imienia i nazwiska." }, 404);
  const status = session.statuses?.[0];
  if (!status || !session.lasttakenby || !session.statusset) return json({ error: "Moodle nie zwrócił danych wymaganych do zapisu obecności." }, 502);
  const alreadyMarked = (session.attendance_log || []).some((entry) => Number(entry.studentid) === Number(student.id) && Number(entry.statusid) === Number(status.id));
  if (!alreadyMarked) {
    const updated = await moodle(env, "mod_attendance_update_user_status", {
      sessionid: current.sessionId, studentid: Number(student.id), takenbyid: Number(session.lasttakenby), statusid: Number(status.id), statusset: Number(session.statusset),
    });
    if (updated?.exception) return moodleError(updated);
  }
  return json({ ok: true, alreadyMarked, student: `${student.firstname} ${student.lastname}`, attendance: await studentStats(env, current.attendanceId, student.id) });
}

async function studentStats(env, attendanceId, studentId) {
  const items = await moodle(env, "mod_attendance_get_sessions", { attendanceid: attendanceId });
  if (!Array.isArray(items)) return { present: 0, finished: 0, future: 0, percent: 0 };
  let present = 0, finished = 0, future = 0;
  for (const item of items) {
    if (Number(item.sessdate) > nowSeconds()) { future += 1; continue; }
    const session = await moodle(env, "mod_attendance_get_session", { sessionid: item.id });
    if (!session?.statuses || !session?.attendance_log) continue;
    finished += 1;
    if (session.attendance_log.some((entry) => Number(entry.studentid) === Number(studentId) && Number(entry.statusid) === Number(session.statuses[0].id))) present += 1;
  }
  return { present, finished, future, percent: finished ? Math.round(present * 100 / finished) : 0 };
}

async function state(env) {
  const row = await env.DB.prepare("SELECT is_open, session_id, attendance_id, opened_at FROM attendance_state WHERE id = 1").first();
  const expired = row?.is_open && Number(row.opened_at) + OPEN_SECONDS <= nowSeconds();
  if (expired) await env.DB.prepare("UPDATE attendance_state SET is_open = 0, opened_at = NULL WHERE id = 1").run();
  return { isOpen: Boolean(row?.is_open) && !expired, sessionId: idOrNull(row?.session_id), attendanceId: idOrNull(row?.attendance_id), openedAt: expired ? null : idOrNull(row?.opened_at) };
}

async function moodle(env, functionName, parameters) {
  const url = new URL("/webservice/rest/server.php", env.MOODLE_BASE_URL);
  url.search = new URLSearchParams({ wstoken: env.MOODLE_TOKEN, wsfunction: functionName, moodlewsrestformat: "json" }).toString();
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: new URLSearchParams(parameters).toString() });
  if (!response.ok) throw new Error(`Moodle returned HTTP ${response.status}`);
  return response.json();
}

function moodleError(result) { console.error("Moodle", result?.errorcode, result?.message); return json({ error: "Moodle zwrócił błąd. Skontaktuj się z prowadzącym." }, 502); }
async function isAdmin(request, env) {
  const token = cookie(request.headers.get("Cookie"), "attendance_admin");
  const [payload, signature] = token?.split(".") || [];
  if (!payload || !signature || !await constantEqual(signature, await sign(env.AUTH_SECRET, payload))) return false;
  try { return Number(JSON.parse(fromBase64Url(payload)).exp) > nowSeconds(); } catch { return false; }
}
async function signedSession(secret) { const payload = base64Url(JSON.stringify({ exp: nowSeconds() + ADMIN_SESSION_SECONDS })); return `${payload}.${await sign(secret, payload)}`; }
async function sign(secret, text) { const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return base64UrlBytes(await crypto.subtle.sign("HMAC", key, encoder.encode(text))); }
async function constantEqual(a, b) { if (typeof a !== "string" || typeof b !== "string") return false; const [one, two] = await Promise.all([digest(a), digest(b)]); let difference = 0; for (let i = 0; i < one.length; i += 1) difference |= one[i] ^ two[i]; return difference === 0; }
async function digest(text) { return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))); }
function normalName(value) { return typeof value === "string" ? value.trim().toLocaleLowerCase("pl").normalize("NFD").replace(/\p{Diacritic}/gu, "") : ""; }
function idOrNull(value) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }
function nowSeconds() { return Math.floor(Date.now() / 1000); }
function json(data, status = 200, headers = {}) { return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } }); }
function cors(response, env, origin) { const headers = new Headers(response.headers); if (origin === env.ALLOWED_ORIGIN) { headers.set("Access-Control-Allow-Origin", origin); headers.set("Access-Control-Allow-Credentials", "true"); headers.set("Access-Control-Allow-Headers", "Content-Type"); headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); headers.append("Vary", "Origin"); } return new Response(response.body, { status: response.status, statusText: response.statusText, headers }); }
function cookie(header, name) { return header?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1); }
function sessionCookie(token) { return `attendance_admin=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${ADMIN_SESSION_SECONDS}`; }
function expiredCookie() { return "attendance_admin=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0"; }
function base64Url(value) { return base64UrlBytes(encoder.encode(value)); }
function base64UrlBytes(bytes) { let raw = ""; for (const byte of new Uint8Array(bytes)) raw += String.fromCharCode(byte); return btoa(raw).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }
function fromBase64Url(value) { const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/")); return new TextDecoder().decode(Uint8Array.from(raw, (char) => char.charCodeAt(0))); }
