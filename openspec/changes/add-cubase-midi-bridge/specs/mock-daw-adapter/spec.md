## ADDED Requirements

### Requirement: Explicit adapter selection

The application SHALL present the mock adapter and the live Cubase bridge as distinct, labeled selections. A failed or lost bridge connection SHALL NOT be substituted with the mock adapter.

#### Scenario: Bridge connection fails

- **WHEN** the user selects the Cubase bridge and the connection fails
- **THEN** the failure is shown, the session stays disconnected, and no mock session is started in its place

#### Scenario: Adapter identity is visible

- **WHEN** a session is connected
- **THEN** the interface states whether the connected adapter is the mock or a live Cubase session
