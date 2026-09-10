## ADDED Requirements

### Requirement: Explicit authentication verification

Verification SHALL be a user-initiated action that runs only the CLI's own authentication status command, with a timeout and bounded output. It SHALL report logged-in state, account identity where the CLI provides it, and the CLI version. Discovery SHALL continue to execute nothing.

#### Scenario: Signed in

- **WHEN** the user verifies an installed, signed-in CLI
- **THEN** the account identity and version are reported and the provider becomes connectable

#### Scenario: Signed out

- **WHEN** the CLI reports that it is not logged in
- **THEN** the provider is reported as installed but unauthenticated, is not connectable, and no session is started

#### Scenario: Unresponsive CLI

- **WHEN** the status command exceeds its timeout or returns unparseable output
- **THEN** verification fails with that reason and the provider stays unverified

### Requirement: Agent tool channel

The runtime SHALL expose tool listing and tool calls to an external agent process over a token-guarded local channel with owner-only permissions and bounded message sizes. The channel SHALL NOT expose approval decisions, adapter selection, provider selection, or persistence control.

#### Scenario: Untrusted caller

- **WHEN** a request arrives without the current session token
- **THEN** it is rejected and no tool is listed or executed

#### Scenario: Agent attempts to approve its own write

- **WHEN** an agent tries to reach an approval decision through the channel
- **THEN** no such operation exists on the channel and the pending write stays awaiting approval

#### Scenario: Oversized or malformed message

- **WHEN** a message exceeds the size bound or fails validation
- **THEN** it is rejected without executing a tool

### Requirement: External agent calls use the shared permission path

Tool calls arriving from an external agent process SHALL be validated, capability-filtered, mode-filtered, permission-checked, recorded, and undoable exactly as locally originated calls, and SHALL be attributed to the live agent session that made them.

#### Scenario: Live agent proposes a write in Assist

- **WHEN** a live agent calls a write tool in Assist mode
- **THEN** the call is recorded as awaiting approval, nothing reaches the DAW, and approval remains a desktop action

#### Scenario: Live agent calls a write in Ask

- **WHEN** a live agent calls a write tool in Ask mode
- **THEN** the call is refused and recorded as failed

### Requirement: Live provider sessions

A live provider SHALL run its CLI non-interactively, parse its event stream into assistant output and tool activity, bound the number of turns, and return typed failures for unauthenticated, missing, crashed, timed-out, or unparseable CLI behavior. Unknown events SHALL be ignored rather than aborting a session.

#### Scenario: Live answer with a tool call

- **WHEN** a live agent answers a request that needs project state
- **THEN** its tool call and its answer appear in the transcript attributed to that provider

#### Scenario: CLI fails mid-turn

- **WHEN** the CLI exits unexpectedly during a turn
- **THEN** the turn fails with the reason, history is preserved, and retrying is an explicit action

### Requirement: Cancellation stops the live session

Cancelling a live turn SHALL stop the CLI process and mark the turn cancelled. A cancelled turn SHALL NOT leave a write applied that was not approved.

#### Scenario: Cancel during a turn

- **WHEN** the user cancels a running live turn
- **THEN** the process is stopped, the turn is cancelled, and any pending write remains unapplied

### Requirement: Live agent confinement

A live agent SHALL run with an isolated working directory, only the OrchestrAI MCP server loaded, built-in file and shell tools denied, and only OrchestrAI tools allowed.

#### Scenario: Agent attempts a file or shell tool

- **WHEN** a live agent attempts a built-in file or shell tool
- **THEN** the tool is not available to it and the user's files are untouched

### Requirement: Live sessions are identified as live

Messages and activity SHALL record the provider and model that produced them. The Demo provider SHALL remain explicitly labeled, and demo output SHALL never be presented as live model output nor live output as demo output.

#### Scenario: Reading a transcript later

- **WHEN** a conversation containing both demo and live turns is reopened
- **THEN** each message states which provider produced it
