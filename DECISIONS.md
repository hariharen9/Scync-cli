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
