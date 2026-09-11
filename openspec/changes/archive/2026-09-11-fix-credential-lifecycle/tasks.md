## 1. Credential lifecycle

- [x] 1.1 Resolve the key per request rather than capturing it at construction.
- [x] 1.2 Rebuild the session when the active provider's key is replaced.
- [x] 1.3 Cancel the turn in flight and fall back when a key is removed.
- [x] 1.4 Attribute a stored answer to the provider that ran the turn.
- [x] 1.5 Report the credential store's quality before a key is typed, and refuse a backend that only obfuscates.

## 2. Turn safety

- [x] 2.1 Stop a cancelled turn before its next tool call.
- [x] 2.2 Give the turn a deadline and report a timeout as one.
- [x] 2.3 Report a cancelled turn as cancelled rather than as an error.

## 3. Disclosure and undo

- [x] 3.1 Remove the plugin write from Agent mode's standing list.
- [x] 3.2 Render the pre-run disclosure from the standing list.
- [x] 3.3 Restore plugin bypass and quick controls when a run is undone.
- [x] 3.4 Scope streamed text to its conversation and keep its paragraph breaks.

## 4. Acceptance

- [x] 4.1 Cover each fix with a test that fails without it. The one exception is the attribution guard (1.4): once removal cancels the turn, no reachable path switches the provider mid-turn, so it is a defence with no test to fail — noted here rather than claimed as covered.
- [x] 4.2 Run typecheck, lint, formatting, tests, build, and every smoke workflow.
- [x] 4.3 Reconcile the README with what the code now does.
