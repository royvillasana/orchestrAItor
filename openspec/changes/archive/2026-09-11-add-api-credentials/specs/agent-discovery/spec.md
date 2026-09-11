## MODIFIED Requirements

### Requirement: Installation is distinct from connection

Discovery SHALL report only what exists on disk without executing candidates. Installed, authenticated, and connected SHALL be distinct states, and authentication SHALL be established only by explicit verification. A provider MAY instead be usable through a stored API key, in which case having a key SHALL be reported distinctly from having an installed CLI.

#### Scenario: Installed but never verified

- **WHEN** a CLI is discovered and not yet verified
- **THEN** it is reported as installed with authentication unverified, and is not presented as connected

#### Scenario: Usable through a key

- **WHEN** a provider has a stored key and no CLI
- **THEN** it is reported as connectable through that key
