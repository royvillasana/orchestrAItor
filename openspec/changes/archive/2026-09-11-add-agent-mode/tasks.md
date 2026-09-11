## 1. The mode and its budget

- [x] 1.1 Add Agent as a third mode, off by default, never entered without an explicit choice.
- [x] 1.2 Require a write budget and a time budget to start a run, validated and bounded.
- [x] 1.3 Track a run: its id, budgets, what it has spent, and why it ended.
- [x] 1.4 Test that a run cannot start without budgets and that exhausting either ends it with the reason.

## 2. Standing permission

- [x] 2.1 Keep a list of tools Agent mode may use without approval, excluding destructive-risk tools.
- [x] 2.2 Require approval for any tool outside that list, in Agent mode as in Assist.
- [x] 2.3 Revalidate capability before each autonomous write, as with an approved one.
- [x] 2.4 Test that an unlisted tool still prompts, that a destructive tool is never listed, and that capability loss stops a run.

## 3. Ending a run

- [x] 3.1 Stop on the first failed write, on disconnect, on mode change, and on explicit stop.
- [x] 3.2 Stop immediately rather than after the step in flight, and record what was in flight.
- [x] 3.3 Test each ending, including a stop issued mid-run.

## 4. Undo for a run

- [x] 4.1 Capture session state before a run begins.
- [x] 4.2 Offer Undo for the whole run, restoring that state under the existing revision check.
- [x] 4.3 Refuse the undo if the session changed after the run, as with any other conflict.
- [x] 4.4 Test undo after a run, and a conflicting undo.

## 5. Interface

- [x] 5.1 Enter Agent mode explicitly, with its budgets, and say plainly what it will do without asking.
- [x] 5.2 Show the run live: writes spent, time remaining, and what it has done.
- [x] 5.3 Keep a stop control reachable at all times during a run.
- [x] 5.4 Show the finished run with its outcome and its undo.

## 6. Acceptance

- [x] 6.1 Run typecheck, lint, formatting, unit and integration tests, production build, and every smoke workflow.
- [x] 6.2 Run a live agent in Agent mode against the bridge: several writes without prompts, a budget stop, and a run undo.
- [x] 6.3 Document what Agent mode does, its limits, and how a run is stopped and undone.
