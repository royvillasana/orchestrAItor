## MODIFIED Requirements

### Requirement: Stateful bounded mock operations

The mock SHALL support project state read, tempo read/set from 20 through 300 BPM, transport play/stop, and per-track volume, mute, and solo, with volume expressed as a normalized fader position from 0 to 1. It SHALL advertise plugin control, track creation, and MIDI insertion as unsupported and SHALL report successful outcomes only after state mutation.

#### Scenario: Track level round trip

- **WHEN** a track volume is set on the mock
- **THEN** the mock reports that track at the new normalized level

#### Scenario: Out-of-range level

- **WHEN** a track volume outside 0 to 1 is requested
- **THEN** it is refused and no track changes
