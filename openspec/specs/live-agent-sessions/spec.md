# live-agent-sessions Specification

## Purpose

TBD - created by archiving change add-live-agent-sessions. Update Purpose after archive.

## Requirements

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

A live provider SHALL run its CLI non-interactively, parse its event stream into assistant output and tool activity, bound the number of turns, and return typed failures for unauthenticated, missing, crashed, timed-out, or unparseable CLI behavior. Unknown events SHALL be ignored rather than aborting a session. Where the CLI supports it, assistant text SHALL be reported as it is produced rather than only when a block completes, and the provider SHALL assemble the running text so consumers do not depend on how a given CLI divides its output. During an autonomous run the provider SHALL be told which tools it may use without approval, which still require it, and what remains of the run's budget.

#### Scenario: Text arrives as it is written

- **WHEN** a live agent produces a long reply on a CLI that streams partial messages
- **THEN** the transcript fills in as it is produced rather than after the reply completes

#### Scenario: A CLI that streams only whole blocks

- **WHEN** a CLI reports completed blocks rather than deltas
- **THEN** the transcript still fills in progressively and nothing is duplicated

#### Scenario: Persistence is unchanged

- **WHEN** a streamed turn completes
- **THEN** the stored message is written once from the completed output, not from the display buffer

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

### Requirement: A cancelled turn stops before its next write

Cancelling a turn SHALL stop it before the next tool call rather than after the round in progress, and SHALL be reported as a cancelled turn rather than as a failure.

#### Scenario: Cancelling a multi-call round

- **WHEN** a producer cancels while the first of several tool calls is executing
- **THEN** the remaining calls in that round are not made

#### Scenario: How a cancelled turn reads

- **WHEN** a turn is cancelled
- **THEN** the transcript reports it as cancelled, not as an error

### Requirement: A turn has a deadline

A turn SHALL end with a stated timeout if the provider does not respond within a bounded time, so a stalled connection cannot leave a session permanently mid-turn.

#### Scenario: A stalled connection

- **WHEN** a provider accepts the request and never responds
- **THEN** the turn ends with a timeout naming the bound, and the session accepts messages again

### Requirement: An answer is attributed to the provider that produced it

A stored message SHALL name the provider that ran the turn, even when the selected provider changed before the turn ended.

#### Scenario: The partner changes mid-turn

- **WHEN** the provider is switched while a turn is running
- **THEN** the stored answer names the provider that produced it

### Requirement: Streamed text matches the message it becomes

Text shown while a turn runs SHALL carry the same paragraph breaks as the message finally stored, SHALL show repeated words rather than suppressing them as already displayed, and SHALL appear only in the conversation that asked for it.

#### Scenario: Two blocks of text in one turn

- **WHEN** a provider emits text, calls a tool, and emits more text
- **THEN** the streamed text is broken into the same paragraphs as the stored message and does not reflow when the turn ends

#### Scenario: A repeated word

- **WHEN** a provider streams the same token twice in a row
- **THEN** both are shown

#### Scenario: Switching conversations mid-turn

- **WHEN** a producer opens another conversation while a turn is streaming
- **THEN** the partial text does not appear under the conversation that did not ask for it
