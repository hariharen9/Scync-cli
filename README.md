# Scync — Terminal Vault

> Zero-knowledge developer secrets manager with a full-screen terminal UI and a scriptable CLI.

[![Tests](https://img.shields.io/badge/tests-83%20passed-brightgreen.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-blue.svg)]()
[![License](https://img.shields.io/badge/license-MIT-green.svg)]()

> **New here?** The [User Guide](./USER_GUIDE.md) is a task-oriented walkthrough (login → unlock → daily usage).

Scync keeps secrets encrypted on your machine. The terminal app is the primary way to use it: browse, search, edit, rotate and use secrets without leaving the keyboard. The CLI exposes the same vault for scripts, pipes, CI and headless workflows.

Both clients talk to the same Firebase project, use the same master password, and share the same zero-knowledge core. A change made in the TUI appears in the web app and vice versa.

---

## 🖥️ The TUI (primary experience)

```bash
scync              # interactive terminal: opens the TUI
scync tui          # or: scync ui
scync tui --ascii  # ASCII borders for limited terminals
scync tui --no-agent
```

Bare `scync` opens the TUI when run in a real terminal; piped/headless runs show help instead.

Launching plays a short animated **secure-session splash** (identity, vault, agent and crypto status) and then settles into the app. Quitting restores your terminal and leaves a compact **vault-sealed farewell card** in scrollback with the session summary. Any key skips the splash once it is ready; it auto-advances otherwise.

A full-screen, web-app-like terminal interface:

| View | What you can do |
|---|---|
| **Dashboard** | Vault health, attention items (expired / expiring / rotation overdue / low recovery codes), recent updates, project breakdown, agent status. |
| **Secrets** | Search, filter, sort, inspect, reveal/copy, create, edit, rotate, restore versions, delete. Structured recovery codes and version history. |
| **Projects** | Create, rename, recolor, describe and delete projects; filter secrets by project. |
| **Passwords** | Search website logins, reveal/copy password, username, URL and notes. |
| **TOTP** | Live RFC 6238 codes, countdown bar, copy code or base32 secret. |
| **SSH Keys** | Inspect fingerprints/hosts, copy public/private keys, export key pairs, copy an `~/.ssh/config` block. |
| **Certificates** | Validity/expiry, issuer, SANs, copy/view PEM and private key. |
| **Tools** | Export `.env`, import `.env`, run a command with secrets injected, lock/unlock, settings, logout. |
| **Settings** | Identity, vault metadata, agent custody/TTL, configuration editor, about. |

### TUI keys

```text
1–9            jump to a view              U / L     unlock / lock vault
← / →          previous / next view       Ctrl+R    refresh vault data
↑ / ↓          move selection             ?         help overlay
Enter          open / confirm             q         quit (Ctrl+C works too)
Tab            switch pane                /         search current list
Esc            back
```

`Esc` is the universal back key: close modal → leave detail pane → clear search/filters → return to the previous view (dashboard fallback).

Destructive actions in the TUI always show a confirmation: delete secret, delete project, logout, overwrite an existing `.env`, overwrite SSH keys, import with overwrite/force, and version-conflict overwrites.

Security behavior in the TUI:

- Values stay masked until you explicitly reveal/copy/edit/view.
- Reveals auto-hide after 15 seconds.
- Clipboard copies auto-clear using your configured timeout (30s default).
- Decrypted TOTP secrets and plaintext caches are cleared on lock and exit.
- Writes use the same optimistic version checks as the CLI; conflicts ask before overwriting.

**Platform:** Windows Terminal (or another VT-capable terminal) is recommended. Use `--ascii` or `SCYNC_TUI_ASCII=1` for ASCII borders, and `SCYNC_TUI_COLORS=0|16|256|24` to force a colour depth. The alternate screen, cursor, raw mode and paste handling are always restored on quit, signals and render errors.

See [`src/tui/README.md`](./src/tui/README.md) for architecture, data flow and extension notes.

---

## ⌨️ The CLI (secondary: scripting & automation)

```bash
# Authenticate (Google browser loopback, or email/password)
scync login
scync login --email you@example.com

# Unlock once; the short-lived key agent serves later commands
scync unlock

# Read
scync ls --project Payments
scync get STRIPE_SECRET_KEY --reveal
scync get DATABASE_URL --raw | docker login --password-stdin

# Write
scync set OPENAI_API_KEY --project MyApp --env production
scync update OPENAI_API_KEY --value "sk-..."
scync rotate OPENAI_API_KEY
scync restore OPENAI_API_KEY 2

# Dev workflows
scync run --project Payments -- npm start
scync pull --project Payments --env production --output .env
scync push --dry-run .env

# Projects
scync projects
scync projects create "Payments" --color violet --description "Billing services"
scync projects update Payments --name "Payments API" --color blue
scync projects delete Payments --move-to MyApp --yes

# Specialized types
scync totp GitHub
scync ssh export prod-bastion
scync passwords github --copy
scync certs --reveal-key
```

### Destructive actions & confirmations

Deletes, overwrites and forced conflict overrides always ask for confirmation when run interactively. Non-interactive runs must pass `--yes`; they refuse instead of hanging on a prompt.

```bash
scync rm OLD_KEY --yes
scync logout --yes
scync pull -o .env --force --yes
scync push .env --overwrite --yes
scync ssh export prod-bastion --force --yes
scync update KEY --value new --force --yes
```

`--force` bypasses the safety check (concurrency, existing file, conflict), but it does **not** silently skip the confirmation. Use `--force --yes` for automation.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | General / usage error |
| `2` | `AUTH_REQUIRED` — run `scync login` |
| `3` | `VAULT_LOCKED` — run `scync unlock` |
| `4` | `NOT_FOUND` — secret, version, SSH key or project missing |
| `5` | `AMBIGUOUS_MATCH` — specify `--project`, `--env` or `--id` |
| `6` | `CONFLICT` — remote version changed concurrently |
| `7` | `NETWORK_ERROR` — reserved for backend/connectivity failures |

---

## 🔒 Security architecture

1. **Zero key persistence.** Master passwords and derived WebCrypto `CryptoKey` handles are never written to disk, logs, shell history or telemetry.
2. **Standard primitives.** PBKDF2-HMAC-SHA-256, 310,000 iterations, 16-byte salt, input `password + uid`; AES-256-GCM with a fresh 96-bit IV per encryption. Verifier constant: `Scync_VALID_v1`.
3. **Short-lived key agent.** On Windows a named pipe; on POSIX a `0600` Unix socket in a `0700` directory. The agent performs encrypt/decrypt/batch-decrypt internally; raw keys never cross IPC. Idle timeout (default 15m), absolute lifetime (8h), and immediate eviction on `lock`/`logout`.
4. **Stream discipline.** Prompts and warnings go to `stderr`. In pipe mode (`!stdout.isTTY` or `--raw`), `get` writes only the plaintext value with no decoration or trailing newline.
5. **Clipboard hygiene.** Auto-clear only if the clipboard still holds the copied value. Timeout is configurable.
6. **Process injection without temp files.** `scync run` and the TUI “Run with secrets” insert decrypted values directly into the child environment.
7. **No plaintext to the server.** Firebase sees encrypted blobs and plaintext metadata only.

---

## 📦 Installation

**Requirements:** Node.js `>= 20.0.0` (native WebCrypto).

```bash
git clone https://github.com/scync/scync-cli.git
cd scync-cli
npm install
npm run build
npm link        # makes `scync` available globally
```

Firebase client configuration is public, not secret. Put it in `~/.scync/.env` (or use the emulator):

```dotenv
SCYNC_FIREBASE_API_KEY=...
SCYNC_FIREBASE_AUTH_DOMAIN=...
SCYNC_FIREBASE_PROJECT_ID=...
SCYNC_FIREBASE_APP_ID=...
# Optional Google OAuth loopback
SCYNC_GOOGLE_CLIENT_ID=...
SCYNC_GOOGLE_CLIENT_SECRET=...
```

Self-hosted Firebase projects work through the same variables.

---

## 📖 CLI reference

### Auth & vault

| Command | Options | Description |
|---|---|---|
| `scync login` | `--email`, `--no-browser`, `--port` | Google OAuth loopback or email/password sign-in. |
| `scync logout` | `--yes` | Remove stored session and lock the agent. |
| `scync whoami` | `--json` | Show active identity and token expiry. |
| `scync status` | `--json` | Vault, biometrics, recovery kit and agent TTL. |
| `scync unlock` | `--timeout`, `--no-agent` | Verify master password and start key custody. |
| `scync lock` | | Stop the agent and wipe in-memory keys. |

### Secrets

| Command | Options | Description |
|---|---|---|
| `scync ls` | `--project`, `--env`, `--service`, `--type`, `--status`, `--search`, `--json` | Metadata-only list; honors configured defaults. |
| `scync get <name>` | `--reveal`, `--copy`, `--raw`, `--json`, `--project`, `--env`, `--id` | Decrypt and output one secret. |
| `scync show <name>` | `--reveal`, `--json`, `--project`, `--env`, `--id` | Metadata, notes and version history. |
| `scync set <name>` | `--value`, `--file`, `--service`, `--type`, `--env`, `--status`, `--project`, `--notes`, `--expires`, `--force`, `--yes` | Create, or update an existing matching secret with confirmation. |
| `scync update <name>` | `--value`, `--file`, metadata flags, `--force`, `--yes` | Update; `--force` overrides version checks after confirmation. |
| `scync rotate <name>` | `--value`, `--file`, `--force`, `--yes` | New value, rotation timestamp, new version. |
| `scync restore <name> <version>` | `--project`, `--env`, `--id` | Restore a historical version as a new version. |
| `scync rm <name>` | `--yes`, `--project`, `--env`, `--id` | Delete permanently after confirmation. |

### Projects

| Command | Options | Description |
|---|---|---|
| `scync projects` | `--json` | List projects with secret counts. |
| `scync projects create <name>` | `--description`, `--color`, `--icon`, `--json` | Create a project. |
| `scync projects update <project>` | `--name`, `--description`, `--color`, `--icon`, `--json` | Update by name or id. |
| `scync projects delete <project>` | `--move-to <project>`, `--yes`, `--json` | Delete after confirmation; move secrets or leave them uncategorized. |

### Workflows

| Command | Options | Description |
|---|---|---|
| `scync pull` / `export` | `--output`, `--project`, `--env`, `--force`, `--yes` | Export active secrets to `.env` (`0600`), with overwrite confirmation. |
| `scync push` / `import` | `[file]`, `--dry-run`, `--overwrite`, `--force`, `--yes`, `--project`, `--env`, `--type` | Import `.env` with duplicate collapsing and per-item reporting. |
| `scync run -- <cmd>` | `--project`, `--env`, `--service`, `--no-agent` | Run a child process with decrypted secrets in its environment. |
| `scync watch` | `--project`, `--env`, `--service`, `--reveal` | Real-time Firestore sync stream. |
| `scync tui` / `ui` | `--no-agent`, `--ascii` | Full-screen terminal app. |
| `scync config` | `[list\|get\|set\|unset]` | Local preferences in `~/.scync/config.json`. |
| `scync completion <shell>` | `bash`, `zsh`, `fish`, `powershell` | Shell completions. |

### Specialized types

| Command | Options | Description |
|---|---|---|
| `scync totp [name]` | `--copy`, `--json`, `--no-agent` | Generate/List TOTP codes. |
| `scync ssh <ls\|get\|export\|config>` | `--private`, `--dir`, `--force`, `--yes`, `--json` | Manage/export SSH keys and config blocks. |
| `scync passwords [query]` | `--reveal`, `--copy`, `--json` | Read-only website logins. |
| `scync certs [query]` | `--reveal-key`, `--json` | Inspect X.509 certificates. |

---

## 🧭 Parity & safety rules

These are project rules, not suggestions:

1. **Feature parity.** Every capability and behavior must exist in both the TUI and the CLI. Adding a view/command or changing semantics means updating the other surface in the same change.
2. **Destructive confirmation.** Delete, overwrite, force/conflict override and logout must ask for explicit confirmation in both surfaces.
3. **Explicit non-interactive consent.** CLI scripts must pass `--yes`. Without a TTY and without `--yes`, destructive commands refuse with a clear error instead of hanging.
4. **No silent overwrite.** Version conflicts, existing files, existing secrets and forced operations are surfaced and confirmed.

---

## 🧪 Testing & verification

```bash
npm run typecheck
npm test               # 13 suites, 83 unit tests (incl. headless TUI render/key/edit)
npm run test:emulator  # 19 suites, 110 tests incl. Firebase emulator integration
npm run build
```

The TUI test suite renders every view at wide and compact sizes (checking row-width integrity), and exercises key parsing (including split ESC sequences), search, forms, selects, confirms, modals and navigation.

---

## 📜 Decisions & provenance

- [`DECISIONS.md`](./DECISIONS.md) — architecture, IPC, exit behaviour, TUI design, input disambiguation and parity rules.
- [`PROVENANCE.md`](./PROVENANCE.md) — copied/ported core modules against the reference snapshot.
- [`src/tui/README.md`](./src/tui/README.md) — TUI architecture, keymap and adding a view.

## License

MIT.
