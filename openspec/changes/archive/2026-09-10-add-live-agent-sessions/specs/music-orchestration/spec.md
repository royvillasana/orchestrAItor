## MODIFIED Requirements

### Requirement: One permission enforcement path

Every tool invocation SHALL record the agent session that made it, whether it originated locally or from an external agent process, and SHALL pass through the same validation, capability and mode filtering, permission engine, transaction record, and Undo eligibility.

#### Scenario: Mixed origins in one conversation

- **WHEN** a conversation contains calls from the Demo provider and from a live agent
- **THEN** each activity records its originating session and both required approval for writes
