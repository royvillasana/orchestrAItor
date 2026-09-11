## MODIFIED Requirements

### Requirement: Keys are encrypted by the operating system

An API key SHALL be encrypted through the operating system credential store and persisted only as ciphertext. Where the platform reports encryption unavailable, or offers only a backend that obfuscates rather than encrypts, storing SHALL be refused with that reason and nothing SHALL be written. The interface SHALL state which of these applies before a key is entered, and SHALL NOT offer an entry field where a key cannot be stored safely.

#### Scenario: Storing a key

- **WHEN** a producer saves an API key
- **THEN** only ciphertext is written, and the plaintext appears nowhere on disk

#### Scenario: No platform encryption

- **WHEN** the platform reports no encryption available
- **THEN** storing is refused with the reason and no key is written

#### Scenario: A backend that only obfuscates

- **WHEN** the session offers only a backend that obfuscates rather than encrypts
- **THEN** the card says so before a key is typed, no entry field is offered, and storing is refused

## ADDED Requirements

### Requirement: A key that changes takes effect immediately

A session SHALL use the key that is stored now, not the key it was created with. Replacing the key for the active provider SHALL rebuild the session so the next request carries the new key, without requiring a restart or a provider switch.

#### Scenario: Replacing a rejected key

- **WHEN** a producer replaces a key that the provider rejected
- **THEN** the next turn is sent with the new key

#### Scenario: Replacing a working key

- **WHEN** a producer replaces the key of the active provider
- **THEN** the session remains connected and subsequent requests carry the new key

### Requirement: Removing a key stops the session using it

Removing a key SHALL cancel any turn in flight for that provider, SHALL prevent any further request carrying the removed key, and SHALL fall back to a provider that needs no key.

#### Scenario: Removing a key mid-turn

- **WHEN** a producer removes the key while a turn is running
- **THEN** the turn is cancelled, no further request carries that key, no further tool call is made, and the session falls back to the local provider
