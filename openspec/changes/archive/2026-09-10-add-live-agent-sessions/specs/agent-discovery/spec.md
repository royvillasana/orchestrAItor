## MODIFIED Requirements

### Requirement: Installation is distinct from connection

Discovery SHALL report only what exists on disk without executing candidates. Installed, authenticated, and connected SHALL be distinct states, and authentication SHALL be established only by explicit verification.

#### Scenario: Installed but never verified

- **WHEN** a CLI is discovered and not yet verified
- **THEN** it is reported as installed with authentication unverified, and is not presented as connected

#### Scenario: Verified and connected

- **WHEN** a verified provider is connected as the creative partner
- **THEN** the interface distinguishes it from both an unverified installation and the Demo provider
