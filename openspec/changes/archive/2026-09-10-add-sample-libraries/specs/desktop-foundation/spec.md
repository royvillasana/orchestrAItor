## MODIFIED Requirements

### Requirement: Durable local storage

Local storage SHALL apply schema migrations transactionally, upgrading an existing version 1 database to version 2 without losing conversations, messages, tool calls, or transactions. A database at an unsupported future version SHALL be preserved and reported rather than modified.

#### Scenario: Upgrading an existing library

- **WHEN** an application holding schema 1 data starts with schema 2 support
- **THEN** the new tables are added in a transaction and prior history remains readable

#### Scenario: Failed upgrade

- **WHEN** the upgrade fails partway
- **THEN** it rolls back and the database is left at its previous version

### Requirement: Offline exported Next.js renderer

Every custom protocol SHALL resolve paths before serving, reject traversal and symlink escapes, and serve only from its permitted source: the exported renderer for application assets, and the sample index for sample media.

#### Scenario: Sample protocol asked for an application file

- **WHEN** the sample protocol is asked for a path that is not an indexed sample
- **THEN** it refuses
