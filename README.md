# 📋 Obecność

Nowoczesny system rejestracji obecności studentów zintegrowany z **Moodle Attendance**, zbudowany w oparciu o **Cloudflare Workers** i **Cloudflare D1**.

Aplikacja umożliwia prowadzącym szybkie otwieranie list obecności, a studentom wygodne potwierdzanie obecności poprzez kod QR lub link. Wszystkie dane są zapisywane bezpośrednio w Moodle.

---

## ✨ Funkcjonalności

* 📱 Rejestracja obecności za pomocą kodu QR lub linku.
* 🎓 Integracja z modułem **Attendance** w Moodle.
* 👨‍🏫 Panel prowadzącego do zarządzania sesją.
* ⏱️ Otwieranie i zamykanie list obecności.
* 📊 Statystyki obecności w czasie rzeczywistym.
* 🔄 Synchronizacja z Moodle.
* 🔒 Bezpieczne przechowywanie danych uwierzytelniających.
* ☁️ Całość hostowana w infrastrukturze Cloudflare.

---

## 🏗️ Architektura

```text
                ┌──────────────────────┐
                │      Student         │
                └──────────┬───────────┘
                           │
                           ▼
                 ob.edu.pl (Cloudflare)
                           │
                           ▼
               Cloudflare Worker API
                    │            │
                    │            │
                    ▼            ▼
             Cloudflare D1    Moodle
```

Cała aplikacja działa w środowisku Cloudflare. Przeglądarka komunikuje się wyłącznie z Workerem, który odpowiada za logikę aplikacji oraz komunikację z Moodle.

---

## 🚀 Technologie

* JavaScript (Vanilla JS)
* HTML5
* CSS3
* Cloudflare Workers
* Cloudflare D1
* Moodle Web Services
* Wrangler CLI

---

## 📁 Struktura projektu

```text
.
├── docs/               # Frontend aplikacji
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   └── config.js
│
├── worker.js           # Backend Cloudflare Worker
├── schema.sql          # Struktura bazy D1
├── wrangler.jsonc      # Konfiguracja Workera
└── README.md
```

---

## ⚙️ Instalacja

### Instalacja zależności

```bash
npm install
```

### Logowanie do Cloudflare

```bash
npx wrangler login
```

### Utworzenie bazy D1

```bash
npx wrangler d1 create attendance-db
```

Następnie wpisz `database_id` do pliku `wrangler.jsonc`.

### Utworzenie tabel

```bash
npx wrangler d1 execute attendance-db --remote --file=./schema.sql
```

### Dodanie sekretów

```bash
npx wrangler secret put MOODLE_TOKEN
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put AUTH_SECRET
```

### Wdrożenie

```bash
npm run deploy
```

Po wdrożeniu aplikacja jest dostępna pod własną domeną skonfigurowaną w Cloudflare.

---

## 🔒 Bezpieczeństwo

Poufne dane nie są udostępniane przeglądarce użytkownika.

| Komponent          | Odpowiedzialność                                       |
| ------------------ | ------------------------------------------------------ |
| Cloudflare Worker  | Logika aplikacji i komunikacja z Moodle                |
| Cloudflare D1      | Przechowywanie stanu aplikacji                         |
| Cloudflare Secrets | Token Moodle, hasło administratora i sekrety aplikacji |

---

## 📱 Jak działa?

1. Prowadzący otwiera listę obecności.
2. Generowany jest kod QR.
3. Student skanuje kod lub otwiera link.
4. Worker weryfikuje możliwość zapisania obecności.
5. Obecność zostaje zapisana w Moodle.
6. Panel prowadzącego aktualizuje statystyki w czasie rzeczywistym.

---

## 📸 Zrzuty ekranu

* ekran studenta,
  <img width="1362" height="916" alt="image" src="https://github.com/user-attachments/assets/484f179b-315f-48f6-9fe6-095f3dcca85b" />

* panel prowadzącego,
  <img width="978" height="1366" alt="image" src="https://github.com/user-attachments/assets/3a565b9e-7f44-4d5d-9a08-eb1f5ddf0376" />

* zamknięta obecność
  <img width="1064" height="564" alt="image" src="https://github.com/user-attachments/assets/ab1b7c36-ebc1-4e9d-8bc2-d365e74a3b2e" />


---

## 🎯 Zastosowanie

Projekt został stworzony z myślą o prowadzących zajęcia wykorzystujących Moodle. Automatyzuje proces sprawdzania obecności, skraca czas organizacji zajęć i minimalizuje możliwość nadużyć.

---

## 👨‍💻 Autor

**Filip Liebersbach**

Projekt rozwijany jako narzędzie wspomagające prowadzenie zajęć akademickich oraz integrację z Moodle.

---

## 📄 Licencja

MIT License.
