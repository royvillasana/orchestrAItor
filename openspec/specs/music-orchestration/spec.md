# music-orchestration Specification

## Purpose

TBD - created by archiving change setup-orchestrai-desktop. Update Purpose after archive.

## Requirements

### Requirement: Capability-filtered validated music tools

The tool registry SHALL expose tools filtered by the current mode and by the capabilities reported by the connected adapter, and SHALL additionally expose local read-only sample tools that do not depend on a DAW connection. Capability SHALL be revalidated immediately before execution, after any approval.

#### Scenario: Sample search without a DAW session

- **WHEN** no DAW adapter is connected
- **THEN** sample search remains available and DAW tools do not

#### Scenario: Capability lost between approval and execution

- **WHEN** an approved write is executed after the connected adapter stops reporting that capability
- **THEN** execution is refused and the outcome is recorded as failed

### Requirement: One permission enforcement path

Every tool invocation SHALL record the agent session that made it, whether it originated locally or from an external agent process, and SHALL pass through the same validation, capability and mode filtering, permission engine, transaction record, and Undo eligibility.

#### Scenario: Mixed origins in one conversation

- **WHEN** a conversation contains calls from the Demo provider and from a live agent
- **THEN** each activity records its originating session and both required approval for writes

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
