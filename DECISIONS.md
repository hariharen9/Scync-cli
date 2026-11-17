# Architecture & Engineering Decisions Log

This log tracks architectural and design decisions made during the development of `scync-cli`, along with rationale and context.

---

## 2026-11-17: Correctness, DX & Configuration Hardening

### Decision 17: Fix Commander negatable option handling
- **Context:** `--no-agent` and `--no-browser` were declared with Commander's negatable syntax, which populates `agent: false` / `browser: false`, but every command read `options.noAgent` / `options.noBrowser`. Both flags were silently ignored, so the agent-free/paranoid mode was unreachable.
- **Decision:** Normalize at the CLI boundary (`noAgent: opts.agent === false`, `noBrowser: opts.browser === false`) for `login`, `unlock`, `run`, `watch`, `totp`, `ssh`, `passwords`, and `certs`. Command functions keep accepting `noAgent`/`noBrowser` so direct callers and tests are unaffected.

### Decision 18: Honest agent/custody reporting
- **Context:** `unlock` always claimed a background agent was holding the key even when daemon startup silently failed, and `lock` always claimed termination because `AgentClient.lock()` swallowed connection errors.
- **Decision:** Query `STATUS` before/after and report the real custody state. `unlock` warns when only an in-process session exists (key discarded on exit); `lock` differentiates "already locked, stopping idle daemon" from "terminated".

### Decision 19: Apply existing configuration keys
- **Context:** `default.project`, `default.env`, and `clipboard.timeout` were documented and stored but never read outside `run`.
- **Decision:** Add `getDefaultScope()` and `getClipboardTimeoutSecs()`. Bulk commands (`ls`, `pull`, `push`, `watch`, `run`) use the default scope when no explicit flag is passed; clipboard copy paths (`get`, `passwords`, `totp`) honor the configured timeout, including `0` to disable auto-clear.

### Decision 20: Import/export integrity
- **Context:** `scync push` could create duplicate secrets when a `.env` repeated a key, normalized `--type` was shadowed per-item, and `--force` was accepted by `updateSecret` but never exposed. `scync pull -o <file>` (without a positional file) discarded every option because Commander passes `(undefined, options)` and the command only inspected the first argument. `scync pull` could also silently emit colliding variable names and did not record exports.
- **Decision:** Deduplicate parsed entries with last-value-wins, normalize `--type` once, wire `push --force`, handle both `pull` call shapes, and warn on export key collisions. File exports now append the existing `env_exported` ledger event.

### Decision 21: Type safety and output hygiene
- **Context:** `tsc --noEmit` failed in seven places; `watch` compared a non-existent `nonce` field so ciphertext-only changes could be missed; several table renderers printed untrusted vault strings without sanitization; `maxWidth`-style column options were dead.
- **Decision:** Restore a clean typecheck, compare `EncryptedField.iv`/`ciphertext`, sanitize names/hosts/URLs/services in human-facing output, and implement `minWidth` in `renderTable`. `--no-color` behavior remains delegated to `picocolors`/`NO_COLOR`.
- **Validation:** `npm run typecheck`, `npm test` (43/43), and `npm run test:emulator` (69/69) all pass. Two stale emulator assertions were corrected: `show --json` now explicitly uses `--reveal` (masked by default), and the TOTP grouping regex allows the intentional double space.

### Decision 22: Guaranteed one-shot process exit
- **Context:** `runCli` replaced its original `process.exit(0)` with `await closeFirebase()`, but a restored Firebase Auth session keeps a ref'd token-refresh timer alive. Authenticated commands such as `unlock` therefore printed their result and then hung until Ctrl+C, while unauthenticated commands like `lock` exited normally.
- **Decision:** After `closeFirebase()`, flush `stdout`/`stderr` (so `get --raw | ...` and `pull > .env` cannot truncate) and explicitly exit for one-shot commands. `watch` and `_agent-daemon` remain long-lived. Verified under the Auth emulator: `unlock` exits in ~0.95s (including agent spawn) and `lock` in ~0.35s.

### Decision 23: First-party full-screen TUI in `src/tui/`
- **Context:** The command surface is powerful but discoverability and browsing suffer in a line-oriented CLI. The user asked for a web-like terminal interface supporting the full vault while keeping the existing commands unchanged.
- **Decision:** Build a separate, self-contained `src/tui/` app exposed through one new `scync tui` / `scync ui` command. No third-party TUI framework: a cell-grid `Buffer` (character + fg/bg/attributes), a row-diffing `Terminal` (alternate screen, raw mode, bracketed paste, suspend/resume), and ANSI-aware width/wrapping/sanitisation. Views cover dashboard, secrets (CRUD/rotate/restore/filters/sort/search), projects (CRUD), passwords, TOTP, SSH, certificates, tools (`.env` export/import, run command) and settings (identity/vault/agent/config). The TUI calls the same auth, vault-session, crypto, agent and Firestore modules as the CLI; it never re-implements crypto.
- **Security:** values remain masked by default, are decrypted only on explicit reveal/copy/edit/view, auto-hide after 15s, and all plaintext caches/revealed values/decrypted TOTP secrets are cleared on lock and exit. Clipboard uses the existing detached auto-clear worker. Writes use the existing optimistic version checks, so concurrent web edits surface as conflicts.
- **Compatibility:** The existing command implementations were not modified. `core/firestore.ts` gained additive `createProject`, `updateProject` and `deleteProject` ports from the reference snapshot for the Projects view. TUI tests render every view at wide/compact sizes and exercise key routing, search, forms, selects and modals headlessly.
- **Platform:** truecolor/256/16/no-colour detection (including Windows Terminal), optional ASCII borders, and mandatory terminal restoration on quit, signals and render failures.

### Decision 24: Terminal input disambiguation and navigation
- **Context:** The first TUI build held a lone `ESC` because it was also a valid prefix of the bracketed-paste marker, so Escape never reached the UI. On Windows, libuv delivers arrows as `ESC [ A`-style sequences and may split them across reads. The startup unlock modal also captured arrows, making the list feel unnavigable.
- **Decision:** Treat a lone `ESC` as pending for ~40 ms; deliver Escape if no more bytes arrive, otherwise reassemble the sequence. Partial paste-marker prefixes are discarded on timeout instead of typed. `Esc` is now a universal back action (modal → detail → search/filter → view history). `←`/`→` switch views, `↑`/`↓` move lists, `Enter` opens, `Tab` switches panes. The startup unlock prompt is no longer modal; metadata browsing is available while locked, and decrypt actions prompt on demand.
- **Validation:** New parser tests cover lone Escape, arrows split after `ESC`, and arrows split inside the CSI prefix; interaction tests cover arrow selection, Escape-from-detail, and Escape view-history back.

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
- **Decision:** Parse variables with `parseEnvFile`, infer services automatically, and provide `--dry-run` mode that compares with remote state without decrypting or modifying Firestore. In live mode, log each imported item with optimistic concurrency safety and record ledger events.

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
- **Decision:** Default idle timeout is 15 minutes (configurable via `scync config set agent.timeout <duration>`), refreshed upon every crypto operation. Absolute maximum lifetime is 8 hours. On timeout, explicit `scync lock`, or `scync logout`, the agent dereferences key objects, closes the socket, and terminates (subject to V8 garbage collection behavior; same-user process memory inspection is outside node's sandbox model).

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




