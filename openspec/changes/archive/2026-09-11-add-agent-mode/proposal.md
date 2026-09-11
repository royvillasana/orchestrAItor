## Why

Ask reads and Assist approves every write. For a producer iterating — "try 124, now try 126, mute the keys, bring them back" — approving each step is the whole interaction, and the assistant is a slower way to do what the mouse already does.

Agent mode lets a session run without a prompt per write, inside limits the producer sets before it starts.

## What Changes

- Add Agent as a third mode alongside Ask and Assist, off by default and never entered implicitly.
- Require a budget before a run: how many writes it may make and how long it may run. A run that exhausts either stops and says which.
- Keep a standing list of what Agent mode may do. Tools outside it still require approval; destructive-risk tools are never included.
- Record every autonomous write as a transaction with the run that made it, so the run is inspectable afterwards rather than only as it happens.
- Stop a run on the first failure, on disconnect, on mode change, and on an explicit stop, and stop it immediately rather than after the current step.
- Offer Undo for the run as a whole, restoring the session state captured before it began, subject to the same revision check as any other undo.
- Show the run as it happens: what it has done, what remains in its budget, and a stop control that is always reachable.

Out of scope: multi-step planning, agents starting runs on their own, runs that continue while the application is closed, and any relaxation of the Ask and Assist paths.

## Capabilities

### Modified Capabilities

- `music-orchestration`: A third mode, a run with a budget, standing permission for a named set of tools, and run-level undo.
- `production-workspace`: Entering Agent mode, its budget, live run state, and stopping.
- `live-agent-sessions`: A live agent is told what it may do without asking and what it still may not.

## Impact

This is the first time a write reaches the producer's session without a prompt immediately before it, so the safety moves from the prompt to the budget, the tool list, and the stop control. Ask and Assist are untouched: a producer who never enters Agent mode sees no change.

Agent mode requires an explicit choice per run, not a setting that stays on. A mode that persists across restarts would eventually surprise someone who forgot it was set, and this is a mode whose entire purpose is acting without asking.
