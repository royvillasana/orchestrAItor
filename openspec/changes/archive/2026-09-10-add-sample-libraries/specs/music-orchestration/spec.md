## MODIFIED Requirements

### Requirement: Capability-filtered validated music tools

The tool registry SHALL expose tools filtered by the current mode and by the capabilities reported by the connected adapter, and SHALL additionally expose local read-only sample tools that do not depend on a DAW connection. Capability SHALL be revalidated immediately before execution, after any approval.

#### Scenario: Sample search without a DAW session

- **WHEN** no DAW adapter is connected
- **THEN** sample search remains available and DAW tools do not

#### Scenario: Capability lost between approval and execution

- **WHEN** an approved write is executed after the connected adapter stops reporting that capability
- **THEN** execution is refused and the outcome is recorded as failed
