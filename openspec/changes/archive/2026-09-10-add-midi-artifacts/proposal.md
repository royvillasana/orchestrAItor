## Why

The assistant can read a session, change its tempo, drive transport, and find the producer's own sounds. It cannot yet make anything. Asked for a chord progression it can only describe one in prose, which is the least useful form a musical idea can take.

This implements the reserved `music-engine`: the agent generates real musical material — chord progressions, basslines, drum patterns — in the session's key and tempo, written as standard MIDI files the producer drags into Cubase.

## What Changes

- Implement a music theory core: keys and scales, diatonic chords from roman numerals, voicings, bass and drum patterns, all deterministic from an explicit seed.
- Write standard MIDI files directly, with no dependency: header and track chunks, variable-length quantities, tempo and time signature meta events, and note on/off pairs.
- Add `midi.create_clip` as a write tool. It requires approval like every other write, records the arguments that produced it, and never overwrites an existing artifact.
- Store generated clips under the application data directory with a row per artifact, and migrate the database from schema 2 to 3.
- List artifacts in the workspace with their musical summary, reveal them in the file manager, and let the producer drag one straight into Cubase.
- State plainly that a clip is a file to drop in, not something inserted into the project.

Out of scope: audio rendering or playback of generated MIDI, arrangement across multiple tracks, melody generation beyond scale-constrained lines, importing MIDI, and inserting clips into the project automatically.

## Capabilities

### New Capabilities

- `midi-artifacts`: Music theory, MIDI file writing, generation tools, artifact storage, and hand-off to the DAW.

### Modified Capabilities

- `music-orchestration`: A write tool whose effect is a file rather than a DAW mutation, with the same approval path.
- `production-workspace`: Artifact listing, musical summary, reveal, and drag-out.
- `desktop-foundation`: Schema migration 003 and artifact storage under application data.

## Impact

Implements `packages/music-engine`, which has no dependencies: the MIDI writer emits bytes directly. Generation is local and deterministic — the same request and seed produces the same file — and nothing is uploaded. Artifacts are written under the application data directory, never into the producer's project folders, and a clip is never deleted or overwritten by generation.

Cubase's MIDI Remote API controls a surface; it cannot create parts in a project. So a generated clip is handed over as a file the producer drops onto a track, and the interface says so rather than implying the session changed.
