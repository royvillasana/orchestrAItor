## Why

The DAW side is now real: an approved write reaches a live session over MIDI. The agent side is not. The Demo provider is deterministic by construction, so nothing yet shows a real model choosing a tool, and the connection screen can only say a CLI is "Detected · Auth unverified" — installation has never been distinguished from a usable session.

Claude Code and Codex are both installed and signed in on the target machine, and both can run non-interactively while talking to an MCP server. OrchestrAI already **is** that MCP server. Connecting them means a real agent's tool calls land on the same registry, permission engine, and adapter that the Demo agent uses — with no second path to the DAW.

## What Changes

- Verify agent authentication explicitly, as a user-initiated step separate from discovery. Discovery still never executes a candidate; verification runs only the CLI's own status command and reports the account or the reason it is unusable.
- Expose the existing orchestrator to an agent process over a local, token-guarded channel, and ship a small MCP stdio proxy that a CLI loads. Tools, permissions, transactions, and Undo stay where they are; the agent gains no new surface and cannot grant its own approval.
- Implement live Claude Code and Codex providers against the existing AgentProvider contract: streamed assistant output, bounded turns, cancellation that actually stops the child, and typed failures for unauthenticated, missing, or crashed CLIs.
- Confine live agents: an isolated working directory, built-in file and shell tools denied, and only the OrchestrAI MCP tools allowed.
- Make the creative partner selectable — Demo, Claude Code, or Codex — with accurate installed, authenticated, and connected states, and label every message with the provider that produced it.

Out of scope: API-key credential storage, autonomous Agent mode, multi-agent orchestration, and streaming partial tokens into the transcript mid-turn.

## Capabilities

### New Capabilities

- `live-agent-sessions`: Authentication verification, the agent tool channel and MCP proxy, live CLI providers, and confinement.

### Modified Capabilities

- `agent-discovery`: Discovery gains an explicit verification step and reports authenticated identity separately from installation.
- `music-orchestration`: Tool calls arriving from an external agent process are attributed and permission-checked identically to local ones.
- `production-workspace`: Provider selection, live-versus-demo labelling, and agent failure states.

## Impact

Adds a live provider implementation to `packages/agents/claude` and a new Codex package, plus an MCP proxy entry bundled alongside the existing runtime. A CLI agent runs as a supervised child of the runtime with an isolated working directory. No credentials are read, stored, or forwarded by OrchestrAI: each CLI uses its own existing login. Live sessions send prompts to a model provider, which is the first outbound network traffic in the project — the interface states this before a live provider is connected, and the Demo provider remains the default.
