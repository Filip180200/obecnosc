const status = document.querySelector("#status");
const link = document.querySelector("#student-link");
const studentUrl = new URL("./", window.location.href).toString();
link.href = studentUrl;
link.textContent = studentUrl;

async function refresh() {
  try {
    const response = await fetch("/api/public/stats", { credentials: "same-origin" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Nie udało się pobrać danych.");
    status.textContent = `Obecnych: ${data.present} / ${data.total}`;
  } catch (error) { status.textContent = error.message; }
}
await refresh();
const loop = async () => { await refresh(); setTimeout(loop, 3000); };
setTimeout(loop, 3000);
