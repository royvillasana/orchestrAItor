# api-credentials Specification

## Purpose

TBD - created by archiving change add-api-credentials. Update Purpose after archive.

## Requirements

### Requirement: Keys are encrypted by the operating system

An API key SHALL be encrypted through the operating system credential store and persisted only as ciphertext. Where the platform reports encryption unavailable, storing SHALL be refused with that reason and nothing SHALL be written.

#### Scenario: Storing a key

- **WHEN** a producer saves an API key
- **THEN** only ciphertext is written, and the plaintext appears nowhere on disk

#### Scenario: No platform encryption

- **WHEN** the platform reports no encryption available
- **THEN** storing is refused with the reason and no key is written

### Requirement: A stored key is never returned

The interface SHALL receive only whether a key is stored and its last four characters. The key itself SHALL NOT appear in any snapshot, log, or diagnostic.

#### Scenario: Reading state

- **WHEN** the interface asks what is configured
- **THEN** it learns that a key is stored and its last four characters, and nothing more

#### Scenario: Diagnostics

- **WHEN** an error mentioning a key is logged
- **THEN** the key is redacted

### Requirement: Keys stay out of child processes

A stored key SHALL NOT be placed in the environment of any child process, including agent CLIs.

#### Scenario: A live CLI runs alongside a stored key

- **WHEN** an agent CLI is spawned while a key is stored
- **THEN** that key is absent from the child's environment

### Requirement: A keyed provider uses the shared permission path

A provider authenticated by a stored key SHALL use the same tool registry, mode filtering, permission engine, and approval flow as every other provider, and SHALL bound the number of tool rounds in a turn.

#### Scenario: Keyed provider proposes a write

- **WHEN** a keyed provider calls a write tool in Assist
- **THEN** it awaits approval exactly as a CLI-backed provider does

#### Scenario: Tool rounds exhausted

- **WHEN** a turn reaches the tool-round limit
- **THEN** the turn ends and says so rather than continuing

### Requirement: A key can be replaced and removed

A producer SHALL be able to replace a stored key and remove it, and removal SHALL leave no ciphertext behind.

#### Scenario: Removing a key

- **WHEN** a producer removes a stored key
- **THEN** the provider is no longer connectable and no ciphertext remains
