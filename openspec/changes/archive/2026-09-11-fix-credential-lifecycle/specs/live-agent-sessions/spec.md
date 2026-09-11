## ADDED Requirements

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
