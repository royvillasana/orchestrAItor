# audio-analysis Specification

## Purpose

TBD - created by archiving change add-audio-analysis. Update Purpose after archive.

## Requirements

### Requirement: Decode uncompressed audio without a codec dependency

Analysis SHALL decode WAV and AIFF PCM to mono samples across common bit depths and both byte orders, bound how much audio it reads per file, and decline unsupported or malformed audio without failing that file's index entry.

#### Scenario: Common bit depths

- **WHEN** 16, 24, and 32 bit files are analysed
- **THEN** each decodes to the same signal within rounding

#### Scenario: Compressed format

- **WHEN** an MP3 or FLAC file is encountered
- **THEN** it is left without estimates and remains searchable by name and header facts

#### Scenario: Malformed audio

- **WHEN** a file's audio data is truncated or unreadable
- **THEN** analysis declines it and the sample stays in the index

### Requirement: Estimated key with confidence

Key estimation SHALL fold spectral energy into twelve pitch classes, correlate against major and minor profiles, and report the best key with a confidence derived from its margin over the alternatives.

#### Scenario: Clear tonality

- **WHEN** material centred on a clear tonic is analysed
- **THEN** the reported key matches it with a usable confidence

#### Scenario: Noise

- **WHEN** material with no tonal centre is analysed
- **THEN** the confidence is low, and the estimate is presented as unreliable rather than withheld silently

### Requirement: Estimated tempo, or none

Tempo estimation SHALL derive an onset envelope, autocorrelate it across a plausible musical range, and report BPM with a confidence. Material too short or too sparse to carry a tempo SHALL report no tempo rather than a number derived from noise.

#### Scenario: Loop at a known tempo

- **WHEN** a loop with regular onsets is analysed
- **THEN** the reported tempo matches it

#### Scenario: One-shot

- **WHEN** a single drum hit is analysed
- **THEN** no tempo is reported

### Requirement: Estimates are labelled as estimates

Estimated key and tempo SHALL be stored and displayed as estimates with their confidence, and SHALL NOT be presented in the same terms as facts read from a file header.

#### Scenario: Reading a result

- **WHEN** a producer or an agent sees an estimated key
- **THEN** it is identified as an estimate with its confidence

### Requirement: Analysis is bounded, background, and resumable

Analysis SHALL run after indexing rather than within it, SHALL be cancellable, SHALL report progress, and SHALL skip files whose estimates are already current.

#### Scenario: Large library

- **WHEN** a large folder is analysed
- **THEN** progress is visible, the interface stays usable, and analysis can be stopped

#### Scenario: Resuming

- **WHEN** analysis is stopped and started again
- **THEN** already analysed files are skipped

#### Scenario: Restart

- **WHEN** the application restarts
- **THEN** estimates persist and are not recomputed
