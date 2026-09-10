## 1. Transport boundary

- [x] 1.1 Define the MIDI transport interface for port listing, open, close, send, and message subscription, with typed unavailable and failure results.
- [x] 1.2 Implement the in-process loopback transport pairing two endpoints for verification without hardware.
- [x] 1.3 Implement the platform transport with lazy backend loading, keeping the MIDI backend out of the default install and out of build/smoke paths.
- [x] 1.4 Test backend-absent behavior, port listing, open/close lifecycle, and delivery over loopback.

## 2. Bridge protocol

- [x] 2.1 Implement SysEx framing with protocol version, kind, correlation, length, checksum, and 7-bit payload encoding.
- [x] 2.2 Implement encode/decode for handshake, state read, and command request/response payloads with bounded sizes.
- [x] 2.3 Implement the request layer with correlation matching, per-request timeouts, and disconnect on expiry.
- [x] 2.4 Test round trips, checksum failures, unknown kinds, truncated frames, unmatched correlations, oversized payloads, and timeout-driven disconnect.

## 3. Handshake and capabilities

- [x] 3.1 Implement the connect handshake exchanging protocol versions and receiving the Cubase version and implemented operation ids.
- [x] 3.2 Map reported operations into the shared capability shape, failing connection on protocol mismatch with both versions named.
- [x] 3.3 Test compatible handshake, mismatch, partial capability sets, and refusal of unreported operations on direct call.

## 4. Live adapter

- [x] 4.1 Implement the Cubase bridge adapter against the shared DAW adapter contract for connect, disconnect, capabilities, state read, and execution.
- [x] 4.2 Report non-mock project state with a revision that advances on every applied write, preserving Undo conflict detection.
- [x] 4.3 Implement disconnected, timeout, and failed-write outcomes that never report an unconfirmed write as applied.
- [x] 4.4 Build the simulated Cubase peer speaking the real protocol and test the adapter end to end over loopback.

## 5. Cubase driver script

- [x] 5.1 Write the MIDI Remote driver script implementing the protocol against the Cubase MIDI Remote API for tempo and transport.
- [x] 5.2 Extract the script's encoding/decoding logic so it can be exercised outside Cubase and test parity with the host implementation.
- [x] 5.3 Document installation location, port pairing, targeted Cubase versions, and the manual verification procedure.

## 6. Application integration

- [x] 6.1 Add explicit adapter selection through the runtime control channel without exposing adapter switching to agents.
- [x] 6.2 Drive tool exposure from the connected adapter's handshake report and revalidate after approval.
- [x] 6.3 Build bridge connection setup with port detection, handshake status, connected version, unavailable backend reason, and failure states.
- [x] 6.4 Show live-versus-mock session identity in the workspace and never substitute the mock for a failed bridge.
- [x] 6.5 Handle mid-session bridge loss: disable writes, invalidate pending approvals, preserve history, and require explicit reconnection.

## 7. Acceptance

- [x] 7.1 Run typecheck, lint, formatting, unit and integration tests, production build, and the existing Electron smoke workflow unchanged.
- [x] 7.2 Extend the smoke workflow to cover bridge selection with no backend available and explicit mock selection alongside it.
- [x] 7.3 Document the bridge architecture, protocol, driver installation, limitations, and the deferred live and Windows verification in the README.
