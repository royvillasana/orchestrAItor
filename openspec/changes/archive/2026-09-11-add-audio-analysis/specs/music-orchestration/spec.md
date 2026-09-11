## MODIFIED Requirements

### Requirement: Capability-filtered validated music tools

The tool registry SHALL expose tools filtered by mode and by the connected adapter's reported capabilities, and SHALL additionally expose local read-only sample tools that do not require a DAW connection. Sample search SHALL accept musical filters — key and tempo range — alongside text, validated like every other tool input. Capability SHALL be revalidated immediately before execution, after any approval.

#### Scenario: Musical filters are validated

- **WHEN** a search is requested with a key that is not a note name
- **THEN** it is refused before searching

#### Scenario: Capability lost between approval and execution

- **WHEN** an approved write is executed after the connected adapter stops reporting that capability
- **THEN** execution is refused and the outcome is recorded as failed
