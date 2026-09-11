## Why

Every write took an approval, transport included. But playing is not a write to the project: nothing is saved, nothing is lost, and pressing stop is its own undo. Asking a producer to approve "play" is asking them to approve listening — the prompt costs a click, teaches them to approve without reading, and protects nothing.

It also breaks the one interaction a producer performs constantly. Press play, hear it, press stop. An approval between the intent and the sound is the wrong place for a permission model to make itself felt.

## What Changes

- Play and stop run directly, in every mode, including Ask. They are still recorded as activities, still refused when no session is connected, and still offer the undo they always did.
- Ask mode exposes them, since a mode that "cannot change the project" is not describing the playhead.
- Undoing a transport change runs the same way, because it is itself a transport change.
- The mode label and the README say this rather than promising an approval that no longer happens.

Out of scope: any other write. Tempo, levels, plugin writes, and clip generation are unchanged.

## Capabilities

### Modified Capabilities

- **music-orchestration**: which tools take approval.
