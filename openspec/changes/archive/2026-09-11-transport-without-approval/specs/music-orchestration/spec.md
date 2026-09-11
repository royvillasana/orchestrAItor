## ADDED Requirements

### Requirement: Transport runs without approval

Play and stop SHALL execute directly in every mode, including Ask, without an approval prompt. They SHALL still be recorded as activities, SHALL still be refused when no session is connected, and SHALL remain undoable. Undoing a transport change SHALL run the same way, being itself a transport change.

#### Scenario: Playing in Assist

- **WHEN** a producer or an agent asks to play
- **THEN** the session plays immediately and no approval is requested

#### Scenario: Playing in Ask

- **WHEN** the session is in Ask mode and play is requested
- **THEN** the session plays, while every other write is still refused

#### Scenario: No session

- **WHEN** play is requested with no connected session
- **THEN** it is refused like any other tool that needs one
