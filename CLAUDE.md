# Health Tracker (health.hovercloud.com)

A personal food, exercise, sleep, and weight tracker built around the plan in
`Personal/Mid-2026 Goals.md` of the Obsidian vault at `~/dev/personal`: 2400 cal/day,
~960 cal/day burned, a 9am–7pm eating window, whole-foods / no-meat / no-dairy.

Phone-first PWA. Runs locally during development; deploys to the existing Hetzner VPS
alongside the Griljor game and the blog.

## Commands

```sh
./dev.sh                          # start API (:3200) + web (:5174) together
npm run check                     # tests + lint + format check — must pass before committing
npm test                          # vitest, server + web
npm run lint                      # eslint, server + web
npm run format                    # auto-fix formatting
npm run build                     # build both packages

npm run create-user --prefix server -- <username>    # create a login
```

## Architecture

Two packages, mirroring the `server/` + `client/` split in the griljor repo.

- **`server/`** — Fastify + better-sqlite3, TypeScript, CommonJS, port 3200.
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
  production. The dev server proxies `/api` to :3200 so cookies behave the same in both.

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

See [`docs/deployment.md`](docs/deployment.md). Short version: PM2 app `health` on port 3200,
nginx serves `web/dist` and proxies `/api`, database lives outside the repo at
`/home/griljor/health-data/app.db`.

Two rules inherited from griljor, both learned the hard way:

- **Never copy a repo nginx template over the live config** — certbot has edited the live
  file to add SSL and copying over it wipes that. Edit in place.
- **Re-run `chmod -R o+r web/dist` after every build** — the dist directory is recreated
  fresh each time and loses the permissions nginx (`www-data`) needs.
