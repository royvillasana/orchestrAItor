## Context

Claude Code (`claude -p --output-format stream-json --mcp-config …`) and Codex (`codex exec --json -c mcp_servers.…`) both run non-interactively and both speak MCP. OrchestrAI already exposes its music tools over MCP through the supervised runtime child. The question is not how to give an agent tools, but how to give it _these_ tools without creating a second route to the DAW.

## Goals / Non-Goals

Goals: one orchestrator, one permission engine, one adapter session, whoever is calling; a live session that is obviously live; failures that name their cause.

Non-Goals: storing API credentials, autonomous operation without approval, token-level streaming into the transcript, and running an agent against a repository or the user's filesystem.

## Decisions

### One orchestrator, reached through a proxy

The runtime child already owns the orchestrator and answers MCP over its private stdio to Electron. A CLI agent cannot share that stdio, and starting a second runtime would create a second orchestrator with its own adapter session and no persistence channel — two sources of truth about one Cubase session.

Instead the runtime opens a **local stream channel** with a per-session token, and a small `agent-mcp` entry acts as an MCP stdio server that forwards `tools/list` and `tools/call` to it. The CLI is launched with that proxy in its MCP config. Every agent tool call therefore lands on the same registry, mode filter, approval flow, transaction log, and Undo as a Demo call.

The channel is a Unix domain socket (a named pipe on Windows) created with owner-only permissions inside the application data directory, plus a random token required on every request. The surface it exposes is exactly the surface the MCP server already exposes to agents — listing and calling tools — so it grants nothing new. Approval remains reachable only over the desktop's trusted control channel: an agent still cannot approve its own write.

Alternative rejected: passing the agent a callback into Electron main. That would put the approval-granting process on the same channel as agent-driven calls, which is the boundary Milestone 1 was built to keep.

### Verification is executing, so it is explicit

Milestone 1 deliberately never executed a discovered binary, because finding `claude` on PATH says nothing about whether running it is safe or wanted. Checking authentication necessarily executes it. So verification is a separate, user-initiated action: discovery keeps reporting only what exists, and pressing **Verify** runs `claude auth status` or `codex login status` with a timeout and a bounded read, parsing only the account identity and logged-in state. Nothing else about the CLI is ever executed implicitly.

### Confinement

A live agent runs with a temporary working directory of its own, `--strict-mcp-config` so only OrchestrAI's server is loaded, built-in file and shell tools denied, and a bounded turn count. The confinement is defence in depth rather than the primary control: the permission engine already refuses writes without approval, and the mock or bridge adapter is the only route to Cubase.

### Provider identity travels with the message

Every persisted message already carries a provider field. Live output records the provider and model that produced it, and the Demo provider keeps its explicit label, so a transcript read later cannot confuse a deterministic fixture with a model's answer. This is the same rule the mock/live DAW labelling follows.

### Turn shape

The provider sends one prompt and reads the CLI's event stream to completion, emitting assistant text and tool activity as it arrives. Cancellation kills the child and marks the turn cancelled; because the permission engine holds any pending write, a cancelled turn cannot leave a half-applied change. Partial token streaming into the transcript is deferred — it changes the persistence model, and nothing in this milestone needs it.

## Risks / Trade-offs

This introduces the project's first outbound network traffic: a live provider sends the conversation to a model. The interface says so before connecting, and the Demo provider stays the default. Prompts include project state such as tempo and track names.

The CLIs are third-party programs whose flags and event schemas can change between versions. Each provider parses defensively, treats unknown events as ignorable, and reports a version mismatch as a typed failure rather than crashing the runtime. The verified version is recorded alongside the session.

## Migration Plan

Additive. The Demo provider, its tests, and both smoke workflows are unchanged and remain the default path.
