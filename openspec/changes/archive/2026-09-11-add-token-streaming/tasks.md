## 1. Streaming

- [x] 1.1 Request partial messages from Claude Code and parse its text deltas.
- [x] 1.2 Assemble the running text inside the provider and emit the text so far.
- [x] 1.3 Avoid double counting when a completed block repeats text already streamed.
- [x] 1.4 Keep the persisted message built from completed blocks, not the display buffer.

## 2. Verification

- [x] 2.1 Test delta assembly, a block that repeats streamed text, and a CLI that streams only blocks.
- [x] 2.2 Observe a live turn arriving in more than one piece before it completes.
- [x] 2.3 Run typecheck, lint, formatting, tests, build, and the smoke workflows.
