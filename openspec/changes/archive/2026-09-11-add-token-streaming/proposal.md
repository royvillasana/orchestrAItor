## Why

A reply currently appears a paragraph at a time: the provider emits text when the CLI finishes a content block, so a long answer sits invisible for seconds and then lands whole. The shimmer covers the wait, but the wait is the part worth removing.

Claude Code can emit the text as it is produced. This forwards that.

## What Changes

- Ask Claude Code for partial messages and read its text deltas, so the transcript fills in as the model writes.
- Move assembly into the provider: it emits the text so far rather than a fragment, so no consumer has to know whether a CLI streams tokens, blocks, or one lump at the end.
- Keep the persisted message exactly as it is — written once, at the end of the turn, from the completed blocks rather than from the display buffer.
- Leave Codex on block-level streaming, which is what its event stream offers, with no difference in how the transcript behaves.

Out of scope: streaming tool-call arguments, partial persistence, and resuming a stream after a crash.

## Capabilities

### Modified Capabilities

- `live-agent-sessions`: Text arrives as it is produced where the CLI supports it, and assembly belongs to the provider.

## Impact

Display only. The persisted transcript, the permission path, and every approval remain unchanged, so a crash mid-stream still cannot leave half a reply in history.
