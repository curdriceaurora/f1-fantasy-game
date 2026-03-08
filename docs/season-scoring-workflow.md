# Season Scoring Workflow

## Why a State Machine Helps

The scoring pipeline has a small number of meaningful lifecycle states and one high-cost failure mode: publishing Monday standings before the race weekend has actually been reviewed for steward outcomes and FIA fines. That makes an explicit state model useful.

What matters here is not a full workflow framework. The domain is small enough that a lightweight state model in code is easier to maintain than introducing XState or another runtime dependency.

The current internal lifecycle is:

- `scheduled`: the Monday publication window has not opened yet
- `awaiting_fine_review`: Monday scoring time has arrived, but nobody has explicitly confirmed the fine ledger for that race
- `ready_to_score`: the race is eligible for Monday scoring
- `finalized`: normalized race data and scored outputs both exist

This is implemented in [race-workflow.js](../lib/race-workflow.js).

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
