## ADDED Requirements

### Requirement: Correct musical material

Generated material SHALL be built from music theory rather than fixed tables: scales and diatonic chords derived from the requested key, voicings constrained to a playable range, and lines that stay in the requested scale.

#### Scenario: Progression in the session key

- **WHEN** a progression is requested in A minor
- **THEN** every chord is diatonic to A minor and is described by its roman numerals

#### Scenario: Out-of-range request

- **WHEN** a requested register would place notes outside the MIDI range
- **THEN** the request is refused rather than producing notes that cannot be played

### Requirement: Deterministic generation

Generation SHALL be deterministic from an explicit seed, and the seed SHALL be recorded with the artifact.

#### Scenario: Same seed, same file

- **WHEN** the same request is generated twice with the same seed
- **THEN** the note content is identical

#### Scenario: Different seed, different material

- **WHEN** the same request is generated with a different seed
- **THEN** the material differs while remaining in key

### Requirement: Valid standard MIDI files

Written files SHALL be standard MIDI files with correct header and track chunks, variable-length delta times, tempo and time signature meta events matching the session, paired note on and note off events, and an end-of-track event.

#### Scenario: Parsed back

- **WHEN** a written clip is parsed as a MIDI file
- **THEN** its tempo, time signature, bar count, and notes match what was requested

#### Scenario: Invalid value

- **WHEN** a note, velocity, or channel outside the MIDI range would be written
- **THEN** writing fails rather than emitting a malformed file

### Requirement: Generation is an approved write

`midi.create_clip` SHALL be a write capability: refused in Ask, requiring approval in Assist, and recorded as a transaction. It SHALL NOT overwrite an existing artifact.

#### Scenario: Ask mode

- **WHEN** a clip is requested in Ask mode
- **THEN** it is refused and no file is written

#### Scenario: Awaiting approval

- **WHEN** a clip is requested in Assist mode
- **THEN** no file exists until the producer approves, and the reply says so

#### Scenario: Repeated request

- **WHEN** the same clip is requested twice and both are approved
- **THEN** two artifacts exist and neither has overwritten the other

### Requirement: Artifacts are stored and explainable

Each artifact SHALL record its file, musical summary, arguments, and seed, and SHALL be listed with its bar count and creation time. Artifacts SHALL live under the application data directory and never inside the producer's project or sample folders.

#### Scenario: Explaining a clip

- **WHEN** the producer looks at a generated clip
- **THEN** its key, progression, bars, and tempo are shown

#### Scenario: Removing a clip

- **WHEN** an artifact is removed
- **THEN** its file is deleted and no other artifact is affected

### Requirement: Hand-off is a file, not an insertion

A generated clip SHALL be handed over as a file: revealable in the file manager and draggable into the DAW. The interface SHALL NOT state or imply that the project was changed.

#### Scenario: Producer drags a clip

- **WHEN** the producer drags a listed artifact
- **THEN** the drag carries the MIDI file so it can be dropped onto a track

#### Scenario: Wording

- **WHEN** a clip has been generated
- **THEN** it is described as a file to drop in, and the DAW session is reported unchanged
