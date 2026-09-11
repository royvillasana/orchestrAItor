## ADDED Requirements

### Requirement: The fixture carries the expanded channel surface

The mock SHALL report pan, record arm, monitor, and selection per track, a selected-track surface with EQ bands, sends, inserts and automation arm, and a bank window over its fixture tracks. It SHALL accept the same writes as the bridge and refuse them in the same cases, so the demo session teaches what the live one does.

#### Scenario: Paging the fixture

- **WHEN** the bank is paged in the mock session
- **THEN** a different window of fixture tracks is reported

#### Scenario: A host command in the mock

- **WHEN** an allowlisted command runs against the mock
- **THEN** it is recorded as run without claiming a project was saved to disk
