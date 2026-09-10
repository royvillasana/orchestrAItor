## ADDED Requirements

### Requirement: Sample library management

The interface SHALL let the producer add and remove sample folders, and SHALL show each root's path, sample count, last index time, indexing progress, and any per-root failure without blocking use of the rest of the library.

#### Scenario: Indexing a large folder

- **WHEN** a large folder is being indexed
- **THEN** progress is visible and the interface stays usable

#### Scenario: One root fails

- **WHEN** one root cannot be read
- **THEN** its failure is shown and other roots remain searchable

### Requirement: Sample search and preview

The workspace SHALL let the producer search indexed samples and preview a result, with distinct empty-result and no-library-added states.

#### Scenario: Preview a result

- **WHEN** the producer previews a search result
- **THEN** the audio plays from the local file without being copied or uploaded
