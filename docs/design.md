# Health Tracker App — Build Plan

## Context

`Personal/Mid-2026 Goals.md` sets a concentrated 2-month push to cut body fat: 2400 cal/day intake, ~960 cal/day burned, a 9am–7pm eating window, and a whole-foods / no-meat / no-dairy diet. The note's own lesson from past attempts is *"record what I eat and my exercise daily — measure it and it will improve."* Generic fitness apps don't fit this plan well: they don't model an eating window, don't nudge on refined/processed ingredients, and don't put sleep, weight, exercise and the daily check-in on one screen.

So: a phone-friendly PWA, built and used locally first, then deployed to the existing Hetzner VPS at `health.hovercloud.com` alongside Griljor and the blog.

**Decisions already made:**

| | |
|---|---|
| Stack | Fastify + SQLite (better-sqlite3) API, Vite + React + TS PWA front end, all TypeScript |
| Repo | New private repo `~/dev/health` (GitHub `vboughner/health`) |
| Domain | `health.hovercloud.com` (deploy phase only) |
| Auth | Real password login in v1, `user_id` on every table |
| Exercise | MET-based estimate as the default, plus a "from watch" field that overrides and is marked *measured* |
| USDA | Van gets a free FoodData Central key; manual food entry works without it |
| Deferred to v2 | Daily YouTube inspiration video (schema leaves room, no code) |

**v1 covers:** food log + USDA lookup + macros, daily entry & check-in (weight, exercise, sleep, boxes), trends over time, processed-food warning flags.

## Existing infrastructure this reuses

Read from `~/dev/griljor` and `~/dev/ai-blog`:

- **VPS**: Hetzner CX22, Ubuntu 24.04, IP `5.78.75.71`, user `griljor`, Node 22, nginx, PM2, certbot. Documented in `~/dev/griljor/docs/vps-infrastructure-guide.md`.
- **Ports in use**: 3000 (lobby), 3001–3007 (game servers). This app takes **4300**.
- **Patterns to copy**: `griljor/server/ecosystem.config.js` (PM2 app + env), `griljor/scripts/rebuild-restart-production.sh` (build + chmod + restart), `ai-blog/.github/workflows/deploy.yml` (Actions → rsync over `DEPLOY_SSH_KEY`), griljor's eslint/prettier/vitest setup and `client/server` split.
- **Hard-won lessons to honor**: never overwrite a certbot-modified nginx config from the repo; re-run `chmod -R o+r` on the built front end after every build (the dist dir is recreated); Cloudflare A records stay grey-cloud.
- **New ground**: this is the first thing on the VPS with a real database. Nothing existing needs to change — the current `hovercloud-redirect` nginx block matches only the apex and `www`, so a new subdomain block won't collide.

---

## Architecture

```
~/dev/health/
├── server/                 Fastify API + SQLite (TypeScript, port 4300)
│   ├── src/
│   │   ├── main.ts         server bootstrap, env config
│   │   ├── db.ts           better-sqlite3 handle + migration runner
│   │   ├── migrations/     001_init.sql, 002_….sql
│   │   ├── auth.ts         argon2 hashing, session cookie, requireUser hook
│   │   ├── routes/         auth.ts, foods.ts, log.ts, day.ts, summary.ts, trends.ts
│   │   ├── usda.ts         FoodDataCentral client behind a small interface
│   │   └── domain/         PURE functions — no I/O, heavily unit tested
│   │       ├── nutrition.ts   serving → kcal/macros, macro percentages
│   │       ├── exercise.ts    MET table → estimated kcal
│   │       ├── processed.ts   processed-food classifier
│   │       └── day.ts         day boundaries in user tz, eating-window derivation
│   └── ecosystem.config.js
├── web/                    Vite + React + TS PWA
│   └── src/
│       ├── screens/        Today.tsx, AddFood.tsx, Trends.tsx, Login.tsx
│       ├── components/     RingGauge, MacroBar, WindowBar, FoodRow, WarningChip
│       └── api.ts          typed fetch wrapper (credentials: 'include')
├── scripts/rebuild-restart-production.sh
├── docs/                   design doc, deployment notes
└── CLAUDE.md
```

`domain/` is the point of the layout: all the interesting math is pure and testable without a server or a database. Routes stay thin — parse, call domain, persist, return.

### Data model (`001_init.sql`)

```
users             id, username, password_hash, timezone, daily_kcal_budget (2400),
                  daily_burn_target (960), window_start ('09:00'), window_end ('19:00'), created_at
sessions          token PK, user_id, expires_at            -- server-side, revocable
foods             id, user_id NULL, source ('usda'|'manual'), source_id, name, brand,
                  serving_desc, serving_grams, kcal_per_100g, protein_g, fat_g, carb_g,
                  added_sugar_g, sodium_mg, ingredients, processed_flags (JSON), created_at
                  -- user_id NULL = shared USDA cache; set = a manual food
                  -- UNIQUE(source, source_id)
food_log          id, user_id, food_id, eaten_at (epoch ms), local_day (YYYY-MM-DD),
                  quantity, unit, grams, kcal, protein_g, fat_g, carb_g
                  -- nutrition SNAPSHOTTED at log time so history never rewrites itself
exercise_log      id, user_id, local_day, activity, minutes, kcal,
                  source ('estimated'|'measured'), note
daily_entries     id, user_id, local_day UNIQUE(user_id,local_day), weight_lb,
                  sleep_start, sleep_end, goals_reviewed, no_meat, no_dairy, note
                  -- 002 folded reviewed_morning/reviewed_night into goals_reviewed
schema_migrations version, applied_at
```

Timestamps are stored as UTC epoch millis plus a denormalized `local_day` computed from the user's timezone, so day rollups are a plain indexed `WHERE local_day = ?` and the 7pm cutoff is evaluated in local time. *Done eating by 7pm* is **derived** from the last `food_log` of the day, not a checkbox — per the goals note's preference for inferring it from timestamps.

### API surface (all under `/api`, all session-guarded except login)

| Route | Purpose |
|---|---|
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | session cookie in/out |
| `GET /foods/search?q=` | your saved foods first, then USDA; caches hits into `foods` |
| `GET /foods/recent`, `GET /foods/frequent` | quick-pick lists |
| `POST /foods` | manual food (works with no USDA key) |
| `POST /log/food`, `DELETE /log/food/:id` | log entries |
| `POST /log/exercise`, `DELETE /log/exercise/:id` | log entries |
| `GET /day/:date`, `PUT /day/:date` | weight, sleep, goals-reviewed flag |
| `GET /summary/:date` | **one call powering the whole Today screen** |
| `GET /trends?days=30` | arrays for the charts |

### Screens

1. **Day** (default) — calories eaten / remaining against 2400; macro % bar; eating-window bar showing first and last bite against 9–7, with the target and a met/not-met verdict on one line; today's entries; exercise burned vs 960; weight and sleep. Arrows and a date picker step to any past day, which stays editable.
2. **Add food** — one search box over saved foods + USDA, results carry a ⚠ chip if flagged; pick → serving/quantity → live kcal/macro preview → log. Amber banner if the food is flagged. Manual-entry escape hatch.
3. **Trends** — weight line with a trend fit, daily calories vs the 2400 line, eating-window and goals-reviewed compliance strips, goal-review streak. 14 / 30 / 90 day toggle.
4. **Goals** — "The Plan" from the vault note, with a button confirming you have read it today.
5. **Login** — username + password.

### Processed-food classifier (`domain/processed.ts`)

Pure function `classify(food) → string[]` of human-readable reasons, computed once when a food is cached:

- added sugar ≥ 10 g / 100 g → "high added sugar"
- sodium ≥ 500 mg / 100 g → "high sodium"
- ingredient-string keyword match → "refined flour", "refined sugar", "hydrogenated fat", "artificial ingredients" (e.g. `enriched flour`, `high fructose corn syrup`, `maltodextrin`, `hydrogenated`, `artificial`, `sodium nitrite`)

USDA Foundation / SR-Legacy entries (raw whole foods — the bulk of this diet) carry no ingredient list and normally trip nothing, which is the right default. Thresholds live in one exported constants object so they're easy to tune after real use. The UI nudges, never blocks — matching the note's "gentle reminder rather than a harsh block."

### Exercise estimate (`domain/exercise.ts`)

`kcal = MET × 3.5 × weightKg / 200 × minutes`, MET table: running 9.8, climbing 8.0, weights 5.0, walking 3.5, cycling 7.5, other 5.0. Weight comes from the most recent `daily_entries.weight_lb`. A watch number entered in the "measured" field replaces the estimate and is tagged so trends can distinguish the two.

---

## Build phases

Each phase ends in something runnable. Tests are written alongside, per the griljor convention (`server/src/__tests__/`, vitest).

**Phase 0 — scaffold.** `~/dev/health` git repo; `server/` and `web/` packages; TypeScript, eslint, prettier, vitest configs lifted from griljor; root `package.json` with `test`/`lint`/`format:check`/`check` scripts; `CLAUDE.md`; `.env.example`; `dev.sh` running both dev servers. Commit the design doc to `docs/`.

**Phase 1 — database + auth.** Migration runner, `001_init.sql`, argon2 password hashing, session cookie (httpOnly, sameSite=lax, secure in prod), `requireUser` hook, a `create-user` CLI script. Login screen + protected shell in `web/`. *Runnable: log in, see an empty Today screen.*

**Phase 2 — food logging.** `domain/nutrition.ts` and `domain/processed.ts` with unit tests; USDA client behind an interface with a fake used in tests (no network in the suite); search / recent / frequent / manual-food routes; Add Food screen; running totals on Today. *Runnable: log a day of real food and watch the totals move.*

**Phase 3 — daily entry + summary.** `domain/exercise.ts` and `domain/day.ts` with unit tests; exercise, weight, sleep and check-in routes; `GET /summary/:date` assembling everything including the derived eating window; full Today screen. *Runnable: the complete daily loop.*

**Phase 4 — trends + PWA.** `/trends` endpoint and charts; `manifest.webmanifest`, icons, a service worker that caches the app shell (offline read of today's cached summary; writes require network in v1). *Runnable: add to home screen on the phone against the laptop dev server over LAN.*

**Phase 5 — deploy** (only after Van has used it locally and likes it).

## Deployment (phase 5)

1. Cloudflare: A record `health` → `5.78.75.71`, **DNS only / grey cloud**.
2. On the VPS as `griljor`: clone to `~/health`, `npm install && npm run build` in `server/` and `web/`.
3. Database lives **outside the repo** at `/home/griljor/health-data/app.db` so redeploys can't touch it.
4. `server/ecosystem.config.js` — one PM2 app `health`, `PORT=4300`, env `DB_PATH`, `SESSION_SECRET`, `USDA_API_KEY`, `NODE_ENV=production`. Secrets come from `/home/griljor/health-data/.env` (never committed).
5. nginx `/etc/nginx/sites-available/health`: `server_name health.hovercloud.com`, static root `/home/griljor/health/web/dist` with `try_files $uri $uri/ /index.html`, `location /api/ { proxy_pass http://127.0.0.1:4300; }`. Then the griljor `chmod o+x` chain on the path plus `chmod -R o+r` on `web/dist`.
6. `sudo certbot --nginx -d health.hovercloud.com`. **After this, never copy the repo nginx template over the live file** — edit in place.
7. `pm2 start ecosystem.config.js && pm2 save`.
8. Nightly cron: `sqlite3 app.db ".backup /home/griljor/health-data/backups/app-$(date +\%F).db"`, keep 14 days. This is the first real data on the VPS — it needs a backup from day one.
9. `scripts/rebuild-restart-production.sh` modeled on griljor's (build both, re-chmod `web/dist`, `pm2 restart health`). A GitHub Actions deploy like the blog's can come later.

## Verification

**Automated** — `npm run check` at the repo root (vitest + eslint + prettier), matching griljor's gate:
- Unit tests for every `domain/` function: serving math, macro percentages, MET calc, processed classifier (whole foods clean, junk flagged, thresholds at the boundary), day boundaries across a DST change, eating-window derivation with zero / one / many entries.
- Integration tests via Fastify `app.inject()` against a fresh in-memory SQLite DB: login required on every route; a second user cannot read the first user's log entries (the isolation the goals note asks for); log → summary round-trip produces the expected totals.
- Migrations run in order at startup; `002` folds the two check-in flags into `goals_reviewed`.
- USDA client tested against a fake; the suite never hits the network.

**Manual, local, before any deploy:**
1. `./dev.sh`, create a user, log in.
2. Search a food Van actually eats (banana, brown rice, black beans, tempeh) against the real USDA key — confirm sane calories and macros.
3. Log a full realistic day; check totals, remaining-against-2400, macro split, and that the eating window bar reflects the first and last entry times.
4. Log something refined (white bread, a packaged snack) — confirm the amber banner and the persistent ⚠ chip on that food in later searches.
5. Enter a climbing session by duration and confirm the estimate; then enter a watch number and confirm it overrides and is marked measured.
6. Enter weight and sleep times; confirm hours slept computes and persists across a reload.
7. Backfill a few days, open Trends, confirm the charts render on a phone-width viewport.
8. Add to home screen from the phone over LAN; confirm it opens full-screen and the shell loads offline.

**After deploy:** `pm2 status` green, `curl -I https://health.hovercloud.com` returns 200 over TLS, login works from the phone on cell data (not just wifi), `sudo certbot certificates` lists the new domain, and a VPS reboot brings the app back automatically.

## Notes

- The vault note `Personal/Mid-2026 Goals.md` gets a short pointer to the new repo once it exists; the note stays the source of truth for the *goals*, the repo for the *app*.
- No changes to griljor, ai-blog, or any existing nginx/PM2 config. Port 4300 and a new subdomain keep this fully additive.
