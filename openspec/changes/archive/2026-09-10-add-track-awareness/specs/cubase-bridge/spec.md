## ADDED Requirements

### Requirement: Live track reporting

The bridge SHALL report the connected session's channels as tracks, with name, kind, normalized volume, pan, mute, and solo, read from the host's own callbacks rather than from values the script last wrote. Reporting SHALL cover a fixed bank of channels and SHALL state when a session has more channels than the bank shows.

#### Scenario: Session with tracks

- **WHEN** a live session containing named channels is connected
- **THEN** those channels appear as tracks with their names and current levels

#### Scenario: Producer moves a fader in Cubase

- **WHEN** a level is changed in Cubase rather than through the application
- **THEN** the reported track volume follows what Cubase reports

#### Scenario: Session larger than the bank

- **WHEN** a session has more channels than the bank covers
- **THEN** the reported tracks are stated to be the first bank rather than the whole project

### Requirement: Track writes through bound values

The bridge SHALL apply track volume, mute, and solo through surface values bound to the host's mixer values, and SHALL refuse a write naming a track that is not in the reported state.

#### Scenario: Approved level change

- **WHEN** an approved track volume change executes
- **THEN** that channel's fader moves in the connected session and the reported state follows

#### Scenario: Unknown track

- **WHEN** a write names a track id the session does not report
- **THEN** it is refused before anything is sent to Cubase
