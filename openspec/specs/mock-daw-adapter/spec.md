# mock-daw-adapter Specification

## Purpose

TBD - created by archiving change setup-orchestrai-desktop. Update Purpose after archive.

## Requirements

### Requirement: DAW-independent adapter contract

The shared contract SHALL define connect, disconnect, getCapabilities, getProjectState, and execute using normalized project, track, capability, command, and result schemas without Cubase-specific command names.

#### Scenario: Consumer uses normalized commands

- **WHEN** orchestration requests project.get_tempo
- **THEN** the adapter executes the normalized command without requiring a Cubase-specific API in the caller

### Requirement: Explicit mock project and lifecycle

The mock Cubase adapter SHALL expose its mock identity, deterministic fixture project/track state, connection state, and capabilities. Mock connection SHALL require no Cubase process, virtual MIDI, GUI automation, or network access.

#### Scenario: Mock connection

- **WHEN** the user connects Cubase 14 Mock
- **THEN** the fixture project appears with Mock labeling and supported tempo and transport capabilities

#### Scenario: Disconnected adapter

- **WHEN** an operation requiring a connection is invoked after disconnect
- **THEN** it returns a disconnected error and does not mutate state

### Requirement: Stateful bounded mock operations

The mock SHALL support project state read, tempo read/set from 20 through 300 BPM, transport play/stop, and per-track volume, mute, and solo, with volume expressed as a normalized fader position from 0 to 1. It SHALL advertise plugin control, track creation, and MIDI insertion as unsupported and SHALL report successful outcomes only after state mutation.

#### Scenario: Track level round trip

- **WHEN** a track volume is set on the mock
- **THEN** the mock reports that track at the new normalized level

#### Scenario: Out-of-range level

- **WHEN** a track volume outside 0 to 1 is requested
- **THEN** it is refused and no track changes

### Requirement: Explicit adapter selection

The application SHALL present the mock adapter and the live Cubase bridge as distinct, labeled selections. A failed or lost bridge connection SHALL NOT be substituted with the mock adapter.

#### Scenario: Bridge connection fails

- **WHEN** the user selects the Cubase bridge and the connection fails
- **THEN** the failure is shown, the session stays disconnected, and no mock session is started in its place

#### Scenario: Adapter identity is visible

- **WHEN** a session is connected
- **THEN** the interface states whether the connected adapter is the mock or a live Cubase session

### Requirement: Mock plugin state

The mock SHALL carry a plugin on at least one fixture track with named quick controls, SHALL support bypass and quick control writes with normalized values, and SHALL refuse those writes on a track without a plugin.

#### Scenario: Quick control round trip on the mock

- **WHEN** a quick control is set on a mock track carrying a plugin
- **THEN** the mock reports that control at the new value

#### Scenario: Track without a plugin

- **WHEN** a plugin write names a mock track with no plugin
- **THEN** it is refused and nothing changes

### Requirement: The fixture carries the expanded channel surface

The mock SHALL report pan, record arm, monitor, and selection per track, a selected-track surface with EQ bands, sends, inserts and automation arm, and a bank window over its fixture tracks. It SHALL accept the same writes as the bridge and refuse them in the same cases, so the demo session teaches what the live one does.

#### Scenario: Paging the fixture

- **WHEN** the bank is paged in the mock session
- **THEN** a different window of fixture tracks is reported

#### Scenario: A host command in the mock

- **WHEN** an allowlisted command runs against the mock
- **THEN** it is recorded as run without claiming a project was saved to disk
