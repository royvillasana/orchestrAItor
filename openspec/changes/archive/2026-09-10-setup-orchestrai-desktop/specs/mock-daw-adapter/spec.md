## ADDED Requirements

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

The mock SHALL support project state read, tempo read/set from 20 through 300 BPM, and transport play/stop. It SHALL advertise plugin control, track creation, and MIDI insertion as unsupported and SHALL report successful outcomes only after state mutation.

#### Scenario: Tempo round trip

- **WHEN** an approved command sets mock tempo to 124
- **THEN** subsequent tempo and project-state reads both return 124

#### Scenario: Transport round trip

- **WHEN** approved play and stop commands run sequentially
- **THEN** state becomes playing and then stopped with matching operation results

#### Scenario: Unsupported plugin operation

- **WHEN** plugin insertion is requested
- **THEN** the adapter returns unsupported and no mock success is fabricated
