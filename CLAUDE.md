# Health Tracker (health.hovercloud.com)

A personal food, exercise, sleep, and weight tracker. Phone-first PWA, one user (Van).
Live at **https://health.hovercloud.com** since 2026-08-16, and also runs locally.

**The goals live in the app, per account.** The calorie budget, daily burn target and
eating window are rows in `goal_periods`, edited on the Settings screen; the plan itself
is markdown in `users.plan_md`, written and read on the Goals tab. It started as a copy
of `Personal/Mid-2026 Goals.md` in the Obsidian vault at `~/dev/personal` — 2400 cal/day,
~960 burned, a 9am–7pm window, whole foods / no meat / no dairy — and that note is still
worth reading for the reasoning behind those numbers. It is no longer the source of
truth: a second account writes its own plan, and there is no reason it should live in
someone else's vault. Keeping the note in step is a habit now, not a coupling.

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
    moving average, streaks), `recording` (mime allowlist, size and length caps,
    filenames). All the interesting arithmetic lives here and is tested without a
    server or database. Keep it that way — routes stay thin: parse, call domain,
    persist, return.
  - `src/routes/` — one file per resource group, all under `/api`: `auth`, `foods`,
    `log`, `day`, `summary`, `trends`.
  - `src/store.ts` — **all SQL**. Every query filters on `user_id`.
  - `src/migrations/` — numbered `.sql` applied at startup, tracked in
    `schema_migrations`. Never edit an applied migration; add a new one.
  - `src/usda.ts` — FoodData Central behind an interface so tests use a fake.
    **The test suite never hits the network.**
  - Recordings of the goals are **files, not rows**: the audio lives in `MEDIA_DIR`
    (`data/audio/` locally, beside `app.db` in production) and `goal_recordings` holds
    one metadata row per user. Uploads arrive as a raw `audio/*` body through a regex
    content-type parser — there is no multipart dependency — and the POST route carries
    its own `bodyLimit`, because Fastify's default of 1 MB is under a long recording.
- **`web/`** — Vite + React + TypeScript, ESM. Built to `web/dist/`, served by nginx in
  production. The dev server proxies `/api` to :4300 so cookies behave identically in
  dev and prod.
  - Five tabs: `Today` (the day), `Goals`, `AddFood`, `Trends`, `Settings`. Plus
    `Login`.
  - Every card on `Today` folds. `CollapsibleCard` keeps the choice per card in
    `localStorage` — the screen unmounts on every tab switch, so component state alone
    springs each one back open on the way back from Add food. A collapsed card still
    answers its own question through `summary`, so folding one costs a detail rather
    than the whole picture: calories keep what is left of the budget (red when over),
    Morning the weight and wake time, Bedtime the bedtime and whether the plan was
    read. Those lines drop whatever the account does not track or has not recorded,
    and vanish entirely rather than show a lonely separator.
  - `src/dates.ts` — client-side day arithmetic. Mirrors parts of the server's
    `domain/day.ts` on purpose: the two packages must not import each other.
  - `src/settings.ts` — which features this account tracks (diet, exercise, sleep,
    weight, goals). **Per-account, on the server** — five `track_*` columns on `users`,
    arriving with the user from `/auth/me`. This was per-device in `localStorage`, and
    the reasoning for that was written down and argued for; it was deliberately reversed
    in migration 006, because one account should mean one set of settings on every
    device you sign into. The toggles already on a phone were **not** adopted — the
    server's defaults won once, and `clearLegacySettings()` deletes the old key on boot.
    Nothing is deleted or stops being recorded when a feature goes off; it only decides
    what `Today` and `Trends` draw, so turning one back on brings its whole history with
    it. `nothingTracked()` still asks `FEATURES` rather than a list of its own, so a
    toggle added later is counted without anyone remembering to — and `domain/features.ts`
    gives the server the same property for validating and storing them.
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

**A food with `weight_unknown` has grams that nobody measured.** Everything is stored
per 100 g because that is how USDA publishes it, so a hand-entered food whose serving
is defined by its calories ("one bowl is 320 cal") is stored with `serving_grams = 100`
and the per-serving figures in the per-100g columns. One serving then works out to
exactly the calories typed and no arithmetic changes. `weight_unknown` (migration 003)
is what stops those bookkeeping grams being shown as if they were real: such a food
displays no gram figure anywhere and `toGrams` refuses to log it by weight. The flag is
snapshotted onto `food_log` for the same reason the calories are.

**A quick entry has no macros, and that is not the same as having none.** "Log
Calories Only" writes a `food_log` row with a name, a calorie figure and a time, and no
`foods` row at all — the point is not to fill search and "Eaten often" with one bowl of
soup you will never pick again. Its `food_id` is null, its `quantity`/`unit`/`grams` are a
nominal `1`/`serving`/`0`, and `macros_unknown` (migration 008) is what stops the zeros in
its macro columns reading as measurements, exactly as `weight_unknown` does for bookkeeping
grams. `macroSplit` needs no special case — it divides macro-derived calories by each
other, so an entry with none contributes nothing — but a split of part of a day presented
as a split of all of it is the lie the flag exists to prevent: `unaccountedKcal` feeds
`summary.food.macro_unknown_kcal` and Today prints "720 of 1391 cal have no macros on
record" under the bar. The window and the budget do count these entries; a bite is a bite.

**The eating window is derived, never asked.** First and last bite come from `food_log`
timestamps. A checkbox is something you can lie to; a timestamp is not.

**Goals are effective-dated, and editing asks how far back it reaches.** The eating
window and the budget are evaluated per request, so changing them would otherwise
re-judge every past day — right for fixing a typo, wrong for a real schedule change.
`goal_periods` holds each set with the day it took effect, `goalsForDay` picks the one
covering a day (falling back to the earliest, so seeded history behind the first period
still resolves), and Save offers *from today onward* against *fix a mistake*. A
correction rewrites the period covering **today**, not all of them, so fixing an October
typo cannot undo a September change. Once you have edited today the two are the same row
and do the same thing.

**Settings need the network and nothing is queued.** A toggle moves at once and goes
back if the write fails; the goal form and the plan editor keep your edits on screen.
This is the same call `sw.js` makes about the app shell — a setting that looks saved and
is not is worse than one that says it could not be.

**`food_log` snapshots its calories and macros at log time.** Re-caching a food from
USDA later must never rewrite what a past day says you ate. There is a test for this.

**Editing an entry scales that snapshot, never the food behind it.** `PATCH
/log/food/:id` reads the row's own figures and multiplies them by one factor; it
does not look the food up. Pricing an edit at the food's current per-100g numbers
would reopen the hole above from the other side, so that nudging a time on a
March entry quietly re-priced it. Two things follow. The **unit is not editable** —
the serving size lives on the food and the entry knows only the grams it worked
out to. And the **amount and the calories are two spellings of one number**: typing
400 onto a 320-cal entry is another way of saying you ate a quarter more of it, so
it back-solves the amount and carries the macros with it. `factorForKcal` refuses a
zero-calorie entry rather than dividing by zero — no amount of black coffee comes
to 400 cal. A quick entry has no amount to scale, so its edit is its name, its
calories and its time, and both its flags survive untouched.

**The day on screen turns over at 4am, and "today" is two different things.**
`todayIn` is the literal calendar day: it is what `today` is, and what `DayNav` and
`dayLabel` compare against. `appDay` is the day the screen should be *sitting* on,
which before 4am is still the previous one. Between midnight and 4am the two
disagree on purpose — you see the evening you are still in, honestly labelled
"Yesterday", with the forward arrow and the Today button both there. `DAY_ROLLOVER_HOUR`
is deliberately not `NIGHT_SPLIT_HOUR`: noon answers which evening a bedtime belongs
to, and as a rollover would leave the screen a day behind until lunchtime.

`useCurrentDay` in `App.tsx` is what makes any of it happen. `today` was already
derived on render, with a comment claiming that kept it fresh past midnight — it did
not, because nothing re-renders overnight. There is no polling loop that would have
caught it either: the hook re-renders on `visibilitychange`, on `focus`, and on a
60-second tick, and moves its state only when one of the two days actually changed.
A phone sleeps its timers, so the interval alone would not fire on the way back from
an overnight suspend; picking the phone up is what `visibilitychange` is for.

Only a screen that was *following* the current day moves with it. `followRollover`
leaves a day you stepped back to on purpose exactly where you put it. Both it and
`appDay` are pure and tested; the hook is thin enough not to be.

The day boundary stops at the client. `local_day` on the server is still the true
calendar day, so food logged between midnight and 4am is filed under the new date
while the screen is on the old one — and, because that day counts as a backfill, its
time prefills 12:00 rather than the real hour. Well outside a 9am–7pm window, and the
"Yesterday" heading is the honest signal. Moving the boundary into `local_day` would
fix it and re-judge every past day's eating window; that was considered and rejected.

**An exercise edit rescales its snapshot too, for a sharper reason.**
`exercise_log.kcal` comes from `estimateKcal(activity, minutes, weightThen)`, and body
weight is *meant* to change — so re-estimating on edit would re-price every past
workout at what you weigh today. `PATCH /log/exercise/:id` therefore never calls
`latestWeight`; `rescaleBurn` multiplies the row's own figure by the MET ratio and the
minutes ratio. Because the MET formula is linear in both, that is exactly what
`estimateKcal` would have returned at the original weight — so not having a weight
lookup is what makes re-pricing impossible, rather than merely an optimisation. There
is a route test that changes the weight between logging and editing.

Repeated edits can drift a calorie or two, since the snapshot was already rounded.
That is well inside the error of an estimate scaled by an estimated weight.

What does **not** carry over from the food sheet is "the amount and the calories are
two spellings of one number". A food's calories are a measured fact; an exercise's are
only ever an estimate from the MET table, with no second source, so a box to type them
in would be an override dressed as a correction and nothing would record that it had
happened. `EditExercise` shows the figure and never takes one. For the same reason the
sheet is titled "Workout" rather than the activity: the activity is a picker inside it,
and a heading echoing that picker is a duplicate until you touch it and a contradiction
afterwards.

The time and the day are not editable either — `logged_at` is displayed nowhere and
nothing derives from it, since the eating window reads food timestamps only. A workout
on the wrong day still means delete and re-log.

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

**A recording's duration is measured by the recorder, not read from the file.** Blobs
out of `MediaRecorder` routinely carry no duration in their header and an `<audio>`
element reports `Infinity` for them, so the web recorder counts elapsed milliseconds
itself and posts them as `?duration_ms=`. Do not "simplify" this by reading it back
off the element.

**Recording needs a secure context.** `getUserMedia` is absent — not merely refused —
over plain http, so recording cannot work from the phone at `http://<LAN-IP>:5174`.
Playback is unaffected. The recorder says which of the two it is rather than failing
silently. On the Mac, `localhost:5174` counts as secure and can be used to test capture.

## Data model notes

- Every table carries `user_id`. One user today, but isolation is enforced in queries
  from the start so adding accounts later is not a rewrite. Tested.
- Timestamps are UTC epoch millis **plus** a denormalized `local_day` (`YYYY-MM-DD`)
  computed in the user's timezone, so day rollups are an indexed `WHERE local_day = ?`
  and the 7pm cutoff is evaluated in local time.
- `daily_entries.goals_reviewed` (migration 002) replaced `reviewed_morning` /
  `reviewed_night` when the check-in UI was removed and the Goals tab replaced it.
- `food_log.food_id` is nullable and quick entries use it that way — a logged thing with
  no food behind it. Anything reading the log must cope with a null food; `listFoodLog`
  already LEFT JOINs for the processed flags.
- `goal_periods` is the only store for the goal numbers. Migration 005 dropped the four
  columns that used to live on `users`; there is no live copy anywhere else to drift
  out of sync with it.

## Style and workflow

- Prettier: 2-space, single quotes, semicolons, 100 columns. Run `npm run format`.
- Tests required for bug fixes (a regression test that fails before, passes after) and
  for new domain functions. Route changes get an integration test via Fastify
  `app.inject()` against an in-memory database. 420 server + 121 web tests.
- **Both packages type-check their tests**, and each `npm test` runs `tsc` before
  vitest, so a test that does not compile fails the suite rather than passing quietly.
  The two do it differently because their build configs differ:
  - `server/` needs its own `tsconfig.test.json`. The build config excludes
    `__tests__` so they are never emitted, which also meant nothing checked them —
    and a test kept writing a column that had been dropped two commits earlier,
    passing the whole time. Note that `exclude` is inherited through `extends` and
    `include` alone does not override it.
  - `web/` needs no second config: its `tsconfig.json` says `include: ["src"]`, which
    already covers `src/__tests__`. Only the wiring was missing — `npm test` was a
    bare `vitest run`, so for a while the web half of `npm run check` did no
    type-checking at all and a type error passed `check` and failed `build`. Both
    scripts now run `tsc --noEmit`.
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
```

Then delete it. **Turn foreign keys on explicitly** — the `sqlite3` CLI has them off by
default, so a bare `DELETE FROM users` leaves every dependent row stranded rather than
cascading:

```sh
sqlite3 data/app.db "PRAGMA foreign_keys = ON; DELETE FROM users WHERE username='shot';"
```

The app itself always sets that pragma at startup, which is why the cascade looks reliable
until the first time you clean up by hand. A recording's audio file is *not* covered by the
cascade either way, because it is not in the database:

```sh
rm -f data/audio/goals-*
```

Prefer measuring over eyeballing where you can — element widths, page height across a
day switch, whether text is clipped (`scrollWidth > clientWidth`).

**Seed data is anchored to the day it runs**, so it goes stale within days and leaves
today empty. Re-running is the way to refresh it: it clears the previous seed first
rather than stacking a second copy. It never skips today or yesterday, stops at the
current hour so today reads as in-progress, and leaves today's wake time blank on
purpose so it can be set by hand and watched to update.

## Deployment

**Live at https://health.hovercloud.com.** To ship a change: `cd ~/health && git pull`
on the VPS, then `bash ~/health/scripts/rebuild-restart-production.sh`. See
[`docs/deployment.md`](docs/deployment.md) for the first-time steps and troubleshooting.
Short version: PM2 app `health` on port 4300, nginx serves `web/dist` and proxies
`/api`, database lives outside the repo at `/home/griljor/health-data/app.db`, secrets
in `/home/griljor/health-data/.env`.

Adding a login on the VPS is `create-user` again, but it **must** be given the env file
— `ENV_FILE=/home/griljor/health-data/.env` — because PM2 passes that to the server and
nothing passes it to a shell. See "Adding a login" in the deployment doc; without it the
account goes into a second database that nothing reads and nothing backs up.

Three rules, the first two inherited from griljor and learned the hard way:

- **Never copy a repo nginx template over the live config** — certbot has edited the
  live file to add SSL and copying over it wipes that. Edit in place.
- **Re-run `chmod -R o+r web/dist` after every build** — the dist directory is recreated
  fresh each time and loses the permissions nginx (`www-data`) needs.
- **Set up the nightly backup before relying on it.** `scripts/backup.sh` covers two
  things — `app.db` and the `audio/` directory of goals recordings beside it — because
  the recordings deliberately are not in the database. A `.backup` of the database
  alone looks complete and loses every recording. This is the first thing on that VPS
  with real data; it exists nowhere else.
