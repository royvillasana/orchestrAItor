## Why

Live sessions require a signed-in Claude Code or Codex CLI. A producer who has an API key and no CLI has no way in, and Milestone 1 recorded that credentials, when they arrived, must use the OS credential store rather than a file next to the database.

This is the last item from the original proposal: connect a provider with an API key, stored where the operating system keeps secrets.

## What Changes

- Store an API key encrypted through the OS credential store, and keep the ciphertext in local settings. Refuse to store anything when the OS reports no encryption available, rather than falling back to plaintext.
- Never return a stored key to the interface. The interface learns only that a key is stored and the last four characters, which is enough to recognise which key it is and not enough to use.
- Add OpenAI as a creative partner backed by a real transport: a conversation, the same tools, and the same permission path as every other provider.
- Keep the key out of every child process environment, and out of logs and diagnostics through the existing redaction.
- Let a producer add, replace, and remove a key, and say plainly that using it sends conversation content to the provider.

Out of scope: OAuth flows, multiple keys per provider, organisation or project selection, usage reporting, and streaming from the API.

## Capabilities

### New Capabilities

- `api-credentials`: Encrypted storage through the OS credential store, masked status, and a keyed provider session.

### Modified Capabilities

- `agent-discovery`: A provider can be usable through a stored key rather than an installed CLI.
- `production-workspace`: Adding, replacing, and removing a key, and what it means.

## Impact

A stored key is encrypted by the operating system's credential store and held as ciphertext in the local database. It is decrypted in the desktop process when a keyed session is connected, held in memory for that session, and never written anywhere in plaintext, never placed in a child process environment, and never sent to the interface.

Using a keyed provider sends the conversation and project state to that provider, exactly as a live CLI session does, and the interface says so before the session connects.
