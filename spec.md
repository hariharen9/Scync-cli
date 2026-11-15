# Scync CLI — Product & Engineering Spec

> Audience: an AI coding agent (and the human supervising it).
> This spec says **what** to build and **why**. It deliberately does not dictate code. Wherever it says
> "discover", read the existing Scync repo and follow what it actually does. The repo is the source of truth;
> this document describes intent and constraints.

---

## 1. Summary

Build **`scync`**, a command-line client for the existing Scync zero-knowledge secrets manager.

A developer signs in with the **same account** they use on the web app, unlocks with the **same master
password**, and can then list, read, create, update, rotate, import and export their secrets from a terminal. Every
change made in the CLI appears in the web app, and every change made in the web app is visible to the CLI. There is
no new backend, no new account system and no new data format. The CLI is another client of the same Firebase
project.

The goal is to turn Scync from "a website I open to copy a key" into "a tool that is wired into my actual dev
workflow": `scync pull > .env`, `scync run -- npm start`, `scync get STRIPE_KEY | pbcopy`.

### 1.1 Workspace layout for initial development

For initial development the human has set up a parent folder containing two sibling folders:

```
E:\Projects\scync-source\
├── Scync\        # a copy of the existing Scync web app repo: REFERENCE / COPY SOURCE ONLY
└── scync-cli\    # empty folder: the new CLI is built here, as its own independent project
```

How the agent must treat them:

- **`Scync\` is read-only reference.** Read it to learn how the system works (crypto, Firestore layer, types, stores,
  write behavior, rules, emulator setup). Do **not** edit, refactor, reformat, run installs in, or commit to it. It is
  a snapshot to learn from and copy from, not a workspace.
- **`scync-cli\` is the only place code is written.** It starts empty and is a standalone project with its own
  `package.json`, lockfile, tests and git history. Everything the CLI needs must live inside it.
- **Reuse means copying, deliberately.** Because the CLI is not inside the web app's monorepo, it cannot import
  `@scync/core` through a workspace link. Where the existing logic must be reused (key derivation, encrypt/decrypt,
  type definitions, secret write semantics, `.env` handling, TOTP, SSH helpers), the agent should copy the relevant
  modules into the CLI, adapt them minimally so they run in Node with an injected Firebase instance instead of browser
  and Vite assumptions, and keep them as close to the originals as possible so differences stay auditable.
- **Track provenance.** For every copied or ported module, record in a `PROVENANCE.md` (or similar) the original path
  in `Scync\`, what was changed and why, and the reference snapshot it came from (the repo's last commit/tag if
  discoverable). This is how future drift between the web app and the CLI gets detected and fixed.
- **Drift is the main cost of this layout**, so the cross-client compatibility tests in §13 become mandatory rather
  than nice-to-have. They should be able to run against the reference copy's logic to prove the CLI reads and writes
  data the web app's own code accepts. (Running the reference code in a test harness, without modifying it, is fine.)
- **Environment:** the human develops on **Windows** (PowerShell). Paths, line endings, file permissions, the agent's
  IPC transport and the OS credential store must all work properly on Windows from the first commit, not as a later
  port. macOS and Linux still need to work.
- **Firebase configuration:** any Firebase project config the CLI needs comes from the reference repo's documented
  environment settings (see its `.env.example`). Use the emulator for development and tests. Never put real
  credentials into the repo.

## 2. Why this exists

The web app solves storing and finding secrets. It does not solve **using** them where developers actually work:

- Developers keep `.env` files, run scripts, SSH into servers and configure CI in terminals. Copying from a browser tab
  to a terminal is the friction Scync's own roadmap lists as its single biggest gap.
- A vault that only works in a browser stays a place secrets are *stored*, not a source secrets are *consumed from*.
  A CLI closes that loop and removes the incentive to leave plaintext `.env` files lying around.
- The project's own principle is "unlock → find → copy" as fast as possible. A terminal version of that loop
  should be faster than opening a browser.

Success means a Scync user can stop keeping plaintext `.env` files for local development and rely on the vault.

## 3. Goals

1. **Same identity.** Sign in with the same Google (or email/password) account as the web app, resolving to the same
   Firebase user id, so the CLI sees exactly the same vault.
2. **Same vault.** Unlock with the existing master password. No separate CLI password, no re-encryption, no migration.
3. **Full read access** to the developer-facing data: secrets first, then optionally passwords, SSH keys, TOTP
   tokens and certificates (see phasing).
4. **Safe write access** for secrets: create, update, rotate, delete, restore a version, all producing data that the web
   app treats as if it had written it itself (versions, status, dates, activity ledger).
5. **Two-way sync.** Writes from the CLI show up in an open web session in near real time. The CLI can observe web
   changes.
6. **Dev-workflow commands.** Export to `.env`, import from `.env`, and run a command with secrets injected as
   environment variables without ever writing them to disk.
7. **Preserve zero-knowledge.** All encryption and decryption happens on the user's machine. The server must never
   receive plaintext, the master password, or the derived key.

## 4. Non-goals

- No new backend, no Cloud Functions, no server component, no new database or collections. (The one possible exception
  is described in Open Questions; do not build it without a decision.)
- No team or multi-user features; Scync is a personal-vault product.
- No secrets rotation against third-party APIs. Scync tracks rotation dates; it does not call provider APIs.
- No browser autofill or credential injection into other apps.
- No biometric (WebAuthn) unlock in the CLI. It is a browser feature. Do not try to emulate it.
- No changes to the web app's behavior or data format. If something in the web app must be touched (see §6.1), it
  must be a behavior-preserving refactor.
- Not a CI/CD secret injector in v1. (A future token-based mode is out of scope here.)

## 5. Background: what the existing system is

Study the repo before designing anything. The facts below were verified from the code at the time of writing, but
**re-verify them**; things like recovery, versioning and the ledger postdate parts of the repo's own `AGENTS.md`, so
treat that file as a map, not truth.

**Architecture.** A TypeScript monorepo: a React/Vite PWA (`apps/web`), a framework-agnostic domain library
(`packages/core`: crypto, Firestore CRUD, types), and a UI/store package (`packages/ui`). Firebase Auth + Firestore
are the only backend. There is no server code.

**Three layers of access.**
1. *Login* (Google or email/password through Firebase Auth) proves identity only.
2. The *master password* is the real cryptographic key and is separate from the login. It is never stored.
3. *Authorization* is Firestore security rules scoping everything under `users/{uid}` to that same uid.

**Crypto model (discover exact parameters in `packages/core`).** The master password plus the user id and a stored
salt derive a non-extractable AES-GCM key through PBKDF2. Individual fields are encrypted with AES-GCM and stored as
an IV plus ciphertext pair. Vault correctness is checked by decrypting a stored verifier, not by comparing a hash.
Plaintext is decrypted on demand and never persisted.

**Data model.** Per-user subcollections hold secrets, passwords, SSH keys, TOTP tokens, certificates, projects,
custom services and an activity ledger, plus one vault-metadata document. Sensitive fields are encrypted; names,
services, types, environments, dates and similar metadata are plaintext so the UI can filter without decrypting.
Secrets also carry a bounded version history and a version counter. Many writes also append to the activity ledger.

**Other unlock paths that exist in the web app** (biometric wrapping, emergency recovery key) are described in
`packages/core`. Understand them; the CLI will use at most the recovery path (see §8.3).

## 6. Guiding principles

These resolve most ambiguity. When in doubt, pick the option that better satisfies the earlier principle.

1. **Never leak plaintext.** No plaintext secret, master password or derived key may reach the server, logs, crash
   reports, shell history by default, temp files, or telemetry. There is no telemetry.
2. **Write compatibility over cleverness.** A record written by the CLI must be indistinguishable, to the web app,
   from one the web app wrote. If the CLI cannot produce a fully compatible write for some operation, it must not
   offer that operation.
3. **No silent data loss.** Concurrent edits from the web app and the CLI must never silently overwrite one another.
4. **One crypto implementation.** Do not reimplement cryptography. Reuse the existing core logic so the two clients
   cannot drift. (See §6.1.)
5. **Secure by default, convenient on request.** Masked output by default; explicit flags to reveal. Short-lived key
   custody by default; explicit opt-in for anything longer.
6. **Scriptable and humane.** Works well interactively and in pipes/scripts: stable exit codes, machine-readable
   output option, no prompts when stdin is not a TTY unless asked.
7. **Fast.** The core loop (get a secret) should feel instant once unlocked.

### 6.1 Code reuse decision (read carefully)

The strongest way to guarantee write compatibility is to import the existing `@scync/core` package rather than
re-implement its logic. Currently that package is built around a browser-oriented Firebase initialization that reads
Vite environment variables.

**Current decision (see §1.1):** the CLI is built in its own folder, `scync-cli\`, separate from the reference copy
in `Scync\`, which must not be modified. So the approach is to **copy and adapt** the needed core logic into the CLI
project, with the Firebase app/database injected by the caller rather than read from Vite environment variables, and
to keep each copied module as close to the original as possible. Every copied module is recorded in a provenance
file (§1.1), and the compatibility tests in §13 are mandatory and run continuously because this layout carries a
standing risk of drift.

Longer term, the cleaner option is to extract a shared, environment-independent core package that both the web app and
the CLI consume. That would mean a behavior-preserving refactor in the web repo, which is explicitly **out of scope
for now**. The agent should note in its findings what such a refactor would involve, so the human can decide later,
but must not start it.

The CLI must remain a separate, independently installable app regardless of how code is shared.

---

## 7. Users & primary scenarios

The user is an individual developer who already has a Scync vault.

- **Daily local dev:** `scync pull --project myapp --env development > .env`, or better, `scync run --project myapp
  --env development -- npm run dev`.
- **Quick lookup:** `scync get OPENAI_KEY` and paste, or `--copy` to the clipboard with auto-clear.
- **Capture a new secret** from a provider dashboard or script: `scync set NAME` with the value via stdin or a hidden
  prompt (never as a visible argument by default; see §11).
- **Rotate a key:** update the value, record rotation, and let history keep the old value.
- **Bootstrap a project** by importing an existing `.env` into the vault.
- **Server/SSH or headless machine:** sign in without a local browser (see Open Questions for the device-code
  question).
- **Audit:** list what's expiring or stale, as the web dashboard does.

---

## 8. Functional requirements

### 8.1 Authentication (the riskiest piece; do a spike first)

Requirement: the CLI must authenticate as the same Firebase user the web app does, for both Google and
email/password accounts.

- The web app uses an in-browser popup, which does not exist in a terminal. The CLI needs a terminal-appropriate
  flow. The standard approach is the OAuth loopback ("localhost redirect") flow: open the system browser to Google's
  consent screen, receive the authorization code on a temporary local HTTP listener, exchange it for Google tokens, then
  sign into Firebase with the resulting credential.
- Whatever flow is used must end with a Firebase-authenticated session whose uid equals the uid used by the web app
  for that person. If the uid differs, the CLI would see an empty vault, which is a hard failure.
- Email/password accounts must work too, with a hidden password prompt.
- **Unverified assumption to test first:** that Firebase accepts credentials obtained through a new OAuth client
  (a "Desktop" type) in the same Google Cloud project, with the same resulting uid. Prove this with a throwaway script
  that signs in and reads the user's own vault-metadata document, **before** investing in the rest. If it does not
  work, stop and report options rather than improvising.
- The session must persist across invocations through a refresh token, stored in the OS credential store where
  available, otherwise in a user-only-readable file (owner read/write only). Handle token refresh and expiry
  transparently; handle revoked sessions with a clear "run `scync login`" message.
- Provide `login`, `logout`, `whoami`. `logout` removes stored credentials and tells any key-holding agent to lock.
- Support a way to choose between Google and email/password non-interactively where sensible.

### 8.2 Vault unlock & key custody

Requirement: after authentication, the user unlocks the vault with the existing master password. Verification uses the
same verifier mechanism as the web app. A wrong password must fail cleanly without side effects.

The derived key is deliberately **non-extractable** in the web app and cannot be written to disk. The CLI must hold the
same line: **never persist the derived key or the master password.**

The problem: key derivation is intentionally slow, and a CLI is invoked as many short processes. Prompting and
re-deriving on every command would be unusable in scripts. Required design: a **short-lived local agent**, in the style
of `ssh-agent`, that holds the unlocked key in memory and serves decrypt/encrypt operations to later CLI invocations.

Agent requirements (the agent may choose the transport; discover what is appropriate per OS):
- Starts on `unlock` (or implicitly, on first command that needs it, after prompting).
- Holds the key only in memory, with a configurable idle timeout and an absolute maximum lifetime; locks and exits on
  expiry.
- Only reachable by the same OS user (socket/pipe with restrictive permissions). Treat any other local process as
  hostile.
- Explicit `lock` command and automatic lock on `logout`.
- Decide, and document, whether the agent hands out the *key* or performs crypto on behalf of clients. Prefer the
  design that exposes the least. If the CLI process must receive key material, justify why.
- Works on macOS, Linux and Windows. Windows named-pipe support must not be an afterthought.
- A mode with **no agent** must remain available: prompt for the master password every time, derive, do the work,
  discard. This is the paranoid/CI-ish mode and the fallback when the agent can't run.

Non-interactive unlock (scripts) must be possible but is a security trade-off. Offer it only through explicit,
documented mechanisms (e.g. reading the password from a file descriptor or stdin), never as a plain command-line
argument (which leaks into process listings and history). Warn in docs about the risks. Storing the master password
in the OS keychain is a separate opt-in feature, off by default, and must be clearly labeled as weakening the model.

### 8.3 Recovery

The web app supports recovering a vault with an emergency recovery key. The CLI may support unlock via that key as an
alternative path, **if** it reuses the same logic. This is optional for v1. It must never be advertised as a way to
bypass the master password for an attacker; it is the same security level as the key itself.

### 8.4 Reading secrets

- **List** secrets with filtering by project, environment, service, type and status, plus a text search. Listing
  uses plaintext metadata only and must **not** decrypt anything. It should be fast and work without an unlocked
  vault if the metadata is accessible (decide whether listing requires unlock; the web app shows metadata only after
  unlock, so default to requiring it; justify any deviation).
- **Get** a single secret's value, resolving by name (and disambiguating by project/environment/id when names
  collide). Names are not guaranteed unique; handle that explicitly and safely rather than picking one at random.
- **Show details** including metadata, notes, status, dates and optionally the version history.
- Output: masked by default when printing to a terminal for humans; a flag to print the raw value; a clean raw mode for
  pipes (`scync get X | something`) that prints only the value with no decoration or trailing noise. A `--json` option
  for machine consumption. Never mix decoration into stdout when stdout is a pipe; put human messages on stderr.
- **Copy to clipboard** with automatic clear after a timeout (the web app clears after 30 seconds; match or document
  the difference), and only clear if the clipboard still contains what we put there.
- Special secret types need respectful handling, not generic text: e.g. the "Recovery Codes" type stores structured
  data (codes with used flags). The CLI should display and update them in a way that stays valid for the web app.
  Discover the structure; do not corrupt it.

### 8.5 Writing secrets

All writes must go through the same logic the web app uses so that version history, version counters, change types,
rotation dates, remaining-code counts and ledger entries are produced consistently. **Discover exactly what the web
app writes on create/update/restore/delete and treat that list as a hard compatibility contract.**

Operations:
- **Create** (`set` on a new name): value from stdin/hidden prompt/file; optional metadata flags (project, service,
  type, environment, status, expiry, notes).
- **Update** value and/or metadata of an existing secret.
- **Rotate:** update value and record a rotation, mirroring the web app's rotation semantics.
- **Restore a previous version.**
- **Delete,** with confirmation unless forced, matching the web app's side effects (e.g. ledger).
- **Mark recovery code used** (if Recovery Codes type is supported).
- Writes must produce correct encrypted values and **fresh randomness per encryption** (no IV reuse).
- Be careful with metadata normalization (dates, nulls vs empty, enums). The web UI assumes certain shapes; discover
  them from types and existing writers.

### 8.6 Conflict handling and sync

The web app and CLI can edit the same record at nearly the same time. The web app is effectively last-write-wins today.
For the CLI:

- Every update must be conditional on the record still being at the version the CLI read. If it changed in the
  meantime, **abort with a clear message** and let the user retry or force. This should use Firestore's transactional
  facilities, not a read-then-write race.
- An explicit `--force` escape hatch is acceptable, but never the default.
- Document precisely what "conflict" means for each operation (value change vs metadata-only change).
- **Observing changes:** a `watch`-style command (stream events when web or other CLI writes occur) is useful, and
  proves the real-time sync claim. It must be mindful of Firestore read quotas (see §12).
- Offline behavior for v1: the CLI requires connectivity. Do not build a local cache of ciphertext in v1 unless
  trivial; if added, it must hold ciphertext only.

### 8.7 `.env` workflows (the headline value)

- **Export/pull:** produce `.env` content from secrets filtered by project and environment. Defines how names map to
  variable names, how collisions and invalid names are handled, and what to do about secrets that are not simple
  strings (multi-line values, JSON service-account blobs). Quoting/escaping must round-trip correctly. Discover how the
  web app's export behaves and stay consistent unless there is a good reason.
- **Import/push:** parse a `.env` file and create/update secrets, with per-item failure handling (one bad line or
  one failed write must not strand or abort the rest), a clear summary at the end and dry-run mode. Handle
  duplicates deliberately (skip / overwrite / keep both) rather than by accident. The web app's importer has known
  weaknesses (it doesn't handle `export` prefixes, escapes, or multi-line values); the CLI's should be better.
- **Run:** execute a command with the selected secrets injected into its environment, **never writing them to disk**.
  Signals, exit codes, stdio and the child's environment must pass through correctly. This is the feature that most
  reduces plaintext on disk, so it deserves the most care and tests.
- Output file safety: when writing a file, create it with owner-only permissions, warn if the target is inside a git
  repo and not ignored, and never silently overwrite without a flag.

### 8.8 Other data types (phase 2+)

Support, in order of value: TOTP codes (generate current codes from stored seeds), SSH keys (list, export public/private
key to a file with correct permissions, generate the `~/.ssh/config` snippet the web app produces), passwords
(read-only lookups), certificates (read-only). Each reuses existing core parsing/generation logic. Passwords should
not be written from the CLI in v1.

### 8.9 Projects and services

Reading projects (and custom services) is needed to resolve `--project`. Creating projects from the CLI is optional.

---

## 9. Command surface (intent, not final syntax)

The agent should propose final names and flags, keeping consistency and POSIX-ish conventions. The capabilities needed:

`login`, `logout`, `whoami` · `unlock`, `lock`, `status` · `ls` (with filters), `get`, `show` · `set`, `edit`/`update`,
`rotate`, `rm`, `restore` · `pull`/`export`, `push`/`import`, `run` · `watch` · `totp` · `ssh` · `config`, `completion`,
`version`, `help`.

Global behavior: `--json`, `--quiet`, `--no-color`, an environment-variable and config-file layer, shell completions,
useful `--help` with examples, and meaningful, documented exit codes (success, not found, ambiguous, locked, auth
required, conflict, network, usage error).

## 10. Configuration

A small config for non-secret preferences (default project/environment, agent timeouts, output defaults, clipboard
clear time). The Firebase project configuration used to reach the backend is public client configuration, not secret,
but must be handled deliberately: decide how it is shipped (embedded for the official build, overridable for
self-hosters). The project advertises self-hosting; the CLI must work against a self-hosted Firebase project too,
by pointing at different configuration.

---

## 11. Security requirements (non-negotiable)

1. No plaintext, master password or key ever sent anywhere except locally, and nothing in logs, error messages, stack
   traces or debug output. Debug logging must scrub values.
2. Master password and secret values are never accepted as ordinary positional arguments by default. Arguments appear
   in shell history and process listings. Prefer stdin, hidden prompts, file descriptors. If an argument form is
   offered for convenience, it must be explicit and warned about.
3. Agent IPC is restricted to the current OS user and authenticated appropriately. Assume other local processes exist.
4. Credential storage: refresh token in the OS credential store when available; otherwise owner-only file. Never store
   the master password or derived key at rest by default.
5. Memory hygiene: minimize time plaintext lives in memory, avoid putting secrets in long-lived strings/objects where
   practical, and be honest in docs that JavaScript cannot guarantee zeroization.
6. Clipboard: auto-clear, conditional on unchanged contents.
7. Never print secrets in terminals that are not TTYs unless explicitly requested raw output; make accidental
   reveal difficult. Warn when output redirection of plaintext seems unintentional.
8. Input validation: treat everything fetched from Firestore as untrusted data (including names, notes and
   metadata) when printing to a terminal. Strip or escape control sequences to avoid terminal injection.
9. Dependency discipline: keep the dependency tree small, pin versions, commit lockfile, prefer well-maintained
   packages for OAuth, keychain access and prompts. Every dependency is attack surface in a security tool.
10. Do not weaken the existing security model for convenience. If a requested feature conflicts with
    zero-knowledge, stop and flag it.

## 12. Non-functional requirements

- **Performance:** unlock-once-then-instant. Listing and getting should not require downloading more than needed
  where Firestore allows targeted queries; but note the data model has no server-side indexes in use, so a
  full-collection read may be the pragmatic approach for small personal vaults. Measure before optimizing.
- **Cost/quota awareness:** the project is designed to run on Firebase's free tier. Real-time listeners and whole
  collection reads consume read quota. Prefer one-shot reads for normal commands, listeners only for `watch`, and
  avoid chatty polling.
- **Process lifecycle:** the Firebase SDK keeps connections open; short-lived commands must terminate promptly and
  cleanly, with no hanging process.
- **Platforms:** macOS, Linux, Windows; current Node LTS. Define the minimum Node version explicitly.
- **Distribution:** installable via npm. A standalone single-file binary (no Node required) is a strong-to-have;
  evaluate options and report trade-offs. Provide a clear upgrade path.
- **Reliability:** clear, actionable errors, especially for the top failure modes: offline, token expired, vault locked,
  wrong password, secret not found/ambiguous, version conflict, rules/permission denied, Firestore quota exceeded.

---

## 13. Testing & verification

This tool handles secrets and writes into a live production-style datastore. Testing is a primary deliverable.

1. **Use the Firebase Emulator Suite** (auth + Firestore) for all automated tests. The repo already supports
   emulators. Tests must never touch a real project. Provide a guard that refuses to run write tests against
   non-emulator configuration.
2. **Cross-client compatibility tests (the most important suite).**
   - Data **created by the web app code** must be readable and decryptable by the CLI.
   - Data **created or modified by the CLI** must be readable and decryptable by the web app logic, with correct versions,
     counters, change types and ledger entries.
   - Do this by exercising the real shared core functions on both sides against the same emulator, and also by
     checking raw stored documents against an explicit expected shape.
3. **Crypto vectors:** test that the CLI derives the same key and decrypts a ciphertext produced by the existing web
   implementation for fixed inputs.
4. **Security-focused tests:** secrets never appear in stdout when masked, in stderr, in logs, in temp files, or in
   process arguments; agent socket permissions; clipboard clear logic; terminal-injection sanitization.
5. **Conflict tests:** simulate simultaneous web/CLI edits and verify the CLI aborts rather than overwrites.
6. **`.env` round-trip tests** including quotes, escapes, multi-line values, `export` prefixes, comments, duplicates.
7. **`run` tests:** environment injection, exit code and signal propagation, no secret written to disk.
8. **Cross-platform CI** for the agent and path/permission handling.
9. A **manual acceptance script** against a real throwaway Firebase project (not production) walking through the user
   scenarios in §7, signing in with a Google account that also has a web vault.

## 14. Delivery phases

**Phase 0 — Feasibility spike (go/no-go).**
Prove: CLI sign-in (Google, ideally also email/password) yields the same uid as the web app; read the vault metadata
document; derive the key with the user's master password; decrypt the verifier. Prove the core-library reuse approach
(§6.1) in Node. Report findings and any blockers. **Do not proceed past this phase without reporting.**

**Phase 1 — Read-only core.**
Auth session persistence, unlock (no agent yet, prompt-each-time), `ls`, `get`, `show`, `pull`, clipboard with
auto-clear, JSON/raw output, error and exit-code conventions.

**Phase 2 — Writes.**
`set`, update, `rotate`, `rm`, `restore`, `push`/import, with compatibility-correct writes, version-checked conflict
handling, and the full cross-client test suite.

**Phase 3 — Agent & workflow.**
The key-holding agent with timeouts, `run`, `watch`, completions, config layer.

**Phase 4 — Other data types & polish.**
TOTP, SSH, read-only passwords/certs, packaging (npm + standalone binary), docs, release process.

Each phase ends with working, tested, documented functionality and a short written report of deviations and open
questions.

## 15. Open questions (agent: investigate and report, do not guess)

1. Does Firebase Auth accept a Desktop-type OAuth credential from the same Cloud project and resolve to the same uid?
   If not, what are the alternatives?
2. Is headless sign-in (SSH session, no browser) feasible? Google's device-code flow has restrictions on allowed
   scopes and may not be usable here. If not, what is the least-bad option (sign in elsewhere and transfer a session,
   or email/password only for headless)?
3. How far can core be made environment-independent with a small, behavior-preserving refactor? Are there browser-only
   dependencies lurking (e.g. in modules used by key operations)?
4. What is the true set of side effects the web app performs on each secret write? (Produce the explicit list before
   implementing writes.)
5. Can a Firestore transaction cleanly cover "check version, then update, then ledger entry" or must the ledger write
   be separate? What does the web app do on partial failure?
6. Security rules: confirm the CLI's session is fully authorized for all operations it needs and nothing needs rule
   changes. Note that the repo's own handoff log says rule changes were prepared but may not be deployed; verify what
   is live for the target project.
7. Where should the Firebase client configuration live for official vs self-hosted use?
8. Is the agent best exposing key material or performing crypto itself, given Node's constraints?
9. Known data-hygiene quirks in the existing system that the CLI could trip over (e.g. non-unique names, orphaned
   project references after project deletion, plaintext metadata assumptions). List them and decide handling.

## 16. Risks

- **Auth mismatch (high):** wrong uid means an empty or wrong vault. Mitigated by the Phase 0 spike.
- **Write drift (high):** the CLI writes data subtly different from the web app, corrupting history or dashboards.
  Mitigated by reusing core and the compatibility suite.
- **Secret leakage via convenience features (high):** history, logs, clipboard, files. Mitigated by §11 and tests.
- **Lost updates (medium):** concurrent edits. Mitigated by version-checked writes.
- **Quota (medium):** over-reading on the free tier. Mitigated by one-shot reads and restrained listeners.
- **Scope creep (medium):** this is a personal-vault tool; resist team features, rotation automation and CI
  injection in v1.

## 17. Definition of done (v1)

A user with an existing web vault can, from a clean machine:

1. Install the CLI, run `scync login`, and sign in with the same account used on the web.
2. Unlock with the same master password.
3. List and retrieve any secret, with values masked by default and copy-with-auto-clear available.
4. Create, update, rotate and delete a secret and see each change reflected correctly in the web app, including version
   history, rotation date and the activity ledger, without refreshing.
5. Edit a secret in the web app and see it in the CLI.
6. Export a project/environment to `.env` and run a process with those secrets injected without writing them to disk.
7. Import a `.env` file with partial failures handled and reported.
8. Get a clear error rather than data loss when both clients edit the same secret.
9. Verify through the test suite that no plaintext secret, master password or derived key leaves the machine or
   appears in logs, and the existing web app's tests and behavior are unchanged.

---

## 18. Working agreement for the AI agent

- Read the existing repo first; produce a short written findings document (architecture, write side-effects, auth
  approach, refactor plan) **before** writing implementation code.
- Prefer small, reviewable steps. Stop and ask at the decision points flagged above (Phase 0 result, core refactor,
  anything touching the web app or the security model).
- Never test against a production Firebase project or real user data. Emulator first, then a clearly throwaway
  project.
- Do not invent cryptography or data formats. When something isn't specified here, discover the existing behavior and
  match it, then document what you found.
- Keep a running decisions log with reasons, so the human can review why choices were made.
