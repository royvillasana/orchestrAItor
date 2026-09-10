## MODIFIED Requirements

### Requirement: Durable transactions and honest undo

Every invocation SHALL be recorded with its terminal outcome. Writes that mutate the DAW SHALL be undoable through a state-revision check. A write whose effect is a generated file SHALL be recorded in the same way and SHALL report that it produced an artifact rather than a session change, since there is no session state to restore.

#### Scenario: Generated clip is recorded

- **WHEN** a clip generation is approved and completes
- **THEN** the transaction records the artifact it produced and does not offer to undo a session change

#### Scenario: DAW write remains undoable

- **WHEN** an approved tempo change completes
- **THEN** it remains undoable through the existing revision check
