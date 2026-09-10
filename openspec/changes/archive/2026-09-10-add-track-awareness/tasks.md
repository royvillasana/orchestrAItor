## 1. Reading tracks

- [x] 1.1 Build a mixer bank zone in the driver script covering audio, instrument, MIDI, group, and FX channels, bound to custom surface values.
- [x] 1.2 Capture channel name, volume, pan, mute, and solo from the host callbacks rather than from what the script last wrote.
- [x] 1.3 Report tracks in project state, ordered by channel, with a stable id per track.
- [x] 1.4 Test the mixer glue against the Cubase-shaped stub: bindings created, callbacks captured, and state reported.

## 2. Volume as reported

- [x] 2.1 Define track volume as the normalized fader position, and state it in the contract.
- [x] 2.2 Update the mock fixture to normalized volumes so both adapters agree.
- [x] 2.3 Test that a normalized value round trips through state and that out-of-range values are refused.

## 3. Track writes

- [x] 3.1 Add `track.set_volume`, `track.set_mute`, and `track.set_solo` with validated arguments addressing one track by id.
- [x] 3.2 Implement them in the mock adapter and in the bridge through bound surface values.
- [x] 3.3 Refuse a write naming a track the session does not have, before anything is sent.
- [x] 3.4 Test approval, refusal in Ask, unknown track ids, and undo after a track change.

## 4. Interface

- [x] 4.1 Show each track's level, mute, and solo state in the workspace.
- [x] 4.2 Keep an empty session honest rather than implying tracks failed to load.

## 5. Acceptance

- [x] 5.1 Run typecheck, lint, formatting, unit and integration tests, production build, and every smoke workflow.
- [x] 5.2 Read tracks over real MIDI from the simulated peer and apply an approved track write.
- [x] 5.3 Document track reading, the volume definition, and what remains out of scope in the README.
