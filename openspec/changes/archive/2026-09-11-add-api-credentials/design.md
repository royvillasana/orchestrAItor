## Context

Everything the application has stored so far is the producer's own work: conversations, activity, a sample index. A key is different in kind. It is a bearer credential, it is worth money and access to whoever holds it, and it is the first thing in this project where being careless is expensive rather than merely wrong.

## Decisions

### The operating system keeps it

Electron's `safeStorage` encrypts through the platform credential store — Keychain on macOS, the equivalent elsewhere — and only the ciphertext is stored, in the existing settings table. Rolling encryption here would mean inventing key management, which is the kind of guess this project has refused everywhere it mattered less than this.

### No encryption means no storage

Where the platform reports encryption unavailable, storing is refused with the reason. A fallback to plaintext would be a worse outcome than a producer discovering they must use a CLI session instead, because the fallback is invisible at the moment it matters.

### The interface never gets the key back

A snapshot carries whether a key is stored and its last four characters. That is enough to tell one key from another and not enough to use one. The renderer is the least trusted part of this application; a value it never receives cannot leak from it.

### Out of every child environment

The runtime child already receives a deliberate environment allowlist rather than the whole environment. A key is passed over the trusted control channel when a keyed session connects, held in memory, and never added to that allowlist, so an agent CLI spawned from the runtime cannot read it from its environment.

### A keyed provider is an ordinary provider

The tool loop is the same registry, the same permission engine, and the same approval. A key changes who answers, not what answering is allowed to do.

## Risks / Trade-offs

A key in the desktop process's memory is readable by anything that can already read that process's memory, which is a boundary this project cannot raise on its own.

The tool loop is bounded by a maximum number of rounds. A provider that keeps requesting tools ends the turn with that stated, rather than looping until something else stops it.

## Migration Plan

Additive. The settings table already exists, so no schema change. A producer with no key sees the provider listed as needing one, and every existing path is untouched.
