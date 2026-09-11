# cubase-bridge Specification

## Purpose

TBD - created by archiving change add-cubase-midi-bridge. Update Purpose after archive.

## Requirements

### Requirement: MIDI transport boundary

The bridge SHALL depend on a narrow MIDI transport interface providing port listing, open, close, send, and message subscription. An in-process loopback transport SHALL be provided for verification without hardware. The platform transport SHALL load its backend lazily and SHALL NOT be a required install dependency.

#### Scenario: No MIDI backend installed

- **WHEN** the platform transport is opened without an available MIDI backend
- **THEN** it returns a typed unavailable result naming the missing backend, and the application install, build, and mock paths remain unaffected

#### Scenario: Loopback verification

- **WHEN** the bridge runs against the loopback transport and a simulated Cubase peer
- **THEN** handshake, state reads, and writes complete over the real protocol without any hardware

### Requirement: Versioned SysEx bridge protocol

Requests and responses SHALL be framed as System Exclusive messages carrying a protocol version, message kind, correlation value, length, 7-bit encoded payload, and checksum. Payloads exceeding the ceiling SHALL be rejected before transmission. Responses SHALL echo the correlation value of their request.

#### Scenario: Corrupt frame

- **WHEN** a frame arrives with a failing checksum, an unknown kind, or a truncated payload
- **THEN** it is discarded and logged, no pending request is resolved, and no state is mutated

#### Scenario: Unmatched response

- **WHEN** a response arrives whose correlation value matches no pending request
- **THEN** it is discarded without resolving any other request

#### Scenario: Oversized payload

- **WHEN** an operation would encode beyond the payload ceiling
- **THEN** the request fails before transmission with a size error

### Requirement: Bounded request lifetime

Every bridge request SHALL have a timeout. On expiry the request SHALL fail, the bridge SHALL mark itself disconnected, and pending requests SHALL be rejected rather than left outstanding.

#### Scenario: Silent Cubase

- **WHEN** the driver script stops responding mid-session
- **THEN** the in-flight request fails with a timeout, the bridge reports disconnected, and a subsequent write is refused rather than queued

#### Scenario: Lost write response

- **WHEN** a write is sent and its response never arrives
- **THEN** the operation is reported as failed or unknown and is never reported as applied

### Requirement: Capability handshake

On connect the bridge SHALL exchange protocol versions and receive the connected Cubase version and the operation ids the driver script implements. A protocol version mismatch SHALL fail the connection with a message naming both versions. Reported capabilities SHALL come from the handshake rather than a static list.

#### Scenario: Version mismatch

- **WHEN** the driver script reports an incompatible protocol version
- **THEN** the connection fails with both versions named and no session is established

#### Scenario: Partial capability set

- **WHEN** the driver script reports transport support but not tempo support
- **THEN** tempo tools are not exposed to agents and a direct tempo call is refused

### Requirement: Live Cubase adapter

A Cubase bridge adapter SHALL implement the shared DAW adapter contract for connect, disconnect, capability report, project state read, and tempo and transport execution against the connected session. Project state SHALL report that it is not mock state and SHALL carry a revision that advances on every applied write.

#### Scenario: Tempo round trip

- **WHEN** an approved tempo write executes over a connected bridge
- **THEN** the live session tempo changes, the returned state reflects the new tempo, and the revision advances

#### Scenario: Disconnected bridge

- **WHEN** an operation is invoked after the bridge disconnects
- **THEN** it returns a disconnected error and mutates nothing

### Requirement: Distributable driver script

The repository SHALL ship the Cubase MIDI Remote driver script implementing the bridge protocol, and SHALL document its installation location, port pairing, and the Cubase versions it targets. The script's protocol encoding and decoding logic SHALL be verified independently of Cubase.

#### Scenario: Protocol parity

- **WHEN** the driver script's encoder and decoder are exercised against the host protocol implementation
- **THEN** frames produced by each side decode correctly on the other

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
