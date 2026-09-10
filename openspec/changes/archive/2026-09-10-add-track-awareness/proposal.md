## Why

A live session reports its tempo and transport and nothing else, so the workspace shows `TRACKS 0` while a producer looks at a project full of them. The assistant can talk about the session's speed but not about its contents: asked which track is loudest, or to pull the drums down, it has nothing to work with.

Cubase's MIDI Remote API exposes a mixer bank of channels with their names, volume, pan, mute, and solo. This reads them, and lets an approved write touch one track rather than the whole session.

## What Changes

- Read the connected session's channels — name, kind, volume, pan, mute, solo — through a mixer bank zone in the driver script, and report them as the project's tracks.
- Define track volume as the fader position the DAW reports, normalized from 0 to 1, rather than a decibel figure this project would have to invent.
- Add `track.set_volume`, `track.set_mute`, and `track.set_solo` as normalized write tools addressing one track by id, each requiring approval and each undoable through the existing revision check.
- Implement the same tools in the mock adapter, so the demo path exercises them without Cubase.
- Show tracks in the workspace with their level, mute, and solo state, and keep the count honest when a session has none.

Out of scope: creating, deleting, renaming, or reordering tracks; sends, inserts, EQ, and quick controls; automation; and channels beyond the first bank.

## Capabilities

### Modified Capabilities

- `cubase-bridge`: The handshake reports track capabilities, and the driver script reads a mixer bank and applies track writes.
- `mock-daw-adapter`: Fixture tracks gain the same operations, with volume normalized like the bridge reports it.
- `music-orchestration`: Track writes are approved, revalidated, and undoable per track.
- `production-workspace`: The track list reflects the connected session.

## Impact

Track state arrives through the existing bridge protocol, so no new channel is introduced. Volume changes meaning across the project — from a decibel figure in the mock fixture to the normalized fader position a DAW actually reports — which is a contract change to `ProjectState` and is applied to the mock at the same time so both adapters agree.

A track write reaches one channel of the producer's live session. It takes the same approval as a tempo change, is recorded as a transaction, and is undoable through the same revision check.
