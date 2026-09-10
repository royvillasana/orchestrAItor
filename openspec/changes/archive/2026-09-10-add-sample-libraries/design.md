## Context

A sample library is the first thing in this project that is large, slow, and entirely the producer's. A modest drum library is tens of thousands of files; a full catalog scan is the first operation here that can take minutes. Everything else in the project answers in milliseconds against a fixture.

## Decisions

### Header facts, not decoding

Duration, sample rate, and channel count come from WAV and AIFF headers, read from the first few hundred bytes. Decoding audio to measure it would pull in a codec dependency, take orders of magnitude longer, and buy nothing a producer searching for a kick needs. Compressed formats are indexed by name, size, and tags with format facts recorded as unknown rather than estimated — an invented duration is worse than an absent one.

### Bounded traversal

Each root is walked with a depth cap, a file cap, hidden directories skipped, and `realpath` checks so a symlink cannot escape the chosen root. Hitting the cap is reported as a fact about the index, not swallowed: a producer who indexed 20,000 of 60,000 files must be able to see that.

### Incremental by size and modification time

A file whose path, size, and modification time are unchanged is skipped. This is the same heuristic build tools use; it is wrong only for a file rewritten within the same second at identical size, which for sample libraries is close to unheard of. Re-index reports added, updated, removed, and skipped counts.

### Search is a read-only tool

`samples.search` and `samples.stats` are registered with read risk, so they are available in Ask alongside project reads and require no approval. They cannot mutate a library or the DAW. A live agent therefore gains a genuine capability without gaining a new way to change anything.

### Preview through a confined protocol

Audio playback needs a URL the renderer can stream. A second protocol handler serves files under indexed roots only, resolving with the same traversal and symlink protections the application protocol already uses, and refusing any path not present in the index. The index is the allowlist: a path the producer never chose cannot be served even if it exists.

### What a live agent sees

Search results carry file names, folder names, and header facts from the producer's disk, and those are sent to the model provider when a live partner is connected. That is the point of the feature, and the interface already discloses that a live partner sends conversation content. Audio itself never leaves the machine: the agent receives metadata and paths, never bytes.

## Risks / Trade-offs

Indexing touches a lot of the filesystem quickly. It is read-only, bounded, and confined to explicitly chosen roots, but it is the first operation here that can make a machine work hard, and a producer will feel it on a large library.

Tag derivation from path tokens is crude: it will call anything under a folder named `808` an 808. It is honest about being derived from names rather than from analysis, and audio analysis remains a separate, later capability.

## Migration Plan

Schema 1 upgrades to 2 by adding tables inside a transaction; existing rows are untouched. A database already at 2 is accepted; anything higher still fails closed with the existing preserve-and-report behavior.
