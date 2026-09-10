## ADDED Requirements

### Requirement: Producer-chosen sample roots

Sample folders SHALL be chosen by the producer through the operating system folder picker, persisted locally, listed with their counts, and removable. No folder SHALL be indexed without having been chosen.

#### Scenario: Adding a folder

- **WHEN** the producer chooses a folder
- **THEN** it is recorded as a root, indexed, and listed with the number of samples found

#### Scenario: Removing a folder

- **WHEN** a root is removed
- **THEN** its indexed samples are removed from the library and its files are left untouched on disk

### Requirement: Bounded, confined indexing

Indexing SHALL walk a root with a bounded depth and file count, skip hidden directories, and refuse to follow a symlink outside the root. Reaching a bound SHALL be reported rather than silently truncating the result.

#### Scenario: Symlink pointing outside the root

- **WHEN** a symlink inside a root resolves outside it
- **THEN** it is not indexed

#### Scenario: Library larger than the cap

- **WHEN** a root contains more files than the cap
- **THEN** indexing stops at the cap and reports that the root was truncated

#### Scenario: Unreadable directory

- **WHEN** a directory inside a root cannot be read
- **THEN** it is reported and the rest of the root is still indexed

### Requirement: Header facts without decoding

Sample rate, channel count, bit depth, and duration SHALL be read from WAV and AIFF headers without decoding audio. For other formats these facts SHALL be recorded as unknown rather than estimated.

#### Scenario: Compressed format

- **WHEN** an MP3 or FLAC file is indexed
- **THEN** it is searchable by name, tags, and size with format facts recorded as unknown

#### Scenario: Truncated or malformed header

- **WHEN** a file's header is malformed or truncated
- **THEN** the file is indexed with unknown facts and indexing continues

### Requirement: Incremental re-index

Re-indexing SHALL skip files whose path, size, and modification time are unchanged, remove entries for files that no longer exist, and report added, updated, removed, and skipped counts.

#### Scenario: Re-index after adding one file

- **WHEN** a root is re-indexed after one file is added and one deleted
- **THEN** the counts report one added and one removed, and the rest are skipped

### Requirement: Read-only sample tools

`samples.search` and `samples.stats` SHALL be registered as read-risk capabilities available in Ask, with bounded query length and result count. They SHALL NOT modify the library, the DAW, or any file.

#### Scenario: Agent searches in Ask

- **WHEN** a live agent searches for a kick in Ask mode
- **THEN** matching samples with their real paths are returned without an approval prompt

#### Scenario: No library indexed

- **WHEN** a search runs with no indexed library
- **THEN** it explains that no sample folder has been added rather than returning an empty result as if none matched

### Requirement: Preview confined to the index

Sample audio SHALL be served only for paths present in the index, resolving traversal and symlinks before serving, with a content type matching the file.

#### Scenario: Path outside every root

- **WHEN** a request names a file that is not in the index
- **THEN** it is refused, whether or not the file exists

#### Scenario: Unsupported format

- **WHEN** a preview cannot be played by the renderer
- **THEN** it explains that the format is not previewable rather than failing silently
