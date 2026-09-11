## ADDED Requirements

### Requirement: Bounded autonomous runs

Agent mode SHALL be a third mode that is never entered implicitly and never persists across restarts. A run SHALL declare a maximum number of writes and a maximum duration, both required and bounded. Both SHALL be checked before each write, and exhausting either SHALL end the run with the reason recorded.

#### Scenario: Entering the mode

- **WHEN** the application starts
- **THEN** Agent mode is not active, whatever mode was last used

#### Scenario: Write budget spent

- **WHEN** a run reaches its write limit
- **THEN** it stops before the next write and records that the write budget ended it

#### Scenario: Time budget spent

- **WHEN** a run reaches its time limit
- **THEN** it stops before the next write and records that the time budget ended it

### Requirement: Standing permission is a named list

Agent mode SHALL permit only a named set of tools without approval. A tool outside that set SHALL require approval as it does in Assist. A capability classified as destructive SHALL never be in the set, and capability SHALL be revalidated immediately before each autonomous write.

#### Scenario: Unlisted tool during a run

- **WHEN** a live agent calls a tool outside the permitted set during a run
- **THEN** the call awaits approval rather than executing

#### Scenario: Capability lost mid-run

- **WHEN** the connected adapter stops reporting a capability a run is using
- **THEN** the write is refused and the run ends

### Requirement: A run stops immediately

A run SHALL end on an explicit stop, on the first failed write, on disconnect, and on a mode change. Stopping SHALL take effect before the next write rather than after the step in flight.

#### Scenario: Producer stops a run

- **WHEN** stop is pressed during a run
- **THEN** no further write is made and the run records that it was stopped

#### Scenario: A write fails

- **WHEN** an autonomous write fails
- **THEN** the run ends and records the failure as its reason

### Requirement: A run is undoable as a whole

A run SHALL capture session state before it begins and SHALL offer a single undo restoring that state, subject to the same state-revision conflict check as any other undo.

#### Scenario: Undo a finished run

- **WHEN** a producer undoes a completed run
- **THEN** the session returns to the state captured before the run began

#### Scenario: Session changed after the run

- **WHEN** the session has changed since the run finished
- **THEN** the undo is refused as a conflict rather than overwriting the newer state
