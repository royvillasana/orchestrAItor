## ADDED Requirements

### Requirement: Plugin view for a track

The workspace SHALL show a track's instrument plugin, its bypass state, and its mapped quick controls with names and values, and SHALL say plainly when a track carries no plugin.

#### Scenario: Track with a plugin

- **WHEN** a track carrying a plugin is shown
- **THEN** its plugin name, bypass state, and mapped quick controls are visible

#### Scenario: Track with none

- **WHEN** a track carries no plugin
- **THEN** the interface says so rather than showing an empty control grid
