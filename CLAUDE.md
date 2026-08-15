# Health Tracker (health.hovercloud.com)

A personal food, exercise, sleep, and weight tracker built around the plan in
`Personal/Mid-2026 Goals.md` of the Obsidian vault at `~/dev/personal`: 2400 cal/day,
~960 cal/day burned, a 9am–7pm eating window, whole-foods / no-meat / no-dairy.

That note is the source of truth for the *goals*; this repo owns the *app*. Its "App
Implementation" section is a plain-English summary of what is built here — worth
skimming before a big change.

Phone-first PWA, one user (Van). Runs locally; **not yet deployed**.

## Commands

```sh
./dev.sh                          # start API (:4300) + web (:5174) together
npm run check                     # tests + lint + format check — must pass before committing
npm test                          # typecheck + vitest, server + web
npm run lint                      # eslint, server + web
npm run format                    # auto-fix formatting
npm run build                     # build both packages

npm run create-user --prefix server -- <username>    # create a login (no signup page exists)
npm run seed-demo --prefix server -- <username>      # 6 weeks of fake history, for the charts
node web/scripts/make-icons.mjs                      # regenerate the PWA icons
```

From a phone on the same wifi: `./dev.sh`, then `http://<mac's-LAN-IP>:5174`. Both dev
servers already listen on the LAN.

**Ports**: 4300/5174, deliberately outside 3xxx. Griljor holds 3000–3007 on the VPS and
each local griljor worktree claims the next 3N00 (3100, 3200, …), which collided twice
before this moved.

## Architecture

Two packages, mirroring the `server/` + `client/` split in the griljor repo.

- **`server/`** — Fastify + better-sqlite3, TypeScript, CommonJS, port 4300.
  - `src/domain/` — **pure functions, no I/O**: `nutrition` (serving→calorie math, macro
    percentages), `exercise` (MET estimate), `processed` (refined-food classifier),
    `day` (local-day boundaries, eating window, sleep hours), `trend` (weight slope,
    moving average, streaks). All the interesting arithmetic lives here and is tested
    without a server or database. Keep it that way — routes stay thin: parse, call
    domain, persist, return.
  - `src/routes/` — one file per resource group, all under `/api`: `auth`, `foods`,
    `log`, `day`, `summary`, `trends`.
  - `src/store.ts` — **all SQL**. Every query filters on `user_id`.
  - `src/migrations/` — numbered `.sql` applied at startup, tracked in
    `schema_migrations`. Never edit an applied migration; add a new one.
  - `src/usda.ts` — FoodData Central behind an interface so tests use a fake.
    **The test suite never hits the network.**
- **`web/`** — Vite + React + TypeScript, ESM. Built to `web/dist/`, served by nginx in
  production. The dev server proxies `/api` to :4300 so cookies behave identically in
  dev and prod.
  - Five tabs: `Today` (the day), `Goals`, `AddFood`, `Trends`, `Settings`. Plus
    `Login`.
  - `src/dates.ts` — client-side day arithmetic. Mirrors parts of the server's
    `domain/day.ts` on purpose: the two packages must not import each other.
  - `src/settings.ts` — which features this device tracks (diet, exercise, sleep,
    weight, goals). **Per-device, in `localStorage`** — the server knows nothing about
    it, and nothing is deleted or stops being recorded when a feature goes off. It
    only decides what `Today` and `Trends` draw, so turning one back on brings its
    whole history with it. `nothingTracked()` asks `FEATURES` rather than a list of
    its own, so a toggle added later is counted without anyone remembering to.
  - `src/components/charts.tsx` — hand-rolled inline SVG, no chart library. Bars are
    zero-based on purpose; a truncated baseline makes a 1200-calorie day look like a
    fraction of a 2000-calorie one.
  - `public/sw.js` — caches the app shell only. It deliberately does **not** cache API
    responses or queue writes offline: showing a stale summary as today's, or a food as
    logged when it never reached the server, would be worse than an honest failure.

## Things that are subtle — read before changing them

**Sleep times are filed on the day they happened.** `sleep_start` is the evening you
went to bed; `sleep_end` is the morning you got up. They are *not* two ends of one row:
a night's hours pair **yesterday's** `sleep_start` with **today's** `sleep_end`, which
`GET /summary/:date` does by reading the previous day's record too, and `/trends` does
by fetching one extra day back. This was inverted once (filed under the morning the
night ended) and had to change, because it meant pressing "Down" wrote to *tomorrow's*
record and the field on screen could not update.

**The eating window is derived, never asked.** First and last bite come from `food_log`
timestamps. A checkbox is something you can lie to; a timestamp is not.

**`food_log` snapshots its calories and macros at log time.** Re-caching a food from
USDA later must never rewrite what a past day says you ate. There is a test for this.

**`Today.tsx` renders from `shown` (= `summary.date`), never from `date`.** Stepping
between days keeps the previous day on screen, dimmed, until the new one arrives —
swapping in a spinner collapsed the page and read as a flicker. During that gap `date`
already points at the day being fetched, so anything that reads `date` below the nav
will show one day's numbers under another's heading, or write to the wrong day. Only
`DayNav` follows `date`.

**Amber is a reserved status colour** (`--warn`), used for warnings and window
violations. The macro palette runs carb=green, protein=yellow, fat=red as a traffic
light matching the 80/10/10 target. The protein yellow and the warn amber are close;
they never appear in the same component, but check that if you add one.

**Chart colours were chosen with a CVD validator, not by eye.** Green/yellow/red is the
hardest triple for red-green colourblindness. The dark-mode yellow deliberately sits
above the house lightness band — darkening it into the band collapses green/yellow
separation to ~6 ΔE, and telling two macros apart matters more than uniform mark
weight. If you restyle these, re-run the validator rather than guessing.

## Data model notes

- Every table carries `user_id`. One user today, but isolation is enforced in queries
  from the start so adding accounts later is not a rewrite. Tested.
- Timestamps are UTC epoch millis **plus** a denormalized `local_day` (`YYYY-MM-DD`)
  computed in the user's timezone, so day rollups are an indexed `WHERE local_day = ?`
  and the 7pm cutoff is evaluated in local time.
- `daily_entries.goals_reviewed` (migration 002) replaced `reviewed_morning` /
  `reviewed_night` when the check-in UI was removed and the Goals tab replaced it.
- `daily_entries.no_meat` / `no_dairy` are **vestigial** — columns and server plumbing
  exist, nothing in the UI writes them. They were check-in boxes that proved to be more
  nagging than useful. Either give them a home or drop them in a migration; do not leave
  them half-wired indefinitely.

## Style and workflow

- Prettier: 2-space, single quotes, semicolons, 100 columns. Run `npm run format`.
- Tests required for bug fixes (a regression test that fails before, passes after) and
  for new domain functions. Route changes get an integration test via Fastify
  `app.inject()` against an in-memory database. ~300 tests total.
- **Server tests are type-checked** via `server/tsconfig.test.json`, wired into
  `npm test`. The build config excludes `__tests__` so they are never emitted, which
  also meant nothing checked them — and a test kept writing a column that had been
  dropped two commits earlier, passing the whole time. Note that `exclude` is inherited
  through `extends` and `include` alone does not override it.
- Secrets live in `.env` locally (gitignored) and PM2 env in production. Never commit a
  key or the database.

**Verify UI changes by looking at them.** Several bugs here — a truncated chart
baseline, a nav that swallowed taps, a confirmation that had state but no render —
type-checked and tested fine and were only caught on screen. Playwright driving the
installed Chrome works well:

```js
chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
// viewport 390x844, deviceScaleFactor 3, colorScheme 'dark'
```

Van's password is not in the repo, so for screenshots create a throwaway account,
seed it, and **delete it afterwards**:

```sh
# create user 'shot', then:
npm run seed-demo --prefix server -- shot
# ...screenshot...
# then DELETE FROM users WHERE username='shot'  (cascades)
```

Prefer measuring over eyeballing where you can — element widths, page height across a
day switch, whether text is clipped (`scrollWidth > clientWidth`).

**Seed data is anchored to the day it runs**, so it goes stale within days and leaves
today empty. Re-running is the way to refresh it: it clears the previous seed first
rather than stacking a second copy. It never skips today or yesterday, stops at the
current hour so today reads as in-progress, and leaves today's wake time blank on
purpose so it can be set by hand and watched to update.

## Deployment

**Not yet deployed.** See [`docs/deployment.md`](docs/deployment.md) for the full
first-time steps. Short version: PM2 app `health` on port 4300, nginx serves `web/dist`
and proxies `/api`, database lives outside the repo at
`/home/griljor/health-data/app.db`, secrets in `/home/griljor/health-data/.env`.

Three rules, the first two inherited from griljor and learned the hard way:

- **Never copy a repo nginx template over the live config** — certbot has edited the
  live file to add SSL and copying over it wipes that. Edit in place.
- **Re-run `chmod -R o+r web/dist` after every build** — the dist directory is recreated
  fresh each time and loses the permissions nginx (`www-data`) needs.
- **Set up the nightly SQLite backup before relying on it.** This is the first thing on
  that VPS with a real database; the data exists nowhere else.
