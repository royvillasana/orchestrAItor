## ADDED Requirements

### Requirement: Mock plugin state

The mock SHALL carry a plugin on at least one fixture track with named quick controls, SHALL support bypass and quick control writes with normalized values, and SHALL refuse those writes on a track without a plugin.

#### Scenario: Quick control round trip on the mock

- **WHEN** a quick control is set on a mock track carrying a plugin
- **THEN** the mock reports that control at the new value

#### Scenario: Track without a plugin

- **WHEN** a plugin write names a mock track with no plugin
- **THEN** it is refused and nothing changes
