## Why

The bridge reaches a fraction of what the MIDI Remote API actually exposes. A producer can ask for tempo, transport, three fader values and eight quick controls — and nothing else, on the first sixteen channels only. Everything else in the mixer is invisible: pan, record arm, monitor, EQ, sends, inserts, automation. A session with twenty tracks simply ends at sixteen.

None of that was an API limit. Reading Cubase 15's own `midiremote_api_v1.d.ts` confirms the mixer bank can be paged (`mNextBank`, `mShiftLeft`), each channel carries record arm, monitor, select, pan and automation arm, and the selected track exposes four EQ bands, its send slots, and its insert slots. `makeCommandBinding` reaches Cubase's entire Key Commands list — save, record, undo, duplicate and remove tracks — which is how a control surface gets at structure it cannot address directly.

The ceiling is real but it is further out than where we stopped.

## What Changes

- **Page the mixer.** A bank action moves the sixteen-channel window, and the reported state says which channels it is showing. A session larger than the bank stops being a session with sixteen tracks.
- **Report and write the rest of a channel**: pan, record arm, monitor, and selection, alongside the volume, mute and solo already there.
- **Reach the selected track's depth**: four EQ bands (on, gain, frequency, Q), its send slots (on, level, pre/post), its insert slots (on, bypass), and its automation read/write arm. These live on the selected channel because that is where the API puts them, so changing them means selecting a track first — which is also how a producer describes the work.
- **Run an allowlisted Cubase command**, so save, record, undo, redo, duplicate and remove reach the session at all.

Commands are the dangerous part and are treated as such. They take no arguments and act on whatever is selected, so `host.run_command` is classified **destructive**, is never on Agent mode's standing list, and its approval card names the command and the track the session reports as selected. A command that opens a modal dialog is named as such rather than reported as done.

Out of scope, and stated so it is not implied: creating audio or instrument tracks (the command opens a dialog this API cannot answer), naming a track, exporting to a chosen path, editing MIDI or audio events, and placing generated content in the project. Those need an integration that is not a control surface.

## Capabilities

### Modified Capabilities

- **cubase-bridge**: what the driver script reports and writes.
- **mock-daw-adapter**: the same surface in the fixture, so the demo session stays honest.
- **music-orchestration**: the new tools, and the classification of host commands.
