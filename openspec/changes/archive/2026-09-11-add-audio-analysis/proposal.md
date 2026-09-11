## Why

Sample search matches names and folder tokens. A folder called `808` tags everything inside it `808`, and a producer asking for "a kick that fits A minor at 124" gets whatever happens to be named that way. The index knows a file's name and its header facts; it knows nothing about the sound.

This implements the reserved `audio-analysis`: estimate a sample's musical key and tempo from the audio itself, so search can answer a musical question rather than a filename one.

## What Changes

- Decode uncompressed audio — WAV and AIFF, the formats whose headers the index already reads — into mono samples without adding a codec dependency.
- Estimate key by chroma: fold spectral energy into twelve pitch classes and correlate against major and minor profiles, reporting the key and a confidence.
- Estimate tempo by onset autocorrelation over a plausible musical range, reporting BPM and a confidence, and declining to guess for material too short or too sparse to carry a tempo.
- Record estimates on the indexed sample, marked as estimates with their confidence, never as facts read from a header.
- Analyse in the background after indexing, bounded and cancellable, so adding a folder stays responsive.
- Let search filter by key and tempo, and let `samples.search` accept them, so an agent can ask the question a producer would.

Out of scope: analysing compressed formats, beat grids and downbeat detection, loudness or spectral descriptors, instrument classification, and re-tuning or time-stretching anything.

## Capabilities

### New Capabilities

- `audio-analysis`: Decoding, key and tempo estimation, confidence, and bounded background analysis.

### Modified Capabilities

- `sample-libraries`: Indexed samples carry estimated key and tempo, and search filters on them.
- `music-orchestration`: The sample search tool accepts musical filters.

## Impact

Implements `packages/audio-analysis` with no dependencies: decoding and analysis are written directly, as the MIDI writer was. Analysis reads the producer's own files, keeps only the estimates, and uploads nothing.

Analysis is real work — decoding and transforming audio for every sample in a library — so it runs after indexing rather than inside it, is bounded per file, and can be stopped. On a large library it will take time and say so, rather than appearing to hang.

Estimates are estimates. A key or tempo is shown with its confidence and never presented with the certainty of a header fact, because a wrong key stated confidently is worse for a producer than no key at all.
