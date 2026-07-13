const API_URL = window.APP_CONFIG?.apiUrl?.replace(/\/$/, "");
const validApi = API_URL && !API_URL.includes("REPLACE_WITH");

async function api(path, options = {}) {
  if (!validApi) throw new Error("Brakuje adresu API. Uzupełnij plik config.js.");
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method || "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body,
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Nie udało się wykonać żądania.");
  return data;
}

function show(element, text, type = "") {
  element.textContent = text;
  element.className = `message ${type}`;
  element.hidden = false;
}

if (new URLSearchParams(location.search).has("admin")) startAdmin(); else startStudent();

async function startStudent() {
  const form = document.querySelector("#attendance-form");
  const closed = document.querySelector("#closed-notice");
  const message = document.querySelector("#student-message");
  const stats = document.querySelector("#student-stats");

  async function refresh() {
    try {
      const { isOpen } = await api("/api/public/state");
      form.hidden = !isOpen;
      closed.hidden = isOpen;
    } catch (error) { show(message, error.message, "error"); }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    message.hidden = true;
    try {
      const result = await api("/api/public/attendance", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      show(message, result.alreadyMarked ? `Obecność ${result.student} była już potwierdzona.` : `Obecność ${result.student} została zapisana.`, "success");
      renderAttendance(stats, result.attendance);
    } catch (error) {
      show(message, error.message, "error");
      await refresh();
    } finally { button.disabled = false; }
  });

  await refresh();
  setInterval(refresh, 30000);
}

function renderAttendance(element, attendance) {
  element.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = `Twoja frekwencja: ${attendance.percent}%`;
  const progress = document.createElement("div");
  progress.className = "progress";
  const bar = document.createElement("div");
  bar.style.width = `${attendance.percent}%`;
  progress.append(bar);
  const details = document.createElement("span");
  details.textContent = `${attendance.present} obecności z ${attendance.finished} zakończonych zajęć. Pozostało: ${attendance.future}.`;
  element.append(title, progress, details);
  element.hidden = false;
}

async function startAdmin() {
  document.querySelector("#student-view").hidden = true;
  document.querySelector("#admin-view").hidden = false;
  const loginForm = document.querySelector("#login-form");
  const loginMessage = document.querySelector("#login-message");
  const panel = document.querySelector("#admin-panel");
  const stateForm = document.querySelector("#state-form");
  const courseSelect = document.querySelector("#course-select");
  const sessionSelect = document.querySelector("#session-select");
  const isOpen = document.querySelector("#is-open");
  const message = document.querySelector("#admin-message");
  const countdown = document.querySelector("#countdown");
  let currentState;
  let statsTimer;
  let countdownTimer;

  async function loadSessions(attendanceId, selectedId = null) {
    if (!attendanceId) {
      sessionSelect.replaceChildren(new Option("— Najpierw wybierz kurs —", ""));
      sessionSelect.disabled = true;
      return;
    }
    sessionSelect.replaceChildren(new Option("Ładowanie sesji…", ""));
    sessionSelect.disabled = true;
    try {
      const { sessions } = await api(`/api/admin/sessions?attendanceId=${encodeURIComponent(attendanceId)}`);
      sessionSelect.replaceChildren(new Option("— Wybierz sesję z Moodle —", ""));
      sessions.forEach((item) => {
        const text = `${new Date(item.sessdate * 1000).toLocaleString("pl-PL")} — ${item.description || "Sesja"}`;
        sessionSelect.add(new Option(text, item.id, false, Number(item.id) === Number(selectedId)));
      });
      sessionSelect.disabled = false;
    } catch (error) {
      sessionSelect.replaceChildren(new Option("Błąd ładowania sesji", ""));
      show(message, error.message, "error");
    }
  }

  function refreshCountdown() {
    if (!currentState?.isOpen || !currentState.openedAt) { countdown.hidden = true; return; }
    const seconds = 900 - Math.floor(Date.now() / 1000 - currentState.openedAt);
    if (seconds <= 0) { countdown.textContent = "Lista została zamknięta."; return; }
    countdown.textContent = `Automatyczne zamknięcie za ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.`;
    countdown.hidden = false;
  }

  async function refreshStats() {
    try {
      const data = await api("/api/admin/stats");
      const holder = document.querySelector("#live-stats");
      holder.replaceChildren();
      const title = document.createElement("strong");
      title.textContent = `Obecnych na sali: ${data.present} / ${data.total}`;
      const list = document.createElement("ul");
      (data.names.length ? data.names : ["Nikt nie potwierdził obecności."]).forEach((name) => {
        const item = document.createElement("li"); item.textContent = name; list.append(item);
      });
      holder.append(title, list);
    } catch (error) { show(message, error.message, "error"); }
  }

  async function loadPanel() {
    currentState = await api("/api/admin/state");
    loginForm.hidden = true;
    panel.hidden = false;
    courseSelect.replaceChildren(new Option("— Wybierz kurs —", ""));
    currentState.courses.forEach((course) => courseSelect.add(new Option(course.course, course.attendanceId, false, Number(course.attendanceId) === currentState.attendanceId)));
    isOpen.checked = currentState.isOpen;
    await loadSessions(currentState.attendanceId, currentState.sessionId);
    refreshCountdown();
    clearInterval(countdownTimer); countdownTimer = setInterval(refreshCountdown, 1000);
    await refreshStats();
    clearInterval(statsTimer); statsTimer = setInterval(refreshStats, 3000);
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password: document.querySelector("#password").value }) });
      await loadPanel();
    } catch (error) { show(loginMessage, error.message, "error"); }
  });
  courseSelect.addEventListener("change", () => loadSessions(courseSelect.value));
  stateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      currentState = await api("/api/admin/state", { method: "POST", body: JSON.stringify({ isOpen: isOpen.checked, attendanceId: courseSelect.value, sessionId: sessionSelect.value }) });
      show(message, "Zapisano ustawienia.", "success");
      refreshCountdown(); await refreshStats();
    } catch (error) { show(message, error.message, "error"); }
  });
  document.querySelector("#logout").addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST" }); location.reload(); });

  try { await loadPanel(); } catch (error) { if (!error.message.includes("Sesja wygasła")) show(loginMessage, error.message, "error"); }
}
