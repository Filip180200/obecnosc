# Obecność

System rejestracji obecności studentów zintegrowany z Moodle Attendance. Wersja 2 działa na Oracle Cloud VM jako aplikacja Node.js uruchamiana przez Docker Compose, z Nginx jako reverse proxy i lokalną bazą SQLite.

## Sposób działania

1. Prowadzący wybiera kurs i sesję pobraną z Moodle.
2. Backend sprawdza, czy `sessionId` rzeczywiście należy do wskazanego kursu.
3. Lista jest otwierana maksymalnie na 15 minut.
4. Student wpisuje imię i nazwisko.
5. Z jednego telefonu można kolejno wpisać kilka osób, np. gdy ktoś nie ma sprawnego urządzenia.
6. Prowadzący porównuje publiczny licznik z liczbą osób na sali i może ręcznie poprawiać statusy.
7. Właściwa obecność jest zapisywana w Moodle; SQLite przechowuje jedynie stan aplikacji i limit prób logowania.

System nie jest kryptograficznym potwierdzeniem fizycznej tożsamości osoby obsługującej telefon. Ostateczna kontrola liczby obecnych należy do prowadzącego.

## Architektura

```text
Przeglądarka -> HTTPS/Nginx -> Node.js 24 + Hono -> Moodle Web Services
                                     |
                                     +-> SQLite (/data)
```

Port aplikacji jest publikowany wyłącznie na `127.0.0.1:8788`. Publiczny endpoint statystyk zwraca tylko `present` i `total`; nazwiska są dostępne wyłącznie po zalogowaniu administratora.

## Rozwój lokalny

Wymagany jest Node.js 24.

```bash
npm install
cp .env.example .env
npm run migrate
npm run dev
```

## Walidacja

```bash
npm run lint
npm run typecheck
npm test
npm run build
docker build -t obecnosc:local .
docker compose config
```

## Konfiguracja

Wszystkie sekrety są przekazywane przez zmienne środowiskowe. Najważniejsze zmienne opisuje `.env.example`:

- `MOODLE_TOKEN`
- `ADMIN_PASSWORD`
- `AUTH_SECRET`
- `MOODLE_PRESENT_STATUS_ACRONYM`
- `MOODLE_ABSENT_STATUS_ACRONYM`
- opcjonalne, jawne `MOODLE_TAKEN_BY_ID` i `MOODLE_STATUS_SET`

Backend nie stosuje ukrytych fallbacków `1` dla identyfikatorów Moodle.

## Bezpieczeństwo i prywatność

- sesja administratora jest podpisana HMAC i przechowywana w cookie `HttpOnly`, `Secure`, `SameSite=Lax`;
- żądania modyfikujące wymagają prawidłowego `Origin`;
- publiczny licznik nie ujawnia nazwisk ani identyfikatorów Moodle;
- logi są strukturalne i redagują sekrety oraz dane studentów;
- zewnętrzny generator QR został zastąpiony lokalnie generowanym SVG;
- wywołania Moodle mają timeout i operacje zapisujące nie są automatycznie ponawiane;
- statusy obecności są mapowane po akronimach, a nie pozycji w tablicy.

## Oracle Cloud

Pełna instrukcja wdrożenia, konfiguracji Nginx, TLS, backupu, aktualizacji i rollbacku znajduje się w `deploy/oracle/README.md`.

## Poprzednia wersja Cloudflare

Pliki Cloudflare Workers/D1 są zachowane w `legacy/cloudflare` jako materiał rollbackowy. Nie należy uruchamiać jednocześnie dwóch aktywnych backendów zapisujących tę samą sesję Moodle.

## Licencja

MIT License. Szczegóły w pliku `LICENSE`.
