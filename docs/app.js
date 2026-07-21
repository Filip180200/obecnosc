const API_URL = window.APP_CONFIG?.apiUrl?.replace(/\/$/, "") || window.location.origin;

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method || "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body,
    signal: options.signal
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

if (new URLSearchParams(location.search).has("admin")) void startAdmin(); else void startStudent();

async function startStudent() {
  const form = document.querySelector("#attendance-form");
  const closed = document.querySelector("#closed-notice");
  const message = document.querySelector("#student-message");
  const stats = document.querySelector("#student-stats");

  function renderAttendance(attendance) {
    stats.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = `Twoja frekwencja: ${attendance.percent}%`;

    const progress = document.createElement("div");
    progress.className = "progress";
    const bar = document.createElement("div");
    bar.style.width = `${Math.max(0, Math.min(100, Number(attendance.percent) || 0))}%`;
    progress.append(bar);

    const details = document.createElement("span");
    details.textContent =
      `${attendance.present} obecności z ${attendance.finished} zakończonych zajęć. ` +
      `Pozostało: ${attendance.future}.`;

    stats.append(title, progress, details);
    stats.hidden = false;
  }

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
      if (result.attendance) renderAttendance(result.attendance);
      else stats.hidden = true;
      form.reset();
      form.querySelector("input")?.focus();
    } catch (error) {
      show(message, error.message, "error");
      await refresh();
    } finally { button.disabled = false; }
  });
  await refresh();
  const refreshLoop = async () => { await refresh(); setTimeout(refreshLoop, 30000); };
  setTimeout(refreshLoop, 30000);
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
  let countdownTimer;
  let statsTimer;
  let statsController;
  let stopped = false;

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
    countdown.textContent = seconds <= 0 ? "Lista została zamknięta." : `Automatyczne zamknięcie za ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.`;
    countdown.hidden = false;
  }

  async function refreshStats() {
    if (statsController || document.hidden || stopped) return;
    statsController = new AbortController();
    try {
      const data = await api("/api/admin/stats", { signal: statsController.signal });
      const holder = document.querySelector("#live-stats");
      holder.replaceChildren();
      const title = document.createElement("strong");
      title.textContent = `Obecnych na sali: ${data.present} / ${data.total}`;
      const list = document.createElement("ol");
      list.className = "live-list";
      if (!data.students?.length) {
        const empty = document.createElement("li");
        empty.className = "live-empty";
        empty.textContent = "Brak uczestników do wyświetlenia.";
        list.append(empty);
      } else {
        data.students.forEach((student, index) => {
          const item = document.createElement("li");
          item.className = `live-item ${student.present ? "present" : "absent"}`;
          const number = document.createElement("span");
          number.className = "live-number";
          number.textContent = index + 1;
          const name = document.createElement("span");
          name.className = "live-name";
          name.textContent = student.name;
          const toggle = document.createElement("label");
          toggle.className = "live-toggle";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = student.present;
          checkbox.setAttribute("aria-label", `${student.present ? "Usuń" : "Dodaj"} obecność: ${student.name}`);
          checkbox.addEventListener("change", async () => {
            const nextPresent = checkbox.checked;
            const confirmed = window.confirm(`${nextPresent ? "Dodać" : "Usunąć"} obecność dla ${student.name}?`);
            if (!confirmed) { checkbox.checked = !nextPresent; return; }
            checkbox.disabled = true;
            try {
              await api("/api/admin/attendance/toggle", { method: "POST", body: JSON.stringify({ studentId: student.id, present: nextPresent }) });
              show(message, `${nextPresent ? "Dodano" : "Usunięto"} obecność dla ${student.name}.`, "success");
              await refreshStats();
            } catch (error) {
              checkbox.checked = !nextPresent;
              show(message, error.message, "error");
            } finally { checkbox.disabled = false; }
          });
          toggle.append(checkbox);
          const status = document.createElement("span");
          status.className = "live-status";
          status.textContent = student.present ? "✓" : "–";
          item.append(number, name, toggle, status);
          list.append(item);
        });
      }
      holder.append(title, list);
    } catch (error) {
      if (error.name !== "AbortError") show(message, error.message, "error");
    } finally { statsController = undefined; }
  }

  function scheduleStats() {
    clearTimeout(statsTimer);
    if (stopped) return;
    statsTimer = setTimeout(async () => { await refreshStats(); scheduleStats(); }, 3000);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) statsController?.abort();
    else void refreshStats();
  });

  async function loadPanel() {
    currentState = await api("/api/admin/state");
    loginForm.hidden = true;
    panel.hidden = false;
    courseSelect.replaceChildren(new Option("— Wybierz kurs —", ""));
    currentState.courses.forEach((course) => courseSelect.add(new Option(course.course, course.attendanceId, false, Number(course.attendanceId) === currentState.attendanceId)));
    isOpen.checked = currentState.isOpen;
    await loadSessions(currentState.attendanceId, currentState.sessionId);
    refreshCountdown();
    clearInterval(countdownTimer);
    countdownTimer = setInterval(refreshCountdown, 1000);
    await refreshStats();
    scheduleStats();
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password: document.querySelector("#password").value }) });
      await loadPanel();
    } catch (error) { show(loginMessage, error.message, "error"); }
  });
  courseSelect.addEventListener("change", () => void loadSessions(courseSelect.value));
  stateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      currentState = await api("/api/admin/state", { method: "POST", body: JSON.stringify({ isOpen: isOpen.checked, attendanceId: courseSelect.value, sessionId: sessionSelect.value }) });
      show(message, "Zapisano ustawienia.", "success");
      refreshCountdown();
      await refreshStats();
    } catch (error) { show(message, error.message, "error"); }
  });
  document.querySelector("#logout").addEventListener("click", async () => {
    stopped = true;
    clearTimeout(statsTimer);
    clearInterval(countdownTimer);
    statsController?.abort();
    await api("/api/auth/logout", { method: "POST" });
    location.reload();
  });
  try { await loadPanel(); } catch (error) { if (!error.message.includes("Sesja wygasła")) show(loginMessage, error.message, "error"); }
}
