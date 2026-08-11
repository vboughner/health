# Health Tracker (health.hovercloud.com)

A personal food, exercise, sleep, and weight tracker built around the plan in
`Personal/Mid-2026 Goals.md` of the Obsidian vault at `~/dev/personal`: 2400 cal/day,
~960 cal/day burned, a 9am–7pm eating window, whole-foods / no-meat / no-dairy.

Phone-first PWA. Runs locally during development; deploys to the existing Hetzner VPS
alongside the Griljor game and the blog.

## Commands

```sh
./dev.sh                          # start API (:4300) + web (:5174) together
npm run check                     # tests + lint + format check — must pass before committing
npm test                          # vitest, server + web
npm run lint                      # eslint, server + web
npm run format                    # auto-fix formatting
npm run build                     # build both packages

npm run create-user --prefix server -- <username>    # create a login
npm run seed-demo --prefix server -- <username>      # 6 weeks of fake history, for the charts
node web/scripts/make-icons.mjs                      # regenerate the PWA icons
```

To use it from your phone on the same wifi: `./dev.sh`, then open
`http://<your-mac's-LAN-IP>:5174`. Both dev servers already listen on the LAN.

## Architecture

Two packages, mirroring the `server/` + `client/` split in the griljor repo.

- **`server/`** — Fastify + better-sqlite3, TypeScript, CommonJS, port 4300.
  - `src/domain/` — **pure functions, no I/O**. All the interesting math lives here and is
    unit tested without a server or database: serving→calorie math, macro percentages, the
    MET exercise estimate, the processed-food classifier, day boundaries and eating-window
    derivation. Keep it that way — routes stay thin (parse, call domain, persist, return).
  - `src/routes/` — one file per resource group, all mounted under `/api`.
  - `src/migrations/` — numbered `.sql` files applied at startup, tracked in `schema_migrations`.
    Never edit an applied migration; add a new one.
  - `src/usda.ts` — FoodData Central client behind an interface so tests use a fake.
    **The test suite never hits the network.**
- **`web/`** — Vite + React + TypeScript, ESM. Built to `web/dist/`, served by nginx in
  production. The dev server proxies `/api` to :4300 so cookies behave the same in both.
  - `src/components/charts.tsx` — hand-rolled inline SVG, no chart library. Bars are
    zero-based on purpose; a truncated baseline makes a 1200-calorie day look like a
    fraction of a 2000-calorie one.
  - Chart colors were validated for color-vision deficiency against both surfaces.
    Amber is reserved for warnings, which is why the fat macro is orange.
  - `public/sw.js` — caches the app shell only. It deliberately does **not** cache API
    responses or queue writes offline: showing a stale summary as today's, or a food
    as logged when it never reached the server, would be worse than an honest failure.

## Data model notes

- Every table carries `user_id`. There is one user today, but isolation is enforced in
  queries from the start so adding accounts later is not a rewrite.
- Timestamps are stored as UTC epoch millis **plus** a denormalized `local_day` (`YYYY-MM-DD`)
  computed in the user's timezone. Day rollups are then an indexed `WHERE local_day = ?`,
  and the 7pm cutoff is evaluated in local time.
- `food_log` **snapshots** the computed calories and macros at log time. Re-caching a food
  from USDA later must never rewrite past history.
- "Done eating by 7pm" is **derived** from the last `food_log` entry of the day, not a
  checkbox. Same for the eating window generally.

## Style

- Prettier: 2-space, single quotes, semicolons, 100 columns. Run `npm run format`.
- Tests are required for bug fixes (a regression test that fails before, passes after) and
  for new domain functions. Route changes get an integration test via Fastify `app.inject()`
  against an in-memory database.
- Secrets come from `.env` locally (gitignored) and from PM2 env in production. Never commit
  a key, and never commit the database.

## Deployment

See [`docs/deployment.md`](docs/deployment.md). Short version: PM2 app `health` on port 4300,
nginx serves `web/dist` and proxies `/api`, database lives outside the repo at
`/home/griljor/health-data/app.db`.

Two rules inherited from griljor, both learned the hard way:

- **Never copy a repo nginx template over the live config** — certbot has edited the live
  file to add SSL and copying over it wipes that. Edit in place.
- **Re-run `chmod -R o+r web/dist` after every build** — the dist directory is recreated
  fresh each time and loses the permissions nginx (`www-data`) needs.
