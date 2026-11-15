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

