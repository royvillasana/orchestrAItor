## 1. Reading plugin state

- [x] 1.1 Bind each channel's instrument plugin on and bypass values, and read them from host callbacks.
- [x] 1.2 Bind the eight quick controls per channel, reading their names and values from the host.
- [x] 1.3 Report plugin presence, name, bypass, and quick controls on each track.
- [x] 1.4 Test the glue against the Cubase-shaped stub, including a track with no plugin.

## 2. Plugin writes

- [x] 2.1 Add `plugin.set_bypass` and `plugin.set_quick_control` with validated arguments addressing one track.
- [x] 2.2 Implement both in the mock adapter and in the bridge through bound surface values.
- [x] 2.3 Refuse a write naming a track without a plugin, or a quick control index the session does not expose.
- [x] 2.4 Test approval, refusal in Ask, unknown track, missing plugin, and out-of-range index.

## 3. Interface

- [x] 3.1 Show a selected track's plugin, its bypass state, and its quick controls with names and values.
- [x] 3.2 Say plainly when a track has no plugin.

## 4. Acceptance

- [x] 4.1 Run typecheck, lint, formatting, tests, build, and every smoke workflow.
- [x] 4.2 Read plugin state over real MIDI and apply an approved quick control change.
- [x] 4.3 Document what plugin control covers and what it deliberately does not.
