## ADDED Requirements

### Requirement: The standing list is the disclosure

Agent mode's standing list SHALL contain only reversible session changes — tempo, transport, and track volume, mute, and solo — and plugin writes SHALL NOT be on it. The interface's pre-run disclosure SHALL be rendered from that list, so what is named cannot differ from what runs unattended.

#### Scenario: A plugin write during a run

- **WHEN** an agent asks for a plugin or quick control change during a run
- **THEN** it takes an approval like any other write

#### Scenario: Reading the disclosure

- **WHEN** a producer reads the pre-run banner
- **THEN** it names exactly the tools that will run without approval

### Requirement: Undoing a run restores plugin state

Undoing a run SHALL restore the plugin bypass state and quick control values captured before the run, alongside tempo, transport, and track levels.

#### Scenario: A run that moved a quick control

- **WHEN** a run changed a quick control and the producer undoes the run
- **THEN** the quick control is restored to its value before the run
