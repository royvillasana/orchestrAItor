## Context

Cubase's MIDI Remote API is a control-surface API. It can move a fader, start transport, and set tempo; it cannot create a MIDI part in a project. That single fact decides the shape of this milestone: the assistant can produce musical material, but it cannot put it on a track. The honest delivery is a file the producer drops in.

## Decisions

### A file, and say so

A generated clip is a standard MIDI file under the application data directory, listed in the workspace with a drag handle and a reveal action. The interface says "drop it on a track", never "added to your project". Milestone 1 exists to keep the application from claiming effects it did not have, and this is the same rule applied to generation.

### No dependency for MIDI

Standard MIDI files are a small, stable format: a header chunk, a track chunk, variable-length delta times, a few meta events, and note on/off pairs. Writing the bytes directly is perhaps two hundred lines and removes a dependency from an offline application that already avoids them. It is also testable in the strongest way available — write a file, parse it back, and compare.

### Deterministic from a seed

Every generator takes an explicit seed and is pure. The same request produces the same file, the seed is recorded with the artifact, and a producer who liked a bassline can get it back. A random generator would make "give me another one" impossible to distinguish from "give me that one again".

### Theory rather than sampling

Chords come from scale degrees and roman numerals, not from a table of progressions. That keeps the output correct in any key the session reports and makes the tool explainable: a returned artifact can state "i - VI - III - VII in A minor" and mean it. Voicings are constrained to a playable range so the result reads as music rather than as pitch numbers.

### The write path is unchanged

`midi.create_clip` is a write capability. It is refused in Ask, requires approval in Assist, records a transaction, and reports what it produced. Writing a file is not a DAW mutation, so there is nothing to snapshot and nothing to undo into the session — the artifact simply exists, and removing it is the producer's action. That is stated rather than silently differing from other writes.

### Artifacts live in application data

Generated files go under the application data directory, never into the producer's project folders or sample libraries. Nothing generated overwrites anything: names are unique, and a repeated identical request produces a second artifact rather than replacing the first.

## Risks / Trade-offs

Generation is theory-driven, so it is correct rather than inspired: a diatonic progression in the right key with sensible voicings. It will not surprise anyone musically, and it should not be presented as though it might.

Drag-and-drop out of an Electron window into a DAW depends on the platform's drag protocol. It is implemented through the desktop process rather than the renderer, and reveal-in-file-manager remains as a path that always works.

## Migration Plan

Schema 2 upgrades to 3 by adding one table inside a transaction. The sample index, conversations, and transactions are untouched.
