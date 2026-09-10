## ADDED Requirements

### Requirement: Bridge connection setup

Connection setup SHALL let the user choose the Cubase bridge, SHALL list detected MIDI ports, and SHALL report handshake progress, the connected Cubase version, and failure reasons. When no MIDI backend is available the bridge option SHALL be shown as unavailable with the reason, and SHALL not appear connectable.

#### Scenario: No MIDI backend

- **WHEN** the platform has no MIDI backend available
- **THEN** the bridge option is presented as unavailable with the reason, and the mock remains selectable

#### Scenario: Handshake succeeds

- **WHEN** the bridge handshake completes
- **THEN** the interface shows the connected Cubase version and a live, non-mock session indicator

#### Scenario: Bridge lost mid-session

- **WHEN** the bridge disconnects while the workspace is open
- **THEN** writes are disabled, pending approvals are invalidated, history is preserved, and reconnection is an explicit action
