# Architecture & Engineering Decisions Log

This log tracks architectural and design decisions made during the development of `scync-cli`, along with rationale and context.

---

## 2026-11-15: Initial Architecture & Phase 0 Setup

### Decision 1: Project Structure and Runtime
- **Context:** Standalone CLI project in `scync-cli\` targeting Windows, macOS, and Linux. Spec requires Node LTS compatibility.
- **Decision:** Use TypeScript with modern ES modules (`type: "module"` in `package.json`), targeting Node 20+. Build with `tsup` or `esbuild` for fast, clean bundling.
- **Rationale:** Node 20+ has complete native WebCrypto (`globalThis.crypto.subtle`), `fetch`, and ES module support. This eliminates the need for polyfills (`node-webcrypto-p11` or subtle shims) and guarantees cryptographic consistency with the web app.

### Decision 2: Core Module Decoupling via Dependency Injection
- **Context:** `Scync/packages/core` directly imports from `./firebase`, which reads `import.meta.env` (Vite-only).
- **Decision:** Re-architect ported core functions in `src/core/` to either accept an explicit Firebase `db`/`auth` instance or access a shared runtime context initialized at CLI startup.
- **Rationale:** Allows unit and emulator integration tests to easily inject emulator instances, switch projects, or mock dependencies cleanly without modifying the core domain logic.

### Decision 3: Phase 0 Verification Approach
- **Context:** Spec §14 mandates Phase 0 feasibility spike: prove sign-in yields identical UID, read vault metadata, derive key with master password, and decrypt verifier.
- **Decision:** Build an emulator test suite as well as a CLI spike script. The automated test suite starts/targets the Firebase Auth and Firestore emulators to prove the entire pipeline deterministically.

---

## 2026-11-15: Phase 1 — Read-Only Core Implementation

### Decision 4: Session Storage & Token Refresh
- **Context:** Spec §8.1 requires session persistence across CLI invocations via refresh tokens, transparent refresh, and graceful handling of revoked sessions.
- **Decision:** Store session in `~/.scync/session.json` (mode 0600 on POSIX, protected by `%USERPROFILE%` ACLs on Windows). If token is expiring within 2 minutes, refresh it via Google's token endpoint (`https://securetoken.googleapis.com/v1/token`) and update credentials on disk. If refresh fails, clear session and return exit code 2 (`AUTH_REQUIRED`).

### Decision 5: Non-Blocking Detached Clipboard Auto-Clear
- **Context:** Spec §8.4 requires clearing the clipboard after 30 seconds if it still holds what was copied. A foreground sleep would hold the user's terminal prompt hostage for 30 seconds.
- **Decision:** Implement `copyWithAutoClear` which copies immediately, then spawns an unreferenced, detached background node process (`bg.unref()`) that sleeps 30 seconds, reads the clipboard, compares it against the copied secret, and clears it only if unmodified. The CLI process exits immediately with zero latency.

### Decision 6: Stdout vs Stderr Stream Discipline
- **Context:** Developers frequently pipe secrets: `scync get X | pbcopy`, `scync pull > .env`.
- **Decision:** Strictly enforce stdout cleanliness:
  - Prompts ("Enter master password:") and warning messages are written to `stderr`.
  - In pipe mode (`!stdout.isTTY` or `--raw`), `scync get` writes ONLY the raw secret to `stdout` with no trailing newline or ANSI colors.

---

## 2026-11-15: Phase 2 — Writes, Conflicts & Import Implementation

### Decision 7: Optimistic Concurrency and Transactional Writes
- **Context:** Spec §6.3 and §8.5 mandate safe concurrent edits across Web and CLI clients with conflict detection (exit code 6).
- **Decision:** Encrypt secret payloads *before* initiating the Firestore transaction to minimize lock time. In `runTransaction`, verify the current document version against expected version. If mismatched and `--force` is not passed, abort with `ConflictError` (exit code 6).
- **Rationale:** Guarantees atomicity between version verification and Firestore write, preventing race conditions without holding client-side crypto inside the transaction lifecycle.

### Decision 8: Secret Input Vectors & Leak Prevention
- **Context:** Secrets can be provided interactively or non-interactively in CI/CD pipelines and scripts.
- **Decision:** Provide a unified `resolveSecretValue` helper with priority: stdin pipe > `--file` > `--value` > hidden prompt. When `--value` is used, emit a security warning to `stderr` advising against command-line arguments in shell history.

### Decision 9: Push / Import Dry-Run & Fault Tolerance
- **Context:** Spec §8.7 defines `scync push` for importing `.env` files into Scync.
- **Decision:** Parse variables with `parseEnvFile`, infer services automatically, and provide `--dry-run` mode that compares with remote state without decrypting or modifying Firestore. In live mode, log each imported item and record ledger events with rollback safety.

---

## 2026-11-15: Phase 3 — Agent, Key Custody, Process Injection & Watch

### Decision 10: Local Agent IPC Transport & OS User Isolation
- **Context:** Spec §8.2 mandates a short-lived local background agent (in the style of `ssh-agent`) holding unlocked keys in memory across short CLI invocations, compatible with Windows, macOS, and Linux.
- **Decision:** Use native Node `net` module with platform-specific secure endpoints:
  - Windows: Named Pipe (`\\.\pipe\scync-agent-<uid or username>`), secured by Windows user access control tokens.
  - POSIX: Unix Domain Socket (`~/.scync/agent-<uid>.sock`), created with directory permissions `0700` and socket mode `0600`.
- **Rationale:** Native OS IPC avoids any external native dependencies, executes in sub-millisecond roundtrips, and prevents cross-user access on multi-user systems.

### Decision 11: Remote Agent Crypto vs Key Exposure
- **Context:** Spec §8.2 asks to decide whether the agent hands out key material or performs crypto on behalf of clients, preferring the design that exposes the least.
- **Decision:** The agent performs encryption, decryption, and batch decryption directly inside its process memory. The native non-extractable WebCrypto `CryptoKey` never leaves the agent's memory and is never transmitted over IPC.
- **Rationale:** If any client CLI command or subshell is compromised, the attacker cannot dump the master key. Client processes interact solely via `ENCRYPT`, `DECRYPT`, and high-throughput `BATCH_DECRYPT` messages.

### Decision 12: In-Memory Key Eviction & Idle Timeouts
- **Context:** Spec §8.2 requires configurable idle timeouts, max lifetimes, explicit locking, and logout eviction.
- **Decision:** Default idle timeout is 15 minutes (configurable via `scync config set agent.timeout <duration>`), refreshed upon every crypto operation. Absolute maximum lifetime is 8 hours. On timeout, explicit `scync lock`, or `scync logout`, the agent zeroes all key references, closes the socket, and terminates.

### Decision 13: Direct Subprocess Injection (`scync run`)
- **Context:** Spec §8.7 requires running commands with secrets injected into their environment without writing plaintext files to disk.
- **Decision:** Secrets matching the project/environment filter are decrypted directly into memory and passed as the `env` dictionary to `child_process.spawn`. Signals (`SIGINT`, `SIGTERM`) and exit codes are forwarded 1:1. Executables are invoked directly without wrapping in shell interpreters unless explicitly a `.cmd`/`.bat` script, avoiding shell-history and command-line leaking.

### Decision 14: Real-Time Firestore Sync Stream (`scync watch`)
- **Context:** Spec §8.6 requires observing real-time changes across web and CLI edits.
- **Decision:** Use Firestore's `onSnapshot` listener on the user's secrets collection, calculating local diffs (added, modified, deleted) against an in-memory cache to prove real-time sync with minimal read overhead.

---

## 2026-11-15: Phase 4 — Specialized Data Types & Polish

### Decision 15: Specialized Data Type Commands Architecture
- **Context:** Spec §8.8-§8.11 mandates tailored workflows for TOTP codes, SSH keys, login passwords, and TLS certificates.
- **Decision:** Implement dedicated subcommands:
  - `scync totp [name]`: Generates live RFC 6238 6-digit codes with remaining seconds indicator; supports `--copy` with 30s auto-clear.
  - `scync ssh [ls|get|export|config]`: Manages SSH keys, prints public keys or fingerprints, exports private/public key pairs with restrictive permissions (`0600` / `0644`), and generates drop-in `~/.ssh/config` host blocks.
  - `scync passwords [ls|get]`: Masked view of credentials (`••••••••`), `--reveal` flag for plaintext, `--copy` with 30s auto-clear.
  - `scync certs [ls|show]`: X.509 certificate inspection, validity periods, expiry status, issuer, and SAN hostnames.
- **Rationale:** Keeps high-frequency developer tasks fast and safe without manually grepping or parsing raw secret blobs.

### Decision 16: Safe File Export & Mode Clamping
- **Context:** Spec §8.9 mandates exporting SSH private keys with `0600` permissions.
- **Decision:** In `scync ssh export`, write private keys with explicit `mode: 0o600` and public keys with `mode: 0o644`. On Windows platforms where POSIX modes are limited, rely on Node's filesystem permissions while ensuring the command warns if written to insecure directories.




