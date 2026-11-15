# Code Provenance Log

This file tracks every module ported or copied from the reference repository (`E:\Projects\scync-source\Scync\`) into `scync-cli\`.

**Reference Baseline:**  
- **Commit:** `61b96af` (`feat: add zero-knowledge Emergency Recovery Kit and update documentation`)
- **Tag:** `v2.0.0-28-g61b96af`
- **Location:** `E:\Projects\scync-source\Scync\`

---

| Target Path in `scync-cli\` | Source Path in `Scync\` | Baseline Commit | Changes Made & Rationale |
|---|---|---|---|
| `src/core/types.ts` | `packages/core/src/types.ts` | `61b96af` | None (direct port of domain types). |
| `src/core/constants.ts` | `packages/core/src/constants.ts` | `61b96af` | None (direct port of metadata constants). |
| `src/core/crypto.ts` | `packages/core/src/crypto.ts` | `61b96af` | Preserved all WebCrypto PBKDF2/AES-GCM params and verifier constants (`Scync_VALID_v1`). Uses Node 20+ native `crypto.subtle`, `btoa`, `atob`. |
| `src/core/recovery.ts` | `packages/core/src/recovery.ts` | `61b96af` | Ported recovery key normalization and PBKDF2 derivation. Removed browser-oriented QR code generation if unneeded in CLI. |
| `src/core/firestore.ts` | `packages/core/src/firestore.ts` | `61b96af` | Refactored Firebase dependency injection so `db` is passed or provided via a configured context rather than hardcoded global singleton with Vite envs. Maintained exact document shapes, versioning limits (10 items), and ledger events. |
| `src/core/firebase.ts` | `packages/core/src/firebase.ts` | `61b96af` | Replaced Vite `import.meta.env` with node config/environment variables (`process.env`) and modular initialization. |
