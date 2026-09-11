# music-orchestration Specification

## Purpose

TBD - created by archiving change setup-orchestrai-desktop. Update Purpose after archive.

## Requirements

### Requirement: Capability-filtered validated music tools

The tool registry SHALL expose tools filtered by mode and by the connected adapter's reported capabilities, and SHALL additionally expose local read-only sample tools that do not require a DAW connection. Sample search SHALL accept musical filters — key and tempo range — alongside text, validated like every other tool input. Capability SHALL be revalidated immediately before execution, after any approval.

#### Scenario: Musical filters are validated

- **WHEN** a search is requested with a key that is not a note name
- **THEN** it is refused before searching

#### Scenario: Capability lost between approval and execution

- **WHEN** an approved write is executed after the connected adapter stops reporting that capability
- **THEN** execution is refused and the outcome is recorded as failed

### Requirement: One permission enforcement path

Every tool invocation SHALL record the agent session that made it, whether it originated locally or from an external agent process, and SHALL pass through the same validation, capability and mode filtering, permission engine, transaction record, and Undo eligibility.

#### Scenario: Mixed origins in one conversation

- **WHEN** a conversation contains calls from the Demo provider and from a live agent
- **THEN** each activity records its originating session and both required approval for writes

### Requirement: Bound approval lifecycle

Every write SHALL bind its arguments, session, and agent to a single approval that expires, is consumed once, and is invalidated by cancellation, mode change, disconnect, or restart. A write addressing a single track SHALL bind the track it names, so an approval cannot be applied to a different track.

#### Scenario: Approval names its track

- **WHEN** a track volume change is approved
- **THEN** the change is applied to the track the request named and to no other

#### Scenario: Track disappears before execution

- **WHEN** an approved track write executes after that track is no longer reported
- **THEN** execution is refused and the outcome is recorded as failed

### Requirement: Local MCP process

The application SHALL start a supervised MCP-compatible stdio server in a separate local process, complete protocol initialization, and expose registry tools through standard list/call operations. Stdout SHALL contain protocol traffic only. No network listener SHALL be needed.

#### Scenario: MCP initialization and read

- **WHEN** the desktop MCP client initializes, lists tools, and calls project.get_tempo in a connected mock session
- **THEN** the protocol returns valid tool definitions and a schema-valid tempo result

#### Scenario: MCP write awaiting approval

- **WHEN** an MCP caller requests an allowed write without user approval
- **THEN** it receives a pending operation identifier and the application presents approval without executing the write

### Requirement: Durable transactions and honest undo

Every invocation SHALL be recorded with its terminal outcome. Writes that mutate the DAW SHALL be undoable through a state-revision check. A write whose effect is a generated file SHALL be recorded in the same way and SHALL report that it produced an artifact rather than a session change, since there is no session state to restore.

#### Scenario: Generated clip is recorded

- **WHEN** a clip generation is approved and completes
- **THEN** the transaction records the artifact it produced and does not offer to undo a session change

#### Scenario: DAW write remains undoable

- **WHEN** an approved tempo change completes
- **THEN** it remains undoable through the existing revision check

### Requirement: Bounded autonomous runs

Agent mode SHALL be a third mode that is never entered implicitly and never persists across restarts. A run SHALL declare a maximum number of writes and a maximum duration, both required and bounded. Both SHALL be checked before each write, and exhausting either SHALL end the run with the reason recorded.

#### Scenario: Entering the mode

- **WHEN** the application starts
- **THEN** Agent mode is not active, whatever mode was last used

#### Scenario: Write budget spent

- **WHEN** a run reaches its write limit
- **THEN** it stops before the next write and records that the write budget ended it

#### Scenario: Time budget spent

- **WHEN** a run reaches its time limit
- **THEN** it stops before the next write and records that the time budget ended it

### Requirement: Standing permission is a named list

Agent mode SHALL permit only a named set of tools without approval. A tool outside that set SHALL require approval as it does in Assist. A capability classified as destructive SHALL never be in the set, and capability SHALL be revalidated immediately before each autonomous write.

#### Scenario: Unlisted tool during a run

- **WHEN** a live agent calls a tool outside the permitted set during a run
- **THEN** the call awaits approval rather than executing

#### Scenario: Capability lost mid-run

- **WHEN** the connected adapter stops reporting a capability a run is using
- **THEN** the write is refused and the run ends

### Requirement: A run stops immediately

A run SHALL end on an explicit stop, on the first failed write, on disconnect, and on a mode change. Stopping SHALL take effect before the next write rather than after the step in flight.

#### Scenario: Producer stops a run

- **WHEN** stop is pressed during a run
- **THEN** no further write is made and the run records that it was stopped

#### Scenario: A write fails

- **WHEN** an autonomous write fails
- **THEN** the run ends and records the failure as its reason

### Requirement: A run is undoable as a whole

A run SHALL capture session state before it begins and SHALL offer a single undo restoring that state, subject to the same state-revision conflict check as any other undo.

#### Scenario: Undo a finished run

- **WHEN** a producer undoes a completed run
- **THEN** the session returns to the state captured before the run began

#### Scenario: Session changed after the run

- **WHEN** the session has changed since the run finished
- **THEN** the undo is refused as a conflict rather than overwriting the newer state

### Requirement: The standing list is the disclosure

Agent mode's standing list SHALL contain only reversible session changes — tempo, transport, and track volume, mute, and solo — and plugin writes SHALL NOT be on it. The interface's pre-run disclosure SHALL be rendered from that list, so what is named cannot differ from what runs unattended.

#### Scenario: A plugin write during a run

- **WHEN** an agent asks for a plugin or quick control change during a run
- **THEN** it takes an approval like any other write

#### Scenario: Reading the disclosure

- **WHEN** a producer reads the pre-run banner
- **THEN** it names exactly the tools that will run without approval

### Requirement: Undoing a run restores plugin state

Undoing a run SHALL restore the plugin bypass state and quick control values captured before the run, alongside tempo, transport, and track levels.

#### Scenario: A run that moved a quick control

- **WHEN** a run changed a quick control and the producer undoes the run
- **THEN** the quick control is restored to its value before the run
