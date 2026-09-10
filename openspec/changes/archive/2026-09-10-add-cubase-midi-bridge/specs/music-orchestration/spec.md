## MODIFIED Requirements

### Requirement: Capability-filtered validated music tools

The tool registry SHALL expose tools filtered by the current mode and by the capabilities reported by the connected adapter, including capabilities obtained from a live handshake. Capability SHALL be revalidated immediately before execution, after any approval.

#### Scenario: Capability lost between approval and execution

- **WHEN** an approved write is executed after the connected adapter stops reporting that capability
- **THEN** execution is refused and the outcome is recorded as failed

#### Scenario: Handshake governs exposure

- **WHEN** a live adapter reports a narrower capability set than the mock
- **THEN** only the reported operations are listed to agents and unreported operations are refused on direct call
