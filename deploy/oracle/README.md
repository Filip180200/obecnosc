# Wdrożenie „Obecność” na Oracle Cloud

## Architektura

- Ubuntu 24.04 na OCI.
- Nginx na hoście obsługuje HTTPS.
- Aplikacja Node.js 24 działa w Docker Compose.
- Port kontenera jest dostępny wyłącznie jako `127.0.0.1:8788`.
- SQLite znajduje się w `/srv/obecnosc/data`.
- Dane obecności pozostają w Moodle.

## 1. Katalogi i sekrety

```bash
sudo install -d -m 0750 -o "$USER" -g "$USER" /srv/obecnosc/app
sudo install -d -m 0700 -o 1000 -g 1000 /srv/obecnosc/data
sudo install -d -m 0700 -o 1000 -g 1000 /srv/backups/obecnosc
sudo install -d -m 0750 -o root -g root /etc/obecnosc
sudo install -m 600 /dev/null /etc/obecnosc/obecnosc.env
sudo nano /etc/obecnosc/obecnosc.env
```

Wypełnij plik na podstawie `.env.example`. Ustaw długie, losowe `AUTH_SECRET` i `ADMIN_PASSWORD`.

## 2. Budowa i migracje

```bash
cd /srv/obecnosc/app
git clone <URL_REPOZYTORIUM> .
docker compose -f compose.production.yaml build --pull
docker compose -f compose.production.yaml run --rm app node dist/scripts/migrate.js
docker compose -f compose.production.yaml up -d
docker compose -f compose.production.yaml ps
curl -f http://127.0.0.1:8788/healthz
```

## 3. Nginx i TLS

Najpierw użyj konfiguracji bootstrap:

```bash
sudo cp deploy/nginx/obecnosc-bootstrap.conf /etc/nginx/sites-available/obecnosc
sudo ln -s /etc/nginx/sites-available/obecnosc /etc/nginx/sites-enabled/obecnosc
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d ob.edu.pl
```

Po utworzeniu certyfikatu skopiuj finalną konfigurację, sprawdź ją i przeładuj Nginx:

```bash
sudo cp deploy/nginx/obecnosc.conf /etc/nginx/sites-available/obecnosc
sudo nginx -t
sudo systemctl reload nginx
```

Finalna konfiguracja włącza HSTS dla `ob.edu.pl`. Przed przeładowaniem sprawdź, że certyfikat istnieje i automatyczne odnowienie działa.

## 4. Sprawdzenie Moodle

Najpierw odczytaj statusy bez ujawniania listy studentów:

```bash
docker compose -f compose.production.yaml run --rm app \
  node dist/scripts/inspect-moodle-statuses.js --session-id <ID_SESJI>
```

Ustaw właściwe akronimy `P` i `A`. Nie stosuj domyślnego `takenbyid=1` ani `statusset=1`. Jeśli instalacja Moodle wymaga wartości stałych, ustaw je jawnie w pliku środowiskowym po weryfikacji.

## 5. Cutover

1. Pozostaw wersję Cloudflare aktywną.
2. Uruchom Oracle pod adresem testowym albo przez lokalny wpis `hosts`.
3. Sprawdź `/healthz`, logowanie i listę sesji.
4. Zamknij aktywną listę w starej wersji.
5. Zrób backup nowej bazy.
6. Przełącz DNS `ob.edu.pl`.
7. Sprawdź HTTPS i nagłówki.
8. Wykonaj kontrolowany zapis testowy w Moodle.
9. Obserwuj `docker compose logs -f --tail=200 app`.
10. Zachowaj możliwość szybkiego powrotu do Cloudflare.

## 6. Aktualizacja

```bash
cd /srv/obecnosc/app
git fetch --all --prune
git pull --ff-only
docker compose -f compose.production.yaml build --pull
docker compose -f compose.production.yaml run --rm app node dist/scripts/migrate.js
docker compose -f compose.production.yaml up -d
curl -f http://127.0.0.1:8788/healthz
```

## 7. Backup i odtworzenie

Ręczny backup:

```bash
sudo mkdir -p /srv/backups/obecnosc
docker compose -f compose.production.yaml run --rm \
  -e BACKUP_DIRECTORY=/backups app node dist/scripts/backup-db.js
```

Odtworzenie wykonuj przy zatrzymanej aplikacji:

```bash
docker compose -f compose.production.yaml down
sudo cp /srv/backups/obecnosc/attendance-<DATA>.sqlite3 /srv/obecnosc/data/attendance.sqlite3
sudo chown 1000:1000 /srv/obecnosc/data/attendance.sqlite3
docker compose -f compose.production.yaml up -d
```

## 8. Rollback

- Zamknij listę na Oracle.
- Przywróć poprzedni rekord DNS lub trasę Cloudflare.
- Sprawdź stronę i Moodle.
- Nie uruchamiaj równolegle dwóch aktywnych backendów zapisujących tę samą sesję.
- Stara implementacja znajduje się w `legacy/cloudflare`.

## 9. Wyłączenie starego Cloudflare Workera

Usunięcie kodu z repozytorium nie usuwa istniejącego deploymentu Cloudflare.
W panelu Cloudflare:

1. usuń wszystkie trasy Workera kierujące `ob.edu.pl` lub subdomeny do starego backendu;
2. wyłącz albo usuń deployment pod adresem `workers.dev`;
3. upewnij się, że DNS wskazuje wyłącznie na Oracle/Nginx albo świadomie używane proxy;
4. obróć `MOODLE_TOKEN`, `AUTH_SECRET`, `ADMIN_PASSWORD` i klucz konta serwisowego Google, jeśli były dostępne staremu wdrożeniu;
5. sprawdź, że pod żadnym starym adresem `/api/public/stats` nie zwraca nazwisk.

## 10. Kontrola bezpieczeństwa po wdrożeniu

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -I https://ob.edu.pl/
curl -i -X POST https://ob.edu.pl/api/public/attendance   -H 'Content-Type: application/json'   -H 'Origin: https://evil.example'   --data '{}'
sudo ss -ltnp | grep -E ':80|:443|:8788'
docker compose -f compose.production.yaml ps
docker compose -f compose.production.yaml logs --tail=200 app
```

Oczekiwane wyniki:

- port `8788` nasłuchuje tylko na `127.0.0.1`;
- obcy `Origin` otrzymuje `403`;
- powtarzane bardzo szybkie żądania otrzymują `429`;
- odpowiedzi HTTPS zawierają HSTS, CSP i pozostałe nagłówki ochronne;
- obcy nagłówek `Host` jest odrzucany.

## 11. Kopia poza serwerem

Lokalny backup ma uprawnienia `0600`, ale awaria całej maszyny nadal może
usunąć aplikację i kopie. Okresowo kopiuj backup do oddzielnej,
zaszyfrowanej lokalizacji i wykonuj próbne odtworzenie.
