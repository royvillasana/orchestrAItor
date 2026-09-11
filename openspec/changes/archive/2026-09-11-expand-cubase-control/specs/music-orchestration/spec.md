## ADDED Requirements

### Requirement: Channel, EQ, send and command tools

The tool registry SHALL expose writes for pan, record arm, monitor and selection; for the selected track's EQ bands, sends, inserts and automation arm; for paging the mixer bank; and for running an allowlisted host command. Each SHALL take the same approval as any other write of its class.

#### Scenario: Setting a send level

- **WHEN** an agent asks to change a send level
- **THEN** the change takes an approval like any other write

### Requirement: Host commands are destructive

A host command SHALL be classified destructive: it SHALL never appear on Agent mode's standing list, and its approval SHALL name both the command and the track the session reports as selected, because a command acts on the selection rather than on an argument.

#### Scenario: A command in Agent mode

- **WHEN** an agent asks to run a host command during a run
- **THEN** it takes an approval rather than running unattended

#### Scenario: Approving a command

- **WHEN** a producer is asked to approve a host command
- **THEN** the request names the command and the currently selected track
