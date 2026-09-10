## 1. Authentication verification

- [x] 1.1 Implement explicit verification running only the CLI's own status command with a timeout and bounded output, parsing logged-in state, account identity, and version.
- [x] 1.2 Keep discovery non-executing and report installed, authenticated, and connected as distinct states.
- [x] 1.3 Test authenticated, signed-out, missing binary, timeout, malformed output, and that discovery alone executes nothing.

## 2. Agent tool channel

- [x] 2.1 Open a token-guarded local channel from the runtime exposing only tool listing and tool calls, with owner-only permissions and bounded message sizes.
- [x] 2.2 Implement the `agent-mcp` stdio proxy that forwards MCP tools/list and tools/call over that channel.
- [x] 2.3 Attribute calls arriving through the channel to the live agent session and run them through the existing registry, mode filter, and permission engine.
- [x] 2.4 Test rejected tokens, oversized and malformed messages, approval still required for writes, and no approval-granting surface on the channel.

## 3. Live providers

- [x] 3.1 Implement the Claude Code provider: non-interactive run, streamed event parsing, assistant text, tool activity, bounded turns, and isolated working directory.
- [x] 3.2 Implement the Codex provider against the same contract.
- [x] 3.3 Implement cancellation that stops the child process and marks the turn cancelled without leaving pending writes applied.
- [x] 3.4 Implement typed failures for unauthenticated, missing, crashed, timed-out, and unparseable CLI output.
- [x] 3.5 Confine live agents with strict MCP config, denied built-in file and shell tools, and only OrchestrAI tools allowed.
- [x] 3.6 Test event parsing, tool-call attribution, cancellation, failure typing, and confinement flags with a stubbed CLI.

## 4. Application integration

- [x] 4.1 Add provider selection over the trusted control channel without exposing provider switching to agents.
- [x] 4.2 Build creative-partner selection with installed, authenticated, and connected states, verification, and failure reasons.
- [x] 4.3 Label messages and activity with the producing provider and model, keeping the Demo provider explicitly identified.
- [x] 4.4 State that a live provider sends conversation content to a model before it is connected, and keep Demo the default.
- [x] 4.5 Handle live agent failure mid-session: surface it, keep history, and require an explicit retry.

## 5. Acceptance

- [x] 5.1 Run typecheck, lint, formatting, unit and integration tests, production build, and both existing smoke workflows unchanged.
- [x] 5.2 Verify a real Claude Code session end to end: connect, ask for project state, propose a tempo change, approve it, and confirm the live adapter applied it.
- [x] 5.3 Document provider setup, confinement, the network boundary, and what remains deferred in the README.
