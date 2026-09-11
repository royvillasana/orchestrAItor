## ADDED Requirements

### Requirement: Plugin and quick control reporting

The bridge SHALL report each track's instrument plugin — whether one is loaded, its name, and its bypass state — and the quick controls the session exposes, with names and normalized values read from the host's callbacks rather than from values the script last wrote. A control the session has not mapped SHALL be reported as unmapped rather than as a nameless control.

#### Scenario: Track with an instrument

- **WHEN** a track carrying an instrument plugin is reported
- **THEN** the plugin's name, bypass state, and mapped quick controls appear with their values

#### Scenario: Track without an instrument

- **WHEN** an audio track with no instrument is reported
- **THEN** it reports no plugin rather than an empty one

#### Scenario: Producer remaps a quick control

- **WHEN** a quick control is reassigned in Cubase
- **THEN** the reported name and value follow what Cubase reports

### Requirement: Plugin writes through bound values

The bridge SHALL apply plugin bypass and quick control changes through surface values bound to the host, and SHALL refuse a write naming a track with no plugin or a quick control the session does not expose.

#### Scenario: Approved quick control change

- **WHEN** an approved quick control change executes
- **THEN** the mapped parameter moves in the connected session and the reported value follows

#### Scenario: Unmapped control

- **WHEN** a write names a quick control the session has not mapped
- **THEN** it is refused before anything is sent to Cubase
