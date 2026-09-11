## ADDED Requirements

### Requirement: Managing an API key

The interface SHALL let a producer add, replace, and remove an API key, SHALL show a keyed provider as connectable only when a key is stored, and SHALL state that a keyed session sends conversation content to that provider. The key SHALL NOT be displayed after entry.

#### Scenario: Adding a key

- **WHEN** a producer saves a key
- **THEN** the provider becomes selectable and the key is shown only as its last four characters

#### Scenario: Without a key

- **WHEN** no key is stored
- **THEN** the provider is listed as needing one rather than as unavailable for an unstated reason
