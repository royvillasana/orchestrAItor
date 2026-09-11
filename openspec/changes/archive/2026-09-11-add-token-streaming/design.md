## Context

Claude Code emits `stream_event` frames carrying `content_block_delta` with a `text_delta` when asked for partial messages. It also emits the completed `assistant` message afterwards, so the same text arrives twice by two routes.

## Decisions

### The provider assembles, the consumer displays

Until now the provider emitted a fragment and the runtime concatenated fragments with a blank line between them, which was right for blocks and wrong for tokens. The provider now emits the text so far and the runtime assigns it. Whether a CLI streams per token, per block, or once at the end stops being anything the rest of the system knows about.

### Completed blocks remain the source of truth

The persisted message is still built from completed blocks. A display buffer assembled from deltas is the right thing to show and the wrong thing to store: it is exactly the state that a crash mid-turn would leave half-written, which is the case the current design already refuses.

### Duplicate text is dropped by comparison, not by mode

When a completed block repeats text already streamed, it is not appended again. Comparing what arrived is more robust than tracking whether partial mode is on: a CLI that streams some blocks and not others still reads correctly.

## Risks / Trade-offs

Partial messages make the CLI emit considerably more events. They are parsed and discarded cheaply, and an unknown event is already ignored rather than fatal.

## Migration Plan

Additive and display-only.
