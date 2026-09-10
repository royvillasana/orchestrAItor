## 1. Storage

- [x] 1.1 Add schema migration 002 for sample roots and indexed samples, upgrading an existing version 1 database in a transaction without losing history.
- [x] 1.2 Implement typed persistence for adding, listing, and removing roots and for replacing a root's indexed samples.
- [x] 1.3 Test upgrade from 1 to 2, rollback on failure, rejection of an unknown future version, and history preservation across the upgrade.

## 2. Indexing

- [x] 2.1 Walk a chosen root with bounded depth, bounded file count, skipped hidden directories, and no symlink escape.
- [x] 2.2 Read format facts from WAV and AIFF headers without decoding, and record unknown rather than guessing for other formats.
- [x] 2.3 Derive tags from folder and file name tokens and record size and modification time.
- [x] 2.4 Skip unchanged files on re-index and report added, updated, removed, and skipped counts.
- [x] 2.5 Test traversal bounds, header parsing, malformed and truncated files, unreadable directories, and incremental re-index.

## 3. Tools

- [x] 3.1 Implement `samples.search` with bounded query and result count, matching name, tags, and format facts.
- [x] 3.2 Implement `samples.stats` reporting roots, counts, and last index time.
- [x] 3.3 Register both as read-only capabilities available in Ask, refusing gracefully when no library is indexed.
- [x] 3.4 Test filtering, bounds, empty-library behavior, and that neither tool can mutate anything.

## 4. Preview

- [x] 4.1 Serve sample audio through a protocol confined to indexed roots, rejecting traversal, symlink escape, and unindexed paths.
- [x] 4.2 Play a selected sample in the workspace with correct content types and explicit unsupported-format handling.
- [x] 4.3 Test path confinement, content types, and rejection of a file outside every indexed root.

## 5. Interface

- [x] 5.1 Replace the sample libraries placeholder with folder selection, listed roots, counts, index progress, and removal.
- [x] 5.2 Build sample search and preview in the workspace, with empty and no-library states.
- [x] 5.3 Report indexing failures per root and keep the rest of the library usable.

## 6. Acceptance

- [x] 6.1 Run typecheck, lint, formatting, unit and integration tests, production build, and all existing smoke workflows unchanged.
- [x] 6.2 Index a real folder, search it from the interface, preview a result, and have a live agent find a sample and cite its real path.
- [x] 6.3 Document library setup, indexing bounds, what leaves the machine, and deferred work in the README.
