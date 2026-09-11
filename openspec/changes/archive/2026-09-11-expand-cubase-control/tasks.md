## 1. Contracts

- [x] 1.1 Extend the track schema with pan, record arm, monitor, and selection.
- [x] 1.2 Add a selected-channel schema: EQ bands, sends, inserts, automation arm.
- [x] 1.3 Add a bank window to project state: offset, size, total, truncated.
- [x] 1.4 Add the new tool names, argument schemas, and the host command allowlist.

## 2. Driver script

- [x] 2.1 Bind pan, record arm, monitor and select per bank channel, reading from host callbacks.
- [x] 2.2 Bind the selected track's EQ bands, sends, inserts and automation arm.
- [x] 2.3 Bind the bank paging actions and report the window.
- [x] 2.4 Bind the allowlisted commands and refuse anything else.
- [x] 2.5 Extend the parity tests against the API stub for each of the above.

## 3. Adapters

- [x] 3.1 Carry the new operations over the bridge protocol.
- [x] 3.2 Give the mock the same surface, including a bank window over its fixture.
- [x] 3.3 Report capabilities so an adapter without a surface refuses rather than pretends.

## 4. Session

- [x] 4.1 Register the tools with argument schemas and risk classification.
- [x] 4.2 Classify host commands destructive and keep them off the standing list.
- [x] 4.3 Name the selected track in a command's approval request.
- [x] 4.4 Restore the expanded surface when a run is undone.

## 5. Interface

- [x] 5.1 Show pan, arm, monitor and selection in the track list.
- [x] 5.2 Show the selected track's EQ, sends and automation arm.
- [x] 5.3 Offer bank paging where the session is larger than the window.

## 6. Acceptance

- [x] 6.1 Unit tests for each new operation, refusal, and the allowlist.
- [x] 6.2 Live-bridge tests over real MIDI for the new operations.
- [x] 6.3 Run typecheck, lint, formatting, tests, build, and every smoke workflow.
- [x] 6.4 Document what is now reachable and what remains out of reach, and why.
