# Health Tracker

[![check](https://github.com/vboughner/health/actions/workflows/check.yml/badge.svg)](https://github.com/vboughner/health/actions/workflows/check.yml)

A personal food, exercise, sleep and weight tracker. Phone-first PWA, one user, built
around a specific plan rather than around being general — there is no onboarding, no
signup page, and no settings for things that are simply decided.

**Not yet deployed.** It runs locally, and on a phone over the same wifi.

## What it does

Five tabs:

| Tab | |
|---|---|
| **Day** | Calories in and out, what you ate, macro split, the eating window, sleep, weight |
| **Goals** | The plan, for reading. Opening it records the day as reviewed |
| **Food** | Search USDA's food database, or enter a food by hand; log by weight or by serving |
| **Trends** | Weight trend, averages for eaten, burned and slept, days in window, review streak |
| **Settings** | Which features this device tracks, and logging out |

Some things worth knowing about how it behaves:

- **The eating window is derived, never asked.** First and last bite come from the log's
  own timestamps. A checkbox is something you can lie to; a timestamp is not.
- **Every log entry snapshots its own calories and macros.** Re-caching a food from USDA
  later can never rewrite what a past day says you ate.
- **Feature toggles only hide things.** Turning one off deletes nothing and stops nothing
  being recorded, so turning it back on brings its whole history with it.
- **The goals can be recorded in your own voice** and played back from the Goals page, for
  mornings when reading is more than tired eyes want to do. The audio is stored as a file
  beside the database, not in it.
- **Charts are hand-rolled SVG with zero-based bars**, and their colours were picked with
  a colour-vision-deficiency validator rather than by eye.

## Running it

Requires **Node 22 LTS**. Node 24 works on macOS, but `better-sqlite3` publishes no
prebuilt binary for it, so it compiles from source — and on Linux that build crashes the
test runner during teardown. CI runs 22 for this reason.

```sh
./dev.sh
```

That is the whole thing. On first run it creates `.env` from `.env.example` with a
generated session secret, installs both packages' dependencies, and starts the API on
:4300 and the web app on :5174.

Then create a login — there is no signup page, deliberately:

```sh
npm run create-user --prefix server -- <username>
```

It prompts for a password twice; eight characters minimum.

**From a phone on the same wifi**, open `http://<your-mac's-LAN-IP>:5174`. Both dev
servers already listen on the LAN. Note that recording your voice will *not* work over
that address — microphone access needs HTTPS or `localhost` — though playback is fine.

**Food search** needs a free [USDA FoodData Central key](https://fdc.nal.usda.gov/api-key-signup.html)
in `.env`. Without one, search falls back to your saved foods and manual entry.

**To see the charts with something in them**, seed six weeks of fake history:

```sh
npm run seed-demo --prefix server -- <username>
```

It re-anchors to the day it runs and clears the previous seed rather than stacking a
second copy, so re-run it whenever the data has gone stale.

## Commands

```sh
npm run check     # tests + lint + format check — what CI runs, and what must pass
npm test          # typecheck + vitest, both packages
npm run lint
npm run format    # auto-fix
npm run build     # build both packages
```

## Layout

```
server/    Fastify + better-sqlite3, TypeScript, port 4300
  domain/    pure functions, no I/O — all the interesting arithmetic lives here
  routes/    thin: parse, call domain, persist, return
  store.ts   all SQL; every query filters on user_id
  migrations/  numbered .sql, applied at startup

web/       Vite + React, port 5174, built to web/dist and served by nginx in production
  screens/     one per tab
  components/
  styles.css   hand-written, no framework
```

The two packages never import from each other. A handful of constants are deliberately
written out twice, with a comment on each copy saying so.

## Testing

384 tests — 312 server, 72 web. Domain logic is tested without a server or a database; routes get
integration tests through Fastify's `app.inject()` against an in-memory database. **The
test suite never touches the network** — USDA sits behind an interface and the tests pass
a fake.

UI changes are also checked by looking at them, with Playwright driving real Chrome at
phone size. Several bugs here type-checked and tested cleanly and were caught only on
screen.

## More

- [`CLAUDE.md`](CLAUDE.md) — architecture, the parts that are subtle, and why they are
  the way they are. Read it before a big change.
- [`docs/deployment.md`](docs/deployment.md) — first-time deploy: PM2, nginx, certbot,
  and the nightly backup.
- [`docs/design.md`](docs/design.md) — the original build plan, including why a generic
  fitness app was not the answer.

The *goals* themselves live in an Obsidian vault note outside this repo, which stays their
source of truth; this repo owns the app.
