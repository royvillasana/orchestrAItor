## MODIFIED Requirements

### Requirement: Durable local storage

Local storage SHALL apply schema migrations transactionally and preserve existing data across upgrades, including conversations, messages, tool calls, transactions, the sample index, and generated artifacts. A database at an unsupported future version SHALL be preserved and reported rather than modified.

#### Scenario: Upgrading to artifact storage

- **WHEN** an application holding schema 2 data starts with schema 3 support
- **THEN** the artifact table is added in a transaction and prior history and sample index remain readable

#### Scenario: Failed upgrade

- **WHEN** an upgrade fails partway
- **THEN** it rolls back and the database is left at its previous version
