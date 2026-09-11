## 1. Storage

- [x] 1.1 Encrypt a key through the OS credential store and persist only the ciphertext.
- [x] 1.2 Refuse to store when the platform reports no encryption available, rather than writing plaintext.
- [x] 1.3 Report stored state and the last four characters only; never the key.
- [x] 1.4 Support replacing and removing a stored key.
- [x] 1.5 Test round trip, refusal without encryption, masking, removal, and that the key never reaches a snapshot.

## 2. The keyed provider

- [x] 2.1 Implement an OpenAI transport with the shared provider contract, tool calling, cancellation, and typed failures.
- [x] 2.2 Route its tool calls through the existing registry and permission engine.
- [x] 2.3 Bound the tool-call loop and report a refusal from the provider as a typed failure.
- [x] 2.4 Test a transcript round trip, a tool call, a bounded loop, cancellation, and an unauthorized key.

## 3. Interface

- [x] 3.1 Add, replace, and remove a key, with the provider shown as connectable only when one is stored.
- [x] 3.2 State that a keyed session sends conversation content to the provider.
- [x] 3.3 Never display the key after it is entered.

## 4. Acceptance

- [x] 4.1 Run typecheck, lint, formatting, tests, build, and every smoke workflow.
- [x] 4.2 Verify a key survives a restart, that the interface never receives it, and that diagnostics redact it.
- [x] 4.3 Document where a key lives, what it is used for, and what is out of scope.
