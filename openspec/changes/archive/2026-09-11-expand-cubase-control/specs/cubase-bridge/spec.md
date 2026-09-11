## ADDED Requirements

### Requirement: The mixer bank can be paged

The bridge SHALL expose the mixer bank's own paging actions — next bank, previous bank, shift by one channel in either direction, and reset — and SHALL report which channels the bank is currently showing. A session with more channels than the bank covers SHALL remain reachable by paging rather than being reported as a session of bank size.

#### Scenario: Paging to later channels

- **WHEN** a producer or agent pages the bank forward
- **THEN** the reported tracks are the next group of channels, and the reported bank position says so

#### Scenario: A session larger than the bank

- **WHEN** the session has more channels than the bank covers
- **THEN** the state reports that it is truncated and which window it is showing, rather than presenting the window as the whole session

### Requirement: A channel reports and accepts its full basic surface

The bridge SHALL report each channel's pan, record arm, monitor state, and selection alongside its name, volume, mute and solo, read from the host's callbacks. It SHALL accept writes to each of them, refusing a write naming a channel the bank is not currently showing.

#### Scenario: Arming a track

- **WHEN** an approved record arm executes on a reported channel
- **THEN** the host's record enable for that channel is set and the new state is reported back

#### Scenario: A channel outside the bank window

- **WHEN** a write names a channel the bank is not showing
- **THEN** it is refused with that reason rather than applied to the wrong channel

### Requirement: The selected track exposes EQ, sends, inserts and automation

The bridge SHALL report the selected track's four EQ bands (on, gain, frequency, Q), its send slots (on, level, pre/post), its insert slots (on, bypass), and its automation read and write arm, and SHALL accept writes to each. Where no track is selected, it SHALL report that rather than reporting empty values as if they were a channel's.

#### Scenario: Changing an EQ band

- **WHEN** an approved EQ change executes on the selected track
- **THEN** the host's band value is set and the reported state reflects it

#### Scenario: Nothing selected

- **WHEN** no track is selected
- **THEN** the selected-channel surface is reported as absent, and a write to it is refused

### Requirement: An allowlisted host command can be run

The bridge SHALL run a Cubase command only from a fixed allowlist declared in the script, SHALL refuse any command outside it, and SHALL report a command that opens a dialog as opened rather than as completed.

#### Scenario: Saving the project

- **WHEN** an approved save command runs
- **THEN** the host's Save command is triggered

#### Scenario: A command outside the allowlist

- **WHEN** a command that is not on the allowlist is requested
- **THEN** it is refused and nothing is triggered
