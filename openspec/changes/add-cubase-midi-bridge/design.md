## Context

Cubase exposes no local HTTP or IPC surface for third-party control. Its MIDI Remote API (Cubase 12+) runs a sandboxed JavaScript driver script inside Cubase that binds to a MIDI input/output port pair. The script has no network, filesystem, or process access. MIDI is therefore the only supported channel, and every message must fit MIDI's wire format.

Milestone 1 deliberately avoided native modules (SQLite runs through `sql.js`) so that `pnpm install` never triggers an Electron ABI rebuild. A MIDI backend on macOS or Windows requires a native binding. Forcing that dependency on every install would regress a property the project already paid for.

## Goals / Non-Goals

Goals: a versioned protocol that survives MIDI's constraints; a transport boundary that makes the protocol testable without hardware; capability truth coming from the connected DAW; no weakening of the Milestone 1 permission path.

Non-Goals: audio streaming, plugin control, track creation, MIDI clip authoring, automatic driver-script installation into Cubase, and Windows live verification.

## Decisions

### Transport boundary with an optional native backend

`MidiTransport` is a narrow interface — `open`, `close`, `send(bytes)`, `onMessage(bytes)`, `listPorts()`. Two implementations ship:

- `LoopbackMidiTransport`: in-process, pairs two endpoints directly. Drives all automated tests and the simulated Cubase peer.
- `PlatformMidiTransport`: lazily `import()`s an optional MIDI binding. When the module is absent or fails to load, it resolves to a typed `unavailable` result naming the missing backend and the install command.

The default install has no MIDI dependency, so existing install/build/smoke behavior is unchanged. The interface is what the adapter depends on, so a different backend can replace it without touching protocol or adapter code.

Alternative rejected: making a native MIDI module a hard dependency. It regresses the no-rebuild property for every contributor, including those who will never connect Cubase.

### SysEx framing

Requests and responses travel as System Exclusive messages using a non-commercial manufacturer ID, framed as `F0 7D <protocol> <kind> <correlation> <length-hi> <length-lo> <payload…> <checksum> F7`. Payload bytes are 7-bit; JSON payloads are encoded 8-to-7 so arbitrary UTF-8 survives. Messages exceeding the payload ceiling are rejected before send rather than fragmented — Milestone 2's operations are small, and fragmentation would add reassembly state with no current caller.

Every request carries a correlation byte; responses echo it. Unmatched or malformed responses are dropped and logged, never guessed at. Each request has a timeout; on expiry the request rejects and the bridge marks itself disconnected rather than leaving a caller pending.

### Handshake decides capabilities

On connect, the bridge sends `hello` with its protocol version. The driver script replies with its protocol version, the Cubase version string, and the operation ids it implements. Version mismatch fails the connection with an explicit message naming both versions; it does not silently degrade. The adapter's `getCapabilities()` returns exactly what the handshake reported, mapped into the existing `Capability` shape, so the orchestrator's existing capability filtering and post-approval revalidation apply unchanged.

### Explicit adapter selection

The renderer offers Cubase Mock and Cubase Bridge as distinct choices. A bridge that fails to connect surfaces the failure and stays disconnected. Falling back to the mock would let a producer believe a real session changed when it did not — the precise failure Milestone 1's mock labeling exists to prevent.

### Polling, not push, for project state

The driver script answers `get_state` on request. Cubase's MIDI Remote API can push changes, but a push stream would need its own ordering and revision reconciliation. Milestone 2 reads state on demand and after each write, and increments the same `revision` field the mock uses, so Undo's existing conflict detection keeps working.

## Risks / Trade-offs

Live behavior cannot be verified in this repository's automated suite; the simulated peer verifies the protocol, not Cubase's interpretation of it. The driver script is verified by unit-testing its pure protocol functions in isolation, since Cubase's script host cannot be run headlessly. Manual verification steps are documented in the README, and the bridge reports its own connection state so a producer can tell a stalled bridge from a working one.

MIDI delivers no ordering guarantee across ports and no delivery guarantee at all. The correlation-plus-timeout design treats a lost response as a failed request rather than a silent success, which keeps a dropped write from being reported as applied.

## Migration Plan

Additive. The mock adapter, its tests, and the existing smoke path are untouched. The bridge is inert until a user selects it and installs the driver script into Cubase.
