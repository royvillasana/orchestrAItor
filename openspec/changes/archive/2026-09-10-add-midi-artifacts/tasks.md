## 1. Music theory

- [x] 1.1 Implement note and interval helpers, keys, and the common scales with correct enharmonic naming.
- [x] 1.2 Implement diatonic chord construction from roman numerals, including sevenths and inversions, with voicings that stay in a playable range.
- [x] 1.3 Implement deterministic bass lines and drum patterns from an explicit seed and a named style.
- [x] 1.4 Test scale and chord correctness against known music theory, voicing range, and determinism from a seed.

## 2. MIDI file writing

- [x] 2.1 Write standard MIDI files with header and track chunks, variable-length delta times, and end-of-track.
- [x] 2.2 Write tempo and time signature meta events matching the session.
- [x] 2.3 Emit note on/off pairs with correct ordering, channel, and velocity, and reject values outside MIDI range.
- [x] 2.4 Test round trips by parsing written files back, including multi-bar timing, and verify byte-level structure.

## 3. Generation tool

- [x] 3.1 Implement `midi.create_clip` with validated musical arguments, defaulting key and tempo from the connected session.
- [x] 3.2 Register it as a write capability requiring approval, refused in Ask like any other write.
- [x] 3.3 Write the file under application data with a unique name, never overwriting an existing artifact.
- [x] 3.4 Record the arguments, seed, and musical summary with the artifact so a clip can be explained and reproduced.
- [x] 3.5 Test approval refusal in Ask, uniqueness under repeated identical requests, and reproduction from a recorded seed.

## 4. Storage

- [x] 4.1 Add schema migration 003 for artifacts, upgrading an existing database without losing history or the sample index.
- [x] 4.2 Implement typed persistence for listing and removing artifacts.
- [x] 4.3 Test the upgrade, rollback, and that removing an artifact removes its file.

## 5. Interface and hand-off

- [x] 5.1 List artifacts with their musical summary, bar count, and creation time.
- [x] 5.2 Reveal an artifact in the file manager and let the producer drag it into the DAW.
- [x] 5.3 State that a clip is a file to drop in, not an insertion into the project.
- [x] 5.4 Test reveal and drag hand-off through the desktop boundary.

## 6. Acceptance

- [x] 6.1 Run typecheck, lint, formatting, unit and integration tests, production build, and every existing smoke workflow unchanged.
- [x] 6.2 Have a live agent generate a progression in the session's key, approve it, and confirm the written file parses as valid MIDI with the expected notes.
- [x] 6.3 Document generation, determinism, where artifacts live, and the hand-off limitation in the README.
