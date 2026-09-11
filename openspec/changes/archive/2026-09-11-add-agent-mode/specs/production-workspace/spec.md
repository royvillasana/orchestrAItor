## ADDED Requirements

### Requirement: Agent mode is entered deliberately

The interface SHALL require an explicit choice to enter Agent mode, SHALL require its write and time budgets, and SHALL state plainly what it will do without asking before the run starts.

#### Scenario: Starting a run

- **WHEN** a producer enters Agent mode
- **THEN** they set a write limit and a time limit, and see which tools will run without approval

#### Scenario: Default mode

- **WHEN** the workspace opens
- **THEN** Agent mode is not selected

### Requirement: A run is visible and stoppable

While a run is active the interface SHALL show what it has done, what remains of each budget, and a stop control that is reachable at all times. A finished run SHALL show its outcome and its undo.

#### Scenario: During a run

- **WHEN** a run is making changes
- **THEN** each change appears as it happens with the remaining budget, and stop is available

#### Scenario: After a run

- **WHEN** a run ends
- **THEN** its outcome, the reason it ended, and an undo for the whole run are shown
