## ADDED Requirements

### Requirement: Capability-filtered validated music tools

The registry SHALL define typed runtime-validated inputs/outputs and risk metadata for project.get_state, project.get_tempo, project.set_tempo, transport.play, and transport.stop. It SHALL advertise only tools allowed by current adapter capabilities and session mode and recheck these before execution.

#### Scenario: Unsupported or stale tool

- **WHEN** a caller requests an unregistered tool or a previously available tool after disconnect
- **THEN** the orchestrator returns a structured error without adapter execution

#### Scenario: Invalid tempo

- **WHEN** a tempo request is non-finite, not numeric, or outside the mock range of 20 through 300 BPM
- **THEN** schema validation rejects it before adapter execution

### Requirement: One permission enforcement path

All agent, desktop, and MCP music operations MUST pass through the same orchestrator permission engine. Ask SHALL permit reads and reject writes. Assist SHALL execute reads immediately and require explicit user approval for each write. Destructive requests SHALL always require approval if registered later.

#### Scenario: Ask mode write attempt

- **WHEN** a caller invokes project.set_tempo in Ask
- **THEN** the operation is denied and project state remains unchanged

#### Scenario: Assist approval

- **WHEN** a user approves an Assist tempo request
- **THEN** exactly the displayed tool and immutable arguments execute once and update visible state

### Requirement: Bound approval lifecycle

Approval SHALL be bound to request, arguments, agent, and session; expire after five minutes; be usable once; and be invalidated by cancellation, disconnect, restart, or mode change. Only the trusted application control channel SHALL submit user approval decisions. Writes SHALL be serialized and revalidated before execution.

#### Scenario: Replayed or expired approval

- **WHEN** a caller reuses an approval or submits it after expiry or session change
- **THEN** no write executes and the activity records the rejection

#### Scenario: Denied proposal

- **WHEN** the user denies or cancels a pending proposal
- **THEN** it reaches a terminal denied or cancelled state without changing the adapter

### Requirement: Local MCP process

The application SHALL start a supervised MCP-compatible stdio server in a separate local process, complete protocol initialization, and expose registry tools through standard list/call operations. Stdout SHALL contain protocol traffic only. No network listener SHALL be needed.

#### Scenario: MCP initialization and read

- **WHEN** the desktop MCP client initializes, lists tools, and calls project.get_tempo in a connected mock session
- **THEN** the protocol returns valid tool definitions and a schema-valid tempo result

#### Scenario: MCP write awaiting approval

- **WHEN** an MCP caller requests an allowed write without user approval
- **THEN** it receives a pending operation identifier and the application presents approval without executing the write

### Requirement: Durable transactions and honest undo

Every invocation SHALL produce a correlated transaction/activity record including failed, rejected, and read operations. Write intent MUST be persisted before execution. Successful reversible mock writes SHALL expose permission-controlled Undo using a prior-state snapshot and revision check.

#### Scenario: Persistence unavailable

- **WHEN** a write intent cannot be persisted
- **THEN** the write is not executed and an error is shown

#### Scenario: Undo conflicts

- **WHEN** Undo is requested after another write has changed the expected state revision
- **THEN** the operation reports a conflict without overwriting newer state

#### Scenario: Restart with incomplete transaction

- **WHEN** startup finds an invocation with no terminal outcome
- **THEN** it records interruption or unknown outcome and does not replay the command
