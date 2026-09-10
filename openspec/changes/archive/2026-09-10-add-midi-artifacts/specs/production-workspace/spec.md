## ADDED Requirements

### Requirement: Generated clips in the workspace

The workspace SHALL list generated clips with their musical summary, bar count, and creation time, SHALL allow revealing one in the file manager, and SHALL allow dragging one into the DAW.

#### Scenario: A clip appears after approval

- **WHEN** a clip generation is approved
- **THEN** the artifact appears in the workspace with its key, progression, and bars

#### Scenario: No clips yet

- **WHEN** no clip has been generated
- **THEN** the workspace explains that generated clips will appear there, rather than showing an empty list
