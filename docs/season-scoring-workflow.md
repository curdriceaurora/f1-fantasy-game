# Season Scoring Workflow

## Why a State Machine Helps

The scoring pipeline has a small number of meaningful lifecycle states and one high-cost failure mode: publishing Monday standings before the race weekend has actually been reviewed for steward outcomes and FIA fines. That makes an explicit state model useful.

What matters here is not a full workflow framework. The domain is small enough that a lightweight state model in code is easier to maintain than introducing XState or another runtime dependency.

The current internal lifecycle is:

- `scheduled`: the Monday publication window has not opened yet
- `awaiting_fine_review`: Monday scoring time has arrived, but nobody has explicitly confirmed the fine ledger for that race
- `ready_to_score`: the race is eligible for Monday scoring
- `finalized`: normalized race data and scored outputs both exist

- `postponed`: the race was pulled from its date and no replacement date is confirmed
- `cancelled`: the race will not be run this season

This is implemented in [race-workflow.js](../lib/race-workflow.js).

## When the Calendar Moves

A calendar entry is a plan, not a promise. The 2026 season made that concrete: Bahrain and Saudi Arabia were postponed after the Iran conflict, Bahrain came back in October at Sepang as the *Gulf Air Bahrain Grand Prix in Malaysia*, and Saudi Arabia was never reinstated. A race can therefore change date, change country, and keep its name — while a different race keeps the name it used to share.

Two calendar fields absorb that, both in [`season/config/2026-calendar.json`](../season/config/2026-calendar.json):

**`status`** — one of `scheduled` (default), `rescheduled`, `postponed`, `cancelled`. Only `scheduled` and `rescheduled` are ever scored; the other two are skipped by `auto:score` and `reconcile:season` rather than retried as failures, and surface to the dashboard as their own status. Alongside it, `originalDate`, `venue` and `notes` record what happened and why.

**`sources`** — per-provider name overrides, because the providers disagree. The June race is FIA's `Barcelona-Catalunya Grand Prix` and OpenF1's `Barcelona Grand Prix`; the name `Spanish Grand Prix` belongs to the September round in Madrid. Without `sources.openf1MeetingName` and `sources.fiaEventName`, a race can silently resolve to the wrong weekend.

`date` always means the date the race is actually expected to run. Rescheduling is therefore a data edit, not a code change:

1. Confirm the outcome against [formula1.com](https://www.formula1.com/en/racing/2026) — it is the definitive source for whether a race moved, and to when.
2. Set `status`, move `date` to the new race Sunday, and record `originalDate` and `venue`.
3. If either provider files the race under a different name, pin it in `sources`.
4. Set `round` and `officialRound` to the same value — the race's position in the *revised* 2026 championship (the sequence of races that actually run, so Bahrain's October return is `16`, not its original April slot). A cancelled race takes `round: null` and `officialRound: null`: it is dropped from the running order and the active-race count rather than keeping a slot.
5. Run `npm run reconcile:season` to pick up anything now scoreable.

You do **not** re-order the JSON entries by hand. `loadCalendar` sorts every consumer's view by `date` (falling back to `originalDate`, with any date-less race sorted last and ties broken by `round`), so a rescheduled race moves to its correct place automatically — the dashboard "next race", the schedule grid, and the scoreboard all follow from `date`, not the file order.

Meeting lookup is deliberately strict about this: OpenF1 meetings more than ten days from the calendar date are rejected with an error naming the closest candidate, rather than being accepted as the nearest match. That is what stops the October Bahrain race being scored against the April meeting that never ran.

## Why This Level Is Enough

The workflow only gates batch publication. There are no concurrent operators, no long-running jobs that need orchestration, and no user-driven branching beyond “reviewed or not reviewed”. A small deterministic state model gives the important benefits:

- dashboard status is derived consistently instead of inferred ad hoc from files
- `score:race` can fail closed before publication if fine review is incomplete
- tests can assert allowed transitions directly

The main pitfall to avoid is over-modeling. A state machine library would add ceremony without reducing real complexity because the process still collapses to one command and a handful of persisted artifacts.

## When to Revisit This

Revisit the design if any of these become true:

- Martin delegates race review to multiple admins
- race corrections need approval history or manual overrides
- publication moves from local scripts to queued background jobs
- transfer windows and end-of-season bonuses become staged workflows instead of one-off calculations

At that point, persisting state transitions explicitly in a database may be worth it. For the current Monday batch model, the lightweight internal state machine is the right tradeoff.

## Seat Substitutions

Fantasy driver picks follow a team seat rather than a permanent driver name.
The baseline seat roster comes from Martin's Race 1 results table (including
Hadjar at Red Bull and Lawson at Racing Bulls), not stale calculator team labels.
It defines two stable seats per constructor. A race can set
`seatOccupants` on its calendar entry to replace a seat occupant independently
for `qualifying`, `sprint`, and `race`. An omitted session uses the inferred race
occupant when the lineup changed, or the roster owner when it did not.
For a single race-lineup change, the scorer infers the replacement by comparing
the normalized constructor lineup with the two seat owners. If both seats change
at once, it fails closed until the mapping is made explicit.

```json
"seatOccupants": {
  "mercedes:1": {
    "qualifying": "george-russell",
    "sprint": "reserve-driver-id",
    "race": "reserve-driver-id"
  }
}
```

The occupant id must exist in that race's normalized `drivers` data. A `null`
occupant fails scoring deliberately: the empty-seat interpretation remains
blocked on Martin and must not silently publish either zero or DNS points.
Constructor selections resolve the same two stable seats. A substitute therefore
inherits that seat's driver category and its designated 3x/2x constructor
weighting, while the published constructor artifact continues to list the actual
race lineup.
