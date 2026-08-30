# Rolling the day over at 4am

## The problem

Leave the PWA open overnight, pick the phone up in the morning, and the app is still
on yesterday — yesterday's entries, under a heading that still says "Today".

The symptom suggests a rollover happening at the wrong hour. It is not. There is no
rollover at all:

- `date`, the day being viewed and logged to, is set once from `todayIn(user.timezone)`
  when `/auth/me` returns (`web/src/App.tsx:85`) and nothing ever advances it.
- `today` is recomputed on every render (`web/src/App.tsx:143`), with a comment saying
  that is so leaving the app open past midnight does not leave "Today" pointing at
  yesterday. It does not work, because nothing re-renders overnight: there is no timer
  and no `visibilitychange` listener anywhere in `web/src`.

So `date` is stale, `today` is equally stale, the two still match, and the heading
reads "Today" over the wrong day's entries.

## What 4am is for

Bedtime does **not** need it. `bedtimeBelongsTo` (`web/src/dates.ts:97`) splits the
night at noon, so pressing Down at 1am already writes to the previous evening's
record whatever day is on screen, and says so in a notice. That case works today.

What 4am buys is that the *screen* stays on the evening you are still in, instead of
emptying out at midnight while you are still awake.

## The decision

Between midnight and 4am the app shows the previous day and **calls it "Yesterday"**.

Calendar labels stay literally true. This is purely a change to *when the day
auto-advances*, not to what any date means. The alternative — running an app-day from
4am to 4am and calling it "Today" — was rejected: it would put food logged in those
hours 24 hours in the past through `atTimeOn`, the server would still file it under
the real calendar day so it would surface on a different screen than the one it was
logged from, and `DayNav`'s `max={today}` would make the real current date
unreachable until 4am.

## Design

### Two different days

`todayIn()` keeps its meaning: the literal calendar day. It stays what `today` is and
what `DayNav` and `dayLabel` compare against.

A new `appDay(timezone, now)` answers a different question — which day the screen
should be sitting on right now. It is the calendar day, except before 4am, when it is
the day before.

Between midnight and 4am the two disagree, and that is the point. `date` stays on your
evening while `today` is the new date, so `DayNav` renders "Yesterday" with both the
forward arrow and the Today button present. After 4am they agree and it reads "Today".

### The pure part

The web suite has no testing-library — every test in `web/src/__tests__` exercises a
pure function. The decisions therefore live in `web/src/dates.ts` and the React
wiring stays thin enough not to need a test of its own.

- `appDay(timezone, now)` — the 4am-shifted day.
- `followRollover(date, lastAppDay, appDay)` — returns `appDay` when
  `date === lastAppDay`, otherwise `date` unchanged. This is the "stay put" rule: a
  day you navigated to on purpose is never overridden.
- `DAY_ROLLOVER_HOUR = 4`, exported and documented directly alongside the existing
  `NIGHT_SPLIT_HOUR = 12`. The two look like duplicates and are not: noon decides
  which evening a bedtime belongs to, 4am decides which day the screen shows.
- `hourIn(timezone, now)` — the local hour under `hourCycle: 'h23'`.
  `bedtimeBelongsTo` already builds that Intl formatter inline and `appDay` needs the
  same one, so it is extracted rather than written twice.

### The wiring

Three changes, all in `web/src/App.tsx`:

1. **Seeding.** Initial load (`App.tsx:85`) and login (`App.tsx:125`) seed `date` from
   `appDay` instead of `todayIn`. Opening the app fresh at 1am lands on the evening you
   are in, not an empty new day.

2. **`useCurrentDay(timezone)`.** A hook holding `{ today, appDay }` in state,
   recomputing both on `visibilitychange` → visible, on `focus`, and on a 60-second
   interval. It calls `setState` only when a value actually changed, so the tick costs
   nothing on all but two renders a day. This is what finally makes the *label*
   correct as well as the date: `today` is derived on render, and without a re-render
   overnight "Today" sticks even once `date` is right.

   The hook is called before App's early returns, so it takes `string | null` and
   returns nulls until the user arrives.

3. **The advance.** An effect watching `appDay` against a ref holding the previous
   one. When it changes, `setDate((d) => followRollover(d, ref.current, appDay))` and
   the ref moves forward either way. The functional form matters: the effect is keyed
   on `appDay` alone, so reading `date` out of its closure would compare against
   whatever it was when the day last turned.

### Tests

In `web/src/__tests__/dates.test.ts`:

- `appDay` at 03:59 local → the previous calendar day.
- `appDay` at 04:00 local → the calendar day itself.
- `appDay` at midnight → the previous calendar day.
- `appDay` under a timezone other than the runner's, confirming it reads the account's
  zone rather than the browser's.
- `followRollover` advances when the shown day was the last app-day.
- `followRollover` leaves a deliberately-chosen past day alone.

## Out of scope

**The server does not change.** `local_day` stays the true calendar day; `/summary/:date`
and `/day/:date` still take an explicit date. This is entirely about which date the
client asks for.

**No refetch on resume.** Coming back to the app on the same day will not re-pull the
summary. When the day rolls, the `date` change fetches it; when it does not, you are
the only writer. Adding it is a separate question about multi-device staleness.

**Logging food between midnight and 4am stays rough.** You are on the previous day, so
`isBackfill` is true, the time prefills 12:00 rather than the real hour, and typing
02:00 stamps the entry 24 hours before it happened — `atTimeOn` combines the shown day
with the time. That is how backfill already behaves; this change makes it slightly
easier to reach. It is well outside a 9am–7pm eating window, and the "Yesterday"
heading is the honest signal that you are not on the current date. Fixing it properly
means moving the day boundary into the server's `local_day`, which is the option this
design rejected.

**4am is a constant, not a setting.** One account, one sleep schedule.
