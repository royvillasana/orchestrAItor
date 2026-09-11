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
