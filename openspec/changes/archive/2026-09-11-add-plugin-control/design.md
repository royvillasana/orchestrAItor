## Context

A plugin has hundreds of parameters and the MIDI Remote API does not offer them. What it offers is the instrument slot's on, bypass and edit values, and eight quick controls per channel. Quick controls are not a limitation to work around: they are the parameters the producer already decided are worth reaching from a control surface.

## Decisions

### Quick controls are the surface

Control is limited to what the session exposes. Reaching arbitrary parameters would mean a plugin parameter database this project cannot maintain and cannot verify, and a wrong parameter moved on a producer's session is worse than a parameter that was never reachable. If a control is not mapped, the honest answer is that it is not mapped.

### Normalized, like everything else

Quick control values are 0 to 1, as the host reports them. A plugin's own units — hertz, decibels, milliseconds — differ per plugin and per parameter, and inventing a scale would repeat the decibel mistake track volume already taught.

### Names come from the host

A quick control's name is whatever Cubase reports for the mapped parameter, read from its title callback. A control with no name is reported as unmapped rather than as a nameless slot, so an agent is not tempted to move something nobody assigned.

### A plugin write is an ordinary write

Bypass and quick controls take the same approval, transaction, and undo as a tempo change. Nothing about being "inside" a channel makes these special, and treating them as a separate class would create a second permission path.

## Risks / Trade-offs

The eight-control limit will disappoint anyone expecting full plugin control. The alternative is guessing at parameter indices across plugins nobody here can test, which is how a session gets damaged quietly.

Quick control assignments change when a producer remaps them. State is read from the host on every report rather than cached, so a remap is reflected rather than remembered.

## Migration Plan

Additive. Tracks gain optional plugin fields; a session with no plugins reports none and behaves as before.
