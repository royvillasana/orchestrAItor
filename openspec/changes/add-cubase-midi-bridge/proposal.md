## Why

Milestone 1 proved the agent → orchestrator → permission engine → normalized tools → DAW adapter path against a mock. The mock cannot change a real session, so nothing yet demonstrates that the normalized contracts survive contact with Cubase. Milestone 2 replaces the mock's role as the only adapter with a real Cubase connection over the MIDI Remote API, and makes the DAW's actual capabilities — not a hard-coded list — decide which tools an agent may call.

## What Changes

- Define a versioned request/response bridge protocol carried over MIDI System Exclusive messages, with correlation, checksums, bounded payloads, and timeouts.
- Add a pluggable MIDI transport boundary so the protocol is testable without hardware: an in-process loopback transport plus an optional platform transport that degrades to a typed unavailable state when no MIDI backend is present.
- Ship the Cubase-side MIDI Remote driver script and document its installation, port naming, and pairing.
- Implement a capability handshake: the bridge reports the connected Cubase version and the operations it can actually perform, and the orchestrator filters tools from that report rather than from a static list.
- Implement `CubaseBridgeAdapter` against the existing `DawAdapter` contract: connect, disconnect, capability report, project state read, and tempo/transport execution against the live session.
- Make adapter choice explicit in the interface. Cubase Mock and Cubase Bridge are separate, labeled selections; a bridge failure never silently falls back to the mock.
- Keep every write on the existing permission path. The bridge introduces no new approval-granting surface and no agent-visible transport control.

Out of scope: track creation, MIDI clip insertion, plugin control, sample indexing, and live agent CLI sessions. Windows MIDI verification and audio rendering remain deferred.

## Capabilities

### New Capabilities

- `cubase-bridge`: MIDI transport boundary, SysEx bridge protocol, capability handshake, the Cubase MIDI Remote driver script, and the live adapter.

### Modified Capabilities

- `mock-daw-adapter`: Adapter selection becomes explicit; the mock states its identity relative to a real connection and is never substituted for a failed bridge.
- `music-orchestration`: Tool exposure derives from the connected adapter's handshake report, revalidated after approval.
- `production-workspace`: Connection setup gains bridge selection, port detection, handshake status, and accurate failure and unavailable states.

## Impact

Adds a `packages/adapters/cubase` bridge implementation alongside the mock, a transport package boundary, and a `resources/` driver script installed by the user into Cubase. Introduces no native dependency in the default install: the platform MIDI backend is optional and absent-by-default, so `pnpm install` and the existing smoke path stay unchanged. Automated verification uses a simulated Cubase peer that speaks the real protocol over loopback. Live verification requires Cubase 12 or newer on the user's machine and is documented rather than automated, matching the existing Windows limitation note.
