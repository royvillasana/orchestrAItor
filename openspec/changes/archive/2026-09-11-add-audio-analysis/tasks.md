## 1. Decoding

- [x] 1.1 Decode WAV and AIFF PCM to mono float samples, handling 8, 16, 24, and 32 bit depths and both byte orders.
- [x] 1.2 Downsample to an analysis rate and bound how much audio is read per file.
- [x] 1.3 Decline unsupported or malformed audio without failing the file's index entry.
- [x] 1.4 Test decoding against generated fixtures of each depth, both endiannesses, and truncated data.

## 2. Key estimation

- [x] 2.1 Implement a discrete Fourier transform over windowed frames at a size suitable for pitch resolution.
- [x] 2.2 Fold spectral energy into a twelve-bin chroma vector across a musical frequency range.
- [x] 2.3 Correlate chroma against major and minor profiles for all twelve rotations, reporting the best key and a confidence from the margin.
- [x] 2.4 Test against synthesised tones, chords, and a progression in a known key, and confirm noise reports low confidence.

## 3. Tempo estimation

- [x] 3.1 Compute an onset envelope from spectral flux.
- [x] 3.2 Autocorrelate the envelope over a plausible tempo range and report BPM with a confidence.
- [x] 3.3 Decline to report a tempo for material too short or too sparse to carry one.
- [x] 3.4 Test against synthesised pulses at known tempos, including a half-time confusion case, and confirm a single hit reports nothing.

## 4. Library integration

- [x] 4.1 Extend the indexed sample with estimated key, tempo, and confidences, marked as estimates.
- [x] 4.2 Run analysis after indexing in the background, bounded and cancellable, reporting progress.
- [x] 4.3 Persist estimates and skip re-analysing an unchanged file.
- [x] 4.4 Test that analysis does not block indexing, that it resumes, and that estimates survive a restart.

## 5. Musical search

- [x] 5.1 Filter search by key and tempo range, ranking musical matches above name matches.
- [x] 5.2 Accept key and tempo in `samples.search` and describe results with their estimates and confidence.
- [x] 5.3 Test filtering, ranking, and that an unanalysed library says so rather than returning nothing.

## 6. Interface

- [x] 6.1 Show each result's estimated key and tempo with its confidence, visibly as an estimate.
- [x] 6.2 Show analysis progress and let it be stopped.

## 7. Acceptance

- [x] 7.1 Run typecheck, lint, formatting, unit and integration tests, production build, and every smoke workflow.
- [x] 7.2 Analyse a real folder, search it musically from the interface, and have a live agent find a sample by key.
- [x] 7.3 Document what is estimated, how confidence is reported, the cost on a large library, and what is out of scope.
