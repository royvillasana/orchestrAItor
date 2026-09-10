# agent-discovery Specification

## Purpose

TBD - created by archiving change setup-orchestrai-desktop. Update Purpose after archive.

## Requirements

### Requirement: Discover installed agent executables

The discovery service SHALL search PATH and platform-specific common installation locations for Claude Code, Codex, and OpenAI CLI, validate candidates, and deduplicate resolved paths without executing candidates or a shell.

#### Scenario: Candidate found outside PATH

- **WHEN** Claude or Codex exists in a supported common location absent from PATH
- **THEN** discovery returns its installed status and resolved executable path

#### Scenario: Missing or inaccessible candidates

- **WHEN** a candidate is missing, inaccessible, or invalid
- **THEN** discovery reports its status without crashing or preventing discovery of other agents

#### Scenario: Windows executable candidates

- **WHEN** discovery runs with Windows paths and supported executable extensions
- **THEN** it recognizes eligible executables or command shims without POSIX path assumptions or executing them

### Requirement: Installation is distinct from connection

Discovery SHALL report only what exists on disk without executing candidates. Installed, authenticated, and connected SHALL be distinct states, and authentication SHALL be established only by explicit verification.

#### Scenario: Installed but never verified

- **WHEN** a CLI is discovered and not yet verified
- **THEN** it is reported as installed with authentication unverified, and is not presented as connected

#### Scenario: Verified and connected

- **WHEN** a verified provider is connected as the creative partner
- **THEN** the interface distinguishes it from both an unverified installation and the Demo provider

### Requirement: Model-independent provider contract

Agent providers SHALL implement initialize, sendMessage, cancel, and getCapabilities using shared conversation, tool, response, and error contracts. The OpenAI abstraction SHALL support an injectable transport and report unavailable when no transport is configured.

#### Scenario: Unconfigured OpenAI

- **WHEN** a caller attempts to initialize the default OpenAI abstraction
- **THEN** it returns a typed unavailable result without network activity or fabricated model output

### Requirement: Explicit deterministic demo session

The skeleton SHALL supply a clearly labeled Demo agent that supports project inspection and proposing mock tempo/transport operations through the orchestrator, with cancellation and honest unsupported-request responses.

#### Scenario: Demo tempo request

- **WHEN** the user asks the Demo agent to set tempo to 124 in Assist
- **THEN** it produces a normalized tempo request that awaits approval and reports the actual resulting outcome

#### Scenario: Future music request

- **WHEN** the user asks Demo to generate a bassline or search samples
- **THEN** it explains that the feature is unavailable without claiming to generate MIDI or search a library
