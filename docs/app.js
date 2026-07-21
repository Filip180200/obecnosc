const API_URL =
  window.APP_CONFIG?.apiUrl?.replace(/\/$/, "") ||
  window.location.origin;

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method || "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body,
    signal: options.signal
  });
  const data =
    response.status === 204
      ? {}
      : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data.error || "Nie udało się wykonać żądania."
    );
  }
  return data;
}

function show(element, text, type = "") {
  element.textContent = text;
  element.className = `message ${type}`;
  element.hidden = false;
}

if (new URLSearchParams(location.search).has("admin")) {
  void startAdmin();
} else {
  void startStudent();
}

async function startStudent() {
  const form = document.querySelector("#attendance-form");
  const closed = document.querySelector("#closed-notice");
  const message = document.querySelector("#student-message");
  const stats = document.querySelector("#student-stats");

  function renderAttendance(attendance) {
    const percent = Math.max(
      0,
      Math.min(100, Number(attendance.percent) || 0)
    );
    const present = Math.max(
      0,
      Number(attendance.present) || 0
    );
    const finished = Math.max(
      0,
      Number(attendance.finished) || 0
    );
    const future = Math.max(
      0,
      Number(attendance.future) || 0
    );

    stats.replaceChildren();
    stats.className = "attendance-summary";

    const eyebrow = document.createElement("p");
    eyebrow.className = "attendance-summary-eyebrow";
    eyebrow.textContent = "Podsumowanie frekwencji";

    const hero = document.createElement("div");
    hero.className = "attendance-summary-hero";

    const percentBadge = document.createElement("div");
    percentBadge.className = "attendance-summary-percent";
    percentBadge.setAttribute(
      "aria-label",
      `Frekwencja: ${percent}%`
    );

    const percentValue = document.createElement("strong");
    percentValue.textContent = `${percent}%`;

    const percentLabel = document.createElement("span");
    percentLabel.textContent = "frekwencji";
    percentBadge.append(percentValue, percentLabel);

    const progressBlock = document.createElement("div");
    progressBlock.className = "attendance-summary-progress";

    const progressTitle = document.createElement("strong");
    progressTitle.textContent = "Twoja obecność na zajęciach";

    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = percent;
    progress.setAttribute(
      "aria-label",
      `Frekwencja ${percent} procent`
    );

    const progressCaption = document.createElement("span");
    progressCaption.textContent =
      finished > 0
        ? `Obecność potwierdzona na ${present} z ${finished} zakończonych spotkań.`
        : "Brak zakończonych spotkań do podsumowania.";

    progressBlock.append(
      progressTitle,
      progress,
      progressCaption
    );
    hero.append(percentBadge, progressBlock);

    const metrics = document.createElement("dl");
    metrics.className = "attendance-summary-metrics";

    const addMetric = (value, label) => {
      const item = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      item.append(description, term);
      metrics.append(item);
    };

    addMetric(present, "Obecności");
    addMetric(finished, "Zakończone");
    addMetric(future, "Pozostało");
    stats.append(eyebrow, hero, metrics);
    stats.hidden = false;
  }

  async function refresh() {
    try {
      const { isOpen } = await api("/api/public/state");
      form.hidden = !isOpen;
      closed.hidden = isOpen;
    } catch (error) {
      show(message, error.message, "error");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    message.hidden = true;
    try {
      const result = await api("/api/public/attendance", {
        method: "POST",
        body: JSON.stringify(
          Object.fromEntries(new FormData(form))
        )
      });
      show(
        message,
        result.alreadyMarked
          ? `Obecność ${result.student} była już potwierdzona.`
          : `Obecność ${result.student} została zapisana.`,
        "success"
      );
      if (result.attendance) {
        renderAttendance(result.attendance);
      } else {
        stats.hidden = true;
      }
      form.reset();
      form.querySelector("input")?.focus();
    } catch (error) {
      show(message, error.message, "error");
      await refresh();
    } finally {
      button.disabled = false;
    }
  });

  await refresh();
  const refreshLoop = async () => {
    await refresh();
    setTimeout(refreshLoop, 30000);
  };
  setTimeout(refreshLoop, 30000);
}

async function startAdmin() {
  document.querySelector("#student-view").hidden = true;
  document.querySelector("#admin-view").hidden = false;

  const loginForm = document.querySelector("#login-form");
  const loginMessage = document.querySelector("#login-message");
  const panel = document.querySelector("#admin-panel");
  const stateForm = document.querySelector("#state-form");
  const sourceInputs = [
    ...document.querySelectorAll('input[name="source"]')
  ];
  const courseSelect =
    document.querySelector("#course-select");
  const sessionSelect =
    document.querySelector("#session-select");
  const isOpen = document.querySelector("#is-open");
  const message = document.querySelector("#admin-message");
  const countdown = document.querySelector("#countdown");

  let currentState;
  let countdownTimer;
  let statsTimer;
  let statsController;
  let stopped = false;

  function currentSource() {
    return (
      sourceInputs.find((input) => input.checked)?.value ||
      "moodle"
    );
  }

  function setSource(source) {
    sourceInputs.forEach((input) => {
      input.checked = input.value === source;
    });
  }

  async function loadSessions(
    courseId,
    selectedId = null
  ) {
    if (!courseId) {
      sessionSelect.replaceChildren(
        new Option("— Najpierw wybierz kurs —", "")
      );
      sessionSelect.disabled = true;
      return;
    }

    sessionSelect.replaceChildren(
      new Option("Ładowanie sesji…", "")
    );
    sessionSelect.disabled = true;

    try {
      const source = currentSource();
      const query =
        source === "google"
          ? `source=google&courseId=${encodeURIComponent(courseId)}`
          : `source=moodle&attendanceId=${encodeURIComponent(courseId)}`;
      const { sessions } = await api(
        `/api/admin/sessions?${query}`
      );

      sessionSelect.replaceChildren(
        new Option(
          `— Wybierz sesję ${
            source === "google" ? "Google" : "Moodle"
          } —`,
          ""
        )
      );

      sessions.forEach((item) => {
        const text =
          source === "google"
            ? item.label
            : `${new Date(
                item.sessdate * 1000
              ).toLocaleString("pl-PL")} — ${
                item.description || "Sesja"
              }`;
        sessionSelect.add(
          new Option(
            text,
            item.id,
            false,
            String(item.id) === String(selectedId)
          )
        );
      });
      sessionSelect.disabled = false;
    } catch (error) {
      sessionSelect.replaceChildren(
        new Option("Błąd ładowania sesji", "")
      );
      show(message, error.message, "error");
    }
  }

  function populateCourses(selectedId = null) {
    const source = currentSource();
    const courses =
      source === "google"
        ? currentState.googleCourses
        : currentState.moodleCourses;

    courseSelect.replaceChildren(
      new Option("— Wybierz kurs —", "")
    );
    courses.forEach((course) => {
      const value =
        source === "google"
          ? course.spreadsheetId
          : course.attendanceId;
      courseSelect.add(
        new Option(
          course.course,
          value,
          false,
          String(value) === String(selectedId)
        )
      );
    });

    const selectedSession =
      source === "google"
        ? currentState.googleSessionId
        : currentState.sessionId;
    void loadSessions(courseSelect.value, selectedSession);
  }

  function refreshCountdown() {
    if (!currentState?.isOpen || !currentState.openedAt) {
      countdown.hidden = true;
      return;
    }
    const seconds =
      900 -
      Math.floor(
        Date.now() / 1000 - currentState.openedAt
      );
    countdown.textContent =
      seconds <= 0
        ? "Lista została zamknięta."
        : `Automatyczne zamknięcie za ${String(
            Math.floor(seconds / 60)
          ).padStart(2, "0")}:${String(
            seconds % 60
          ).padStart(2, "0")}.`;
    countdown.hidden = false;
  }

  async function refreshStats() {
    if (statsController || document.hidden || stopped) {
      return;
    }
    statsController = new AbortController();
    try {
      const data = await api("/api/admin/stats", {
        signal: statsController.signal
      });
      const holder =
        document.querySelector("#live-stats");
      holder.replaceChildren();

      const title = document.createElement("strong");
      title.textContent =
        `Obecnych na sali: ${data.present} / ${data.total}`;

      const list = document.createElement("ol");
      list.className = "live-list";

      if (!data.students?.length) {
        const empty = document.createElement("li");
        empty.className = "live-empty";
        empty.textContent =
          "Brak uczestników do wyświetlenia.";
        list.append(empty);
      } else {
        data.students.forEach((student, index) => {
          const item = document.createElement("li");
          item.className =
            `live-item ${
              student.present ? "present" : "absent"
            }`;

          const number = document.createElement("span");
          number.className = "live-number";
          number.textContent = index + 1;

          const name = document.createElement("span");
          name.className = "live-name";
          name.textContent = student.privateId
            ? `${student.name} · ID: ${student.privateId}`
            : student.name;

          const controlHolder =
            document.createElement("label");
          controlHolder.className = "live-toggle";

          if (currentSource() === "google") {
            const select = document.createElement("select");
            select.className =
              "attendance-status-select";
            select.add(
              new Option("— Nieoznaczony", "unset")
            );
            select.add(new Option("Obecny", "present"));
            select.add(
              new Option("Nieobecny", "absent")
            );
            select.value =
              student.attendanceStatus ||
              (student.present ? "present" : "unset");

            select.addEventListener(
              "change",
              async () => {
                select.disabled = true;
                try {
                  await api(
                    "/api/admin/attendance/toggle",
                    {
                      method: "POST",
                      body: JSON.stringify({
                        studentId: student.id,
                        status: select.value
                      })
                    }
                  );
                  show(
                    message,
                    `Zmieniono status dla ${student.name}.`,
                    "success"
                  );
                  await refreshStats();
                } catch (error) {
                  show(message, error.message, "error");
                } finally {
                  select.disabled = false;
                }
              }
            );
            controlHolder.append(select);
          } else {
            const checkbox =
              document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = student.present;
            checkbox.setAttribute(
              "aria-label",
              `${
                student.present ? "Usuń" : "Dodaj"
              } obecność: ${student.name}`
            );
            checkbox.addEventListener(
              "change",
              async () => {
                const nextPresent = checkbox.checked;
                const confirmed = window.confirm(
                  `${
                    nextPresent ? "Dodać" : "Usunąć"
                  } obecność dla ${student.name}?`
                );
                if (!confirmed) {
                  checkbox.checked = !nextPresent;
                  return;
                }
                checkbox.disabled = true;
                try {
                  await api(
                    "/api/admin/attendance/toggle",
                    {
                      method: "POST",
                      body: JSON.stringify({
                        studentId: student.id,
                        present: nextPresent
                      })
                    }
                  );
                  show(
                    message,
                    `${
                      nextPresent ? "Dodano" : "Usunięto"
                    } obecność dla ${student.name}.`,
                    "success"
                  );
                  await refreshStats();
                } catch (error) {
                  checkbox.checked = !nextPresent;
                  show(message, error.message, "error");
                } finally {
                  checkbox.disabled = false;
                }
              }
            );
            controlHolder.append(checkbox);
          }

          const status = document.createElement("span");
          status.className = "live-status";
          status.textContent = student.present
            ? "✓"
            : student.attendanceStatus === "absent"
              ? "✕"
              : "–";

          item.append(
            number,
            name,
            controlHolder,
            status
          );
          list.append(item);
        });
      }
      holder.append(title, list);
    } catch (error) {
      if (error.name !== "AbortError") {
        show(message, error.message, "error");
      }
    } finally {
      statsController = undefined;
    }
  }

  function scheduleStats() {
    clearTimeout(statsTimer);
    if (stopped) return;
    statsTimer = setTimeout(async () => {
      await refreshStats();
      scheduleStats();
    }, 3000);
  }

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        statsController?.abort();
      } else {
        void refreshStats();
      }
    }
  );

  async function loadPanel() {
    currentState = await api("/api/admin/state");
    loginForm.hidden = true;
    panel.hidden = false;

    setSource(currentState.source || "moodle");
    const googleInput = sourceInputs.find(
      (input) => input.value === "google"
    );
    if (googleInput) {
      googleInput.disabled = !currentState.googleEnabled;
    }

    const selectedCourse =
      currentSource() === "google"
        ? currentState.googleCourseId
        : currentState.attendanceId;
    populateCourses(selectedCourse);

    isOpen.checked = currentState.isOpen;
    refreshCountdown();
    clearInterval(countdownTimer);
    countdownTimer = setInterval(
      refreshCountdown,
      1000
    );
    await refreshStats();
    scheduleStats();
  }

  loginForm.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      try {
        await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            password:
              document.querySelector("#password").value
          })
        });
        await loadPanel();
      } catch (error) {
        show(loginMessage, error.message, "error");
      }
    }
  );

  sourceInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      isOpen.checked = false;
      populateCourses();
      void refreshStats();
    });
  });

  courseSelect.addEventListener(
    "change",
    () => void loadSessions(courseSelect.value)
  );

  stateForm.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      try {
        const source = currentSource();
        const payload = {
          source,
          isOpen: isOpen.checked,
          ...(source === "google"
            ? {
                googleCourseId: courseSelect.value,
                googleSessionId: sessionSelect.value
              }
            : {
                attendanceId: courseSelect.value,
                sessionId: sessionSelect.value
              })
        };
        currentState = {
          ...currentState,
          ...await api("/api/admin/state", {
            method: "POST",
            body: JSON.stringify(payload)
          })
        };
        show(
          message,
          "Zapisano ustawienia.",
          "success"
        );
        refreshCountdown();
        await refreshStats();
      } catch (error) {
        show(message, error.message, "error");
      }
    }
  );

  document
    .querySelector("#logout")
    .addEventListener("click", async () => {
      stopped = true;
      clearTimeout(statsTimer);
      clearInterval(countdownTimer);
      statsController?.abort();
      await api("/api/auth/logout", {
        method: "POST"
      });
      location.reload();
    });

  try {
    await loadPanel();
  } catch (error) {
    if (!error.message.includes("Sesja wygasła")) {
      show(loginMessage, error.message, "error");
    }
  }
}
