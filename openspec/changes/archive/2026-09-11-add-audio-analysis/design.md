## Context

The sample index knows names, paths, sizes, and the facts a WAV or AIFF header states. Everything musical about a sample — what key it is in, how fast it is — is currently guessed from folder names, which is why anything under a folder called `808` is tagged `808` whether or not it is one.

Key and tempo can be estimated from the audio. Both are well-understood problems with standard approaches that fit in a few hundred lines, and both are estimates that will sometimes be wrong.

## Decisions

### Say "estimate", and carry the confidence

A key or tempo derived from audio is a guess with a number attached. It is stored and shown as an estimate with its confidence, never in the same voice as a sample rate read from a header. A wrong key stated confidently sends a producer to the wrong sound and costs them more than an absent one; a low-confidence estimate they can ignore costs them nothing.

### Chroma correlation for key

Fold spectral energy into twelve pitch classes and correlate the result against major and minor profiles for all twenty-four rotations. This is the standard approach, it is explainable, and the margin between the best and second-best rotation gives a confidence that means something. It will confuse relative majors and minors on ambiguous material, which is a real limitation to state rather than hide.

### Onset autocorrelation for tempo

Build an onset envelope from spectral flux and autocorrelate it across a plausible musical range. A one-shot kick has no tempo, and material with too few onsets is declined rather than assigned a number from noise. Octave errors — half or double time — are inherent to autocorrelation; the range is bounded to the tempos producers actually work at, which reduces but does not eliminate them.

### No dependency, again

Decoding PCM and computing a transform are arithmetic. Writing them directly keeps an offline application free of a codec dependency, as with the MIDI writer, and makes both testable against synthesised signals whose correct answer is known by construction — a 440 Hz tone is A, a pulse every half second is 120 BPM.

Compressed formats are not decoded. Doing so honestly means a real codec, and estimating from a partial MP3 decode would produce numbers whose errors nobody could account for. Those samples stay searchable by name and header facts, with no estimate rather than a bad one.

### Analysis is separate from indexing

Indexing reads headers and finishes quickly; analysis decodes audio and does not. Running them together would make adding a folder appear to hang. Analysis runs after indexing, per file, bounded in how much audio it reads, cancellable, and reports progress. An unanalysed library still searches by name.

## Risks / Trade-offs

This is the most computationally expensive thing in the project. A large library takes real time and real CPU, on a machine that may be running a DAW. Bounding the audio read per file and making analysis stoppable are what keep that acceptable, and the cost is stated rather than discovered.

Estimation quality varies with material. Sustained harmonic content gives a good key; a single drum hit gives none. Loops give a good tempo; pads give none. The confidence is the signal for that, and results are ordered so that a confident estimate outranks a guess.

## Migration Plan

Additive. Estimates are optional fields on an indexed sample, so an existing library keeps working unanalysed and gains estimates as analysis runs.
