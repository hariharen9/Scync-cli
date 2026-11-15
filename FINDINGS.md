# Scync CLI — Analysis & Findings

**Date:** 2026-11-15  
**Reference Snapshot:** `Scync` repository at commit `61b96af` (`v2.0.0-28-g61b96af`)  
**Purpose:** Pre-implementation findings covering Scync architecture, write side-effects, crypto model, auth mechanics, code reuse strategy, and analysis of open questions.

---

## 1. System Architecture & Boundaries

Scync is a zero-knowledge personal secrets manager designed for solo developers.
- **Frontend / Client:** React 18 + Vite PWA (`apps/web`), Zustand stores (`packages/ui`), domain logic (`packages/core`).
- **Backend:** Firebase Auth + Cloud Firestore only. There are **zero** server-side functions, Cloud Run containers, or custom backend services.
- **Security Boundaries:**
  1. *Authentication:* Firebase Auth (Google OAuth, Email/Password) authenticates the user and assigns a `uid`.
  2. *Access Control:* Firestore Security Rules scope all user subcollections to `/users/{uid}/**` with `request.auth.uid == uid`.
  3. *Zero-Knowledge Encryption:* Master password is never sent to the server. Derived key (`AES-GCM-256`) is generated in memory via PBKDF2 (SHA-256, 310,000 iterations). Plaintext is decrypted strictly client-side on demand and never persisted.

---

## 2. Crypto Model (`packages/core/src/crypto.ts`)

| Operation | Parameters & Method | Notes |
|---|---|---|
| **Salt Generation** | 16 cryptographically secure random bytes | Base64-encoded, stored in `/users/{uid}/meta/vault.salt` |
| **Key Derivation** | PBKDF2 (HMAC-SHA-256)<br>Iterations: `310,000`<br>Input material: `password + uid` (UTF-8)<br>Output: 256-bit AES-GCM `CryptoKey` (`usages: ['encrypt', 'decrypt']`, non-extractable) | Non-extractable in browser. In Node, standard `globalThis.crypto.subtle` supports identical WebCrypto parameters. |
| **Field Encryption** | AES-GCM 256-bit<br>IV: 12 random bytes (fresh per encryption)<br>Returns: `{ iv: base64, ciphertext: base64 }` | Authenticated encryption with 128-bit GCM tag automatically checked on decryption. |
| **Vault Verification** | Encrypts string `"Scync_VALID_v1"` with derived key | Stored in `/users/{uid}/meta/vault.verifier`. Checking decrypts this verifier: wrong password fails GCM tag check, returning `false`. **No hash is ever stored.** |
| **Recovery Key Derivation** | PBKDF2 (HMAC-SHA-256), `100,000` iterations<br>Input material: `normalizedRecoveryKey + uid` | Recovery key is 120-bit entropy formatted as `SCYNC-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`. Used to wrap master password in `/users/{uid}/meta/vault.recovery`. |

---

## 3. Explicit Inventory of Write Side-Effects

To satisfy Guiding Principle 2 (*"Write compatibility over cleverness"*), any write executed by the CLI must produce documents and records indistinguishable from those produced by the web app.

### 3.1 Secrets CRUD

#### A. Create Secret (`createSecret`)
1. Generate new document ID under `/users/{uid}/secrets/{newId}`.
2. Encrypt value: `encValue = await encrypt(key, formData.value)`.
3. Encrypt notes (if present): `encNotes = formData.notes ? await encrypt(key, formData.notes) : null`.
4. Create initial version:
   ```json
   {
     "version": 1,
     "encValue": { "iv": "...", "ciphertext": "..." },
     "createdAt": "<Date>",
     "changeType": "created"
   }
   ```
5. Write document:
   - `id`: `newId`
   - `name`: string
   - `service`: string
   - `type`: `SecretType` (e.g. `'API Key'`, `'Database URL'`, etc.)
   - `environment`: `Environment` (e.g. `'Development'`, `'Production'`, etc.)
   - `status`: `SecretStatus` (`'Active' | 'Rotated' | 'Expired' | 'Revoked'`)
   - `encValue`: `EncryptedField`
   - `encNotes`: `EncryptedField | null`
   - `lastRotated`: `Date | null`
   - `expiresOn`: `Date | null`
   - `projectId`: `string | null`
   - `remainingCodes`: `number | null`
   - `version`: `1`
   - `versions`: `[ initialVersion ]`
   - `createdAt`: `serverTimestamp()`
   - `updatedAt`: `serverTimestamp()`
6. Log to Activity Ledger (`logLedgerEvent`):
   - `action`: `'secret_created'`
   - `title`: `Created ${formData.name}`
   - `details`: `${formData.type} · ${formData.environment}`
   - `entityId`: `newId`
   - `entityName`: `formData.name`
   - `service`: `formData.service`
   - `version`: `1`

#### B. Update Secret (`updateSecret`)
1. Read existing document to obtain current `version` and `versions` array (fallback to `[v1]` if absent).
2. Calculate `nextVersion = currentVersion + 1`.
3. Detect change type:
   - If `explicitChangeType === 'restored'` -> `'restored'`
   - Else if `explicitChangeType === 'rotated'` or `formData.lastRotated != previous.lastRotated` -> `'rotated'`
   - Else -> `'updated'`
4. Append new `SecretVersion` object `{ version: nextVersion, encValue, createdAt: new Date(), changeType }`.
5. Bound versions: keep at most latest 10 versions (`versions.slice(versions.length - 10)`).
6. Update document at `/users/{uid}/secrets/{id}`:
   - Updates `name`, `service`, `type`, `environment`, `status`, `encValue`, `encNotes`, `lastRotated`, `expiresOn`, `projectId`, `remainingCodes`, `version: nextVersion`, `versions`, `updatedAt: serverTimestamp()`.
7. Log to Activity Ledger:
   - `action`: `secret_rotated` | `secret_restored` | `secret_updated`
   - `title`: `Rotated ${name}` | `Restored ${name} to v${nextVersion}` | `Updated ${name}`
   - `details`: `${service} · v${nextVersion}`
   - `entityId`: `id`, `entityName`: `name`, `service`: `service`, `version`: `nextVersion`

#### C. Restore Secret Version (`restoreSecretVersion`)
1. Locate target version by `targetVersionNumber` in `storedSecret.versions`.
2. Decrypt target version value using vault key.
3. Call `updateSecret` with `explicitChangeType = 'restored'`, `status = 'Active'`, and `lastRotated = new Date()`.

#### D. Delete Secret (`deleteSecret`)
1. Call `deleteDoc(doc(db, "users", uid, "secrets", id))`.
2. Log to Activity Ledger:
   - `action`: `'secret_deleted'`
   - `title`: `Deleted ${secretName || 'secret'}`
   - `details`: `service || ''`
   - `entityId`: `id`, `entityName`: `secretName`, `service`: `service`

### 3.2 Vault Activity Ledger Structure (`/users/{uid}/ledger/{entryId}`)
- Document fields:
  - `id`: string (doc ID)
  - `action`: `LedgerAction`
  - `title`: string
  - `details`: string
  - `entityId`: string
  - `entityName`: string
  - `service`: string
  - `version`: `number | null`
  - `timestamp`: `serverTimestamp()`
- In web app, ledger failures are caught and logged with `console.warn` without failing the main secret write. In CLI transactional writes, we should maintain consistent behavior while exploring transactional consistency.

---

## 4. Auth & Session Persistence Strategy

1. **Firebase in Node:**
   Node 20/24 natively supports standard JavaScript SDKs. We can use modular `firebase/app`, `firebase/auth`, and `firebase/firestore`.
2. **Email/Password Authentication:**
   Supported directly via `signInWithEmailAndPassword(auth, email, password)` without requiring any browser or redirection.
3. **Google Authentication:**
   - Web app uses `signInWithPopup(auth, googleProvider)`.
   - In terminal CLI, OAuth 2.0 loopback flow is standard:
     1. Open system browser to Google OAuth consent URL.
     2. Temporary HTTP server listening on `127.0.0.1:<port>` captures callback `code`.
     3. Code exchanged for Google tokens (`id_token`, `access_token`).
     4. Firebase Auth `signInWithCredential(auth, GoogleAuthProvider.credential(idToken, accessToken))` signs in the user.
4. **Session Persistence:**
   The Firebase User object holds `stsTokenManager` with `refreshToken`, `accessToken`, and `expirationTime`. Storing the refresh token securely in the OS credential store (Windows Credential Manager / macOS Keychain / Linux Secret Service via `keytar` or safe file fallback) allows headless session restoration via Firebase Auth REST API or custom token refresh.

---

## 5. Code Reuse & Porting Strategy

Per Spec §1.1 and §6.1:
- `Scync\` is strictly read-only.
- `scync-cli\` is an independent npm/TypeScript project.
- Reused modules from `Scync/packages/core/src/` (`crypto.ts`, `types.ts`, `constants.ts`, `firestore.ts`, `recovery.ts`, etc.) are copied into `scync-cli/src/core/`.
- **Adaptations made:**
  1. Remove browser/Vite-specific `import.meta.env` dependencies.
  2. Accept Firebase `app`, `auth`, and `db` via explicit initialization or context injection.
  3. Ensure compatibility with Node 20+ runtime (using native `globalThis.crypto.subtle`, `btoa`, `atob`, `TextEncoder`, `TextDecoder`).
  4. Maintain exact logic, function signatures, iteration counts, and document shapes to prevent cryptographic and data drift.
- All copied files are logged in `PROVENANCE.md`.

---

## 6. Answers to Open Questions (Spec §15)

1. **Desktop-type OAuth credential & UID match:**
   In Google Cloud / Firebase Auth, user identities are keyed on `providerId: 'google.com'` and the Google user ID (`sub`). When a Google ID token from any authorized OAuth client ID in the same Google Cloud project is passed to `GoogleAuthProvider.credential(idToken)`, Firebase resolves it to the exact same Firebase Auth `User` and `uid`. This is verified in Phase 0.
2. **Headless sign-in (SSH / no browser):**
   Google's OAuth policies require browser consent and restrict device flow for Google Identity. For headless machines, email/password sign-in is the cleanest zero-browser option. Alternatively, a session transfer mechanism (`scync auth export-session` / `import-session`) can safely copy the session refresh token without needing browser access on the server.
3. **Core environment-independence:**
   `crypto.ts` uses WebCrypto which Node 20+ implements natively. `firebase.ts` had Vite env variables; by abstracting Firebase config injection, the core logic is 100% environment-independent.
4. **True set of side effects on secret write:**
   Fully documented in §3 above: version counter increment, bounded versions array (max 10), timestamps, and activity ledger entries.
5. **Firestore Transaction for version check & update:**
   Firestore transactions support `tx.get(ref)` followed by `tx.update(ref, ...)` and `tx.set(ledgerRef, ...)`. This enables atomic version checking to eliminate lost updates.
6. **Security Rules:**
   Current `firestore.rules` enforces `request.auth.uid == uid` for `/users/{uid}/**`. CLI operations acting under the authenticated user's token have full read/write access to their own subcollections.
7. **Firebase client configuration:**
   Default configuration for official project is bundled with CLI defaults; overridable via environment variables (`SCYNC_FIREBASE_API_KEY`, etc.) or `scync config` file for self-hosters.
8. **Agent: key material vs crypto proxy:**
   Having the background agent hold the derived `CryptoKey` in memory and perform encryption/decryption requests over a secure IPC pipe (Windows Named Pipe / Unix Domain Socket with owner-only ACLs) is superior to handing raw key material to every CLI invocation.
9. **Data hygiene quirks:**
   - Secret names can collide across or within projects. CLI must support disambiguation by `--id`, `--project`, and `--env`.
   - Deleting a project leaves orphaned `projectId` references. The CLI must handle secrets with non-existent or null project IDs gracefully.
   - Values may contain multi-line text, JSON, or special characters; raw export mode must not append extraneous newlines or ANSI codes.

---

## 7. Phase 0 Feasibility Spike — Results & Milestone Report

**Status:** Completed & Verified (GO)

### Verified Capabilities:
1. **Node 20+ Runtime Compatibility:**
   Node 24 native WebCrypto (`globalThis.crypto.subtle`) supports the complete PBKDF2 (SHA-256, 310,000 iterations) and AES-GCM (256-bit, 12-byte IV) crypto pipeline without polyfills.
2. **Cross-Client Cryptographic Compatibility:**
   Verified directly against `Scync/packages/core/src/crypto.ts` in automated test `cross-compat.test.ts`. Ciphertext encrypted by the CLI is decryptable by the reference web core and vice versa. Verifier `"Scync_VALID_v1"` matches identically.
3. **Authentication & Session Pipeline in Node:**
   Firebase Auth in Node successfully authenticates users, persists sessions, and returns the exact user `uid`.
4. **Firestore Vault Metadata & Zero-Knowledge Verification:**
   Verified end-to-end against the Firebase emulator suite in `vault-pipeline.emulator.test.ts`:
   - Vault initialization (`/users/{uid}/meta/vault`).
   - Salt and verifier storage & retrieval.
   - Master password key derivation + verifier validation.
   - Wrong master password rejection without state leakage.
5. **Write Compatibility & Versioning Contract:**
   - Document structure, `version` increment (v1 -> v2), bounded `versions` array (max 10), and `changeType` (`created`, `updated`, `rotated`, `restored`) match the web application.
   - Activity ledger events (`/users/{uid}/ledger`) are recorded consistently with correct timestamps and metadata.

