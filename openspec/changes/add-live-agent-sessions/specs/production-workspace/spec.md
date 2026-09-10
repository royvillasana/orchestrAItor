## ADDED Requirements

### Requirement: Creative partner selection

Connection setup SHALL let the user choose Demo, Claude Code, or Codex, SHALL show installed, authenticated, and connected states per provider, SHALL offer verification, and SHALL explain why an unusable provider cannot be selected.

#### Scenario: Unauthenticated provider

- **WHEN** a discovered CLI is not signed in
- **THEN** it is shown as installed but not connectable, with the reason and the command that signs in

#### Scenario: Network disclosure before connecting

- **WHEN** a live provider is selected
- **THEN** the interface states that conversation content is sent to a model provider before the session is connected, and Demo remains the default

### Requirement: Live agent failure is recoverable

When a live agent session fails, the interface SHALL surface the reason, preserve history, keep the DAW session untouched, and require an explicit retry.

#### Scenario: Agent crashes mid-conversation

- **WHEN** the live CLI exits unexpectedly
- **THEN** the failure and its reason are shown, prior messages remain, and no automatic retry occurs
