## Why

The DAW is live and the agent is real, but the assistant is blind to the only material a producer actually works with: their sounds. Asked for a kick, it can only explain that sample search is unavailable. The connection screen still shows sample libraries as a placeholder, which is the last unfinished part of setup.

A local index closes that gap without sending anything anywhere: the agent gets a search tool over the producer's own folders, and the producer can hear a result before deciding.

## What Changes

- Let the producer choose sample folders through the OS folder picker, and persist those roots locally.
- Index chosen roots into SQLite: audio files with size, modification time, and the format facts readable from a file header without decoding. Re-indexing skips unchanged files.
- Derive searchable tags from folder and file names, and expose `samples.search` and `samples.stats` as read-only tools, available in Ask, so a live agent can find sounds and cite real paths.
- Preview a sample from the workspace through a protocol confined to indexed roots.
- Replace the sample libraries placeholder with real folder management, index progress, counts, and failure reasons.
- Migrate the database from schema 1 to 2, preserving existing conversations, activity, and transactions.

Out of scope: writing samples into the DAW, waveform rendering, audio analysis beyond header facts, MIDI artifact generation, and cloud sample sources.

## Capabilities

### New Capabilities

- `sample-libraries`: Root selection, bounded indexing, search tools, and confined preview.

### Modified Capabilities

- `desktop-foundation`: Schema migration 002 and a second confined protocol for sample media.
- `music-orchestration`: Read-only sample tools in the registry, available in Ask.
- `production-workspace`: Sample library management, search, and preview in the interface.

## Impact

Implements the reserved `packages/sample-indexer`. Indexing reads the producer's chosen folders only, records paths and header facts, and never copies or moves audio. Nothing is uploaded: search runs against the local database, and a live agent receives only the metadata it asks for, which does include file names and folder names from the producer's disk. Large libraries are bounded by an explicit file cap per root with the count reported, since a full catalog scan is the first operation in this project that can take minutes.
