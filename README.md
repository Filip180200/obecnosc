# Lista obecności: GitHub Pages + Cloudflare Worker

Ten projekt nie używa PHP. Folder `docs` jest publiczną stroną dla GitHub Pages. `worker.js` jest prywatnym API hostowanym w Cloudflare Workers; tylko on komunikuje się z Moodle i ma dostęp do tokenu.

## 1. Koniecznie zmień stare dane

Token Moodle oraz hasło administratora z wcześniejszego `index.php` były zapisane jawnie. **Unieważnij token Moodle i ustaw nowe hasło administratora**, zanim opublikujesz nową wersję. Nie wpisuj nowych wartości do żadnego pliku w repozytorium.

## 2. Wdróż bezpieczne API w Cloudflare

1. Zainstaluj Node.js LTS i uruchom `npm install`.
2. Zaloguj się do Cloudflare: `npx wrangler login`.
3. Utwórz bazę: `npx wrangler d1 create attendance-db`.
4. Skopiuj identyfikator zwrócony przez polecenie do `database_id` w pliku [wrangler.jsonc](./wrangler.jsonc).
5. Utwórz tabele: `npx wrangler d1 execute attendance-db --remote --file=./schema.sql`.
6. Dodaj sekrety — będą zaszyfrowane w Cloudflare i niedostępne w GitHub Pages:

   ```powershell
   npx wrangler secret put MOODLE_TOKEN
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put AUTH_SECRET
   ```

   Dla `AUTH_SECRET` użyj losowego ciągu o długości co najmniej 32 znaków.
7. W pliku `wrangler.jsonc` ustaw `ALLOWED_ORIGIN` na dokładny adres strony z GitHub Pages, np. `https://jan-kowalski.github.io`.
8. Uruchom `npm run deploy`. Zapisz adres zakończony na `workers.dev`, który pokaże terminal.

## 3. Wdróż stronę w GitHub Pages

1. W pliku [docs/config.js](./docs/config.js) wstaw adres Workera w `apiUrl`.
2. Wypchnij repozytorium do GitHub **dopiero po usunięciu starego `index.php`**.
3. W ustawieniach repozytorium: **Settings → Pages → Deploy from a branch**, wybierz gałąź `main` i katalog `/docs`.
4. Po chwili GitHub pokaże adres strony. Wróć do kroku 7 i upewnij się, że dokładnie ten adres jest wpisany jako `ALLOWED_ORIGIN`, po czym wdroż Worker ponownie.

Panel prowadzącego otwiera się pod adresem strony z dopiskiem `?admin=1`.

## Co przechowuje gdzie

| Miejsce | Zawartość |
| --- | --- |
| GitHub Pages | Wyłącznie HTML, CSS i JavaScript interfejsu (`docs/`) |
| Cloudflare Worker | Wywołania Moodle, logowanie prowadzącego, kontrola 15 minut |
| Cloudflare D1 | Stan aktualnie otwartej listy |
| Cloudflare Secrets | Token Moodle, hasło administratora, sekret sesji |
