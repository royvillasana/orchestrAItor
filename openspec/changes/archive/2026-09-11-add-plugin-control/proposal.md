## Why

The assistant can change a track's level, mute, and solo — the mixer surface — but nothing inside the channel. A producer asking to open the filter on a bass, or to bypass a plugin that is doing too much, is asking about the instrument and its inserts, which the session does not report at all.

Cubase's MIDI Remote API exposes each channel's instrument plugin and its eight quick controls: the parameters a producer has already chosen to expose. That is the honest surface for plugin control — not arbitrary plugin parameters, but the ones the session says are worth reaching.

## What Changes

- Report each track's instrument plugin: whether a plugin is loaded, its name, and whether it is bypassed.
- Report the eight quick controls per track with their names and current values, read from the host's callbacks.
- Add `plugin.set_bypass` and `plugin.set_quick_control` as normalized write tools addressing one track, requiring approval like every other write.
- Implement both in the mock adapter so the demo path exercises them without Cubase.
- Show a track's plugin and its quick controls in the workspace, and say plainly when a track has no plugin rather than showing an empty grid.
- State that quick controls are what the session exposes, not every parameter a plugin has.

Out of scope: loading, removing, or replacing plugins; insert slots beyond the instrument; presets; plugin windows; and any parameter the session has not mapped to a quick control.

## Capabilities

### Modified Capabilities

- `cubase-bridge`: The handshake reports plugin capabilities, and the driver script reads plugin state and applies plugin writes.
- `mock-daw-adapter`: Fixture tracks gain a plugin and quick controls.
- `production-workspace`: The track view shows plugin state and quick controls.

## Impact

Plugin state travels through the existing bridge protocol, so no new channel appears. A plugin write reaches one channel of a live session and takes the same approval, transaction record, and undo as a fader move.

Quick controls are normalized 0 to 1, like track volume and for the same reason: the DAW reports a normalized value, and converting it into a plugin's own units would mean inventing a scale per plugin.
