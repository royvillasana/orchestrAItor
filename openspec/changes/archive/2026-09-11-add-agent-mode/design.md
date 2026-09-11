## Context

Every write in this project has been guarded by a prompt immediately before it. Agent mode removes that prompt, which means the guarantee has to come from somewhere else. Everything below is about where.

## Decisions

### A run, not a setting

Agent mode is entered per run, with budgets, and ends. It is not a preference that persists across restarts. A mode whose purpose is acting without asking is exactly the mode nobody should be able to leave switched on and forget — the producer who opens the application a week later must not find it already permitted.

### The budget is the guarantee

A run declares how many writes it may make and how long it may take. Both are checked before each write, not after, and exhausting either ends the run with the reason stated. This is a bound a producer can reason about before granting it: "eight changes, two minutes" is a sentence with a worst case.

### A standing list, not a blanket

Agent mode grants the tools on a named list — tempo, transport, track level, mute, solo — and nothing else. Anything outside it still takes an approval, in Agent mode exactly as in Assist. Destructive-risk capabilities are never on the list, and the registry's existing risk classification is what decides that, so a future destructive tool is excluded by default rather than by remembering to exclude it.

### Stop means now

Stop is checked before each write and the run ends at that point. A run that finished its current step first would be a stop control that lies by one operation, and one operation is the entire unit of harm here.

### Undo the run, not the writes

A run captures session state before it starts and offers a single undo that restores it, under the same revision check every other undo uses. Undoing writes one at a time would ask a producer to reason about ordering they never saw; the run is the thing they authorised, so the run is the thing they can take back.

### Failure stops everything

The first failed write ends the run. An autonomous sequence that continues past a failure is guessing about a session whose state it no longer knows, and the producer is not watching closely enough to catch it.

## Risks / Trade-offs

This is the only path in the project where the session changes without a prompt immediately before the change. The budget, the tool list, and the stop control are the replacement, and they are weaker than a prompt in one specific way: they are granted in advance, on a prediction of what the run will do.

Time budgets are wall-clock, so a slow model turn spends the run's time without spending its writes. That is the honest behaviour — the producer asked for a bounded duration — but it means a run can end having done less than expected.

## Migration Plan

Additive. Ask and Assist are unchanged, Agent mode must be chosen, and a session that never enters it behaves exactly as before.
