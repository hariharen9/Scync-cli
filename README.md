# Scync CLI (`scync`)

> Zero-knowledge developer secrets manager CLI. Interoperable with the [Scync](https://github.com/scync) web client.

[![Tests](https://img.shields.io/badge/tests-79%20passed-brightgreen.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-blue.svg)]()
[![License](https://img.shields.io/badge/license-MIT-green.svg)]()

> **New here?** The [User Guide](./USER_GUIDE.md) is a task-oriented walkthrough
> (login → unlock → daily usage) — start there if the command reference below feels dense.

---

## 🔒 Security Architecture & Zero-Knowledge Guarantee

`scync-cli` is architected with strict client-side zero-knowledge guarantees:
1. **Zero Key Persistence:** Master passwords and derived WebCrypto `CryptoKey` handles are **never** persisted to disk, swap, shell history, logs, or unencrypted memory dumps.
2. **Standard Cryptographic Primitives:** 100% interoperable with Scync Web app:
   - Key Derivation: **PBKDF2** (310,000 iterations, SHA-256, 256-bit output).
   - Encryption: **AES-GCM-256** with 96-bit random IVs and authentication tags.
3. **Background Agent Key Custody:** A short-lived, local OS-isolated daemon holds unlocked keys in memory across short CLI invocations:
   - **Windows:** Named Pipe (`\\.\pipe\scync-agent-<uid>`), secured by Windows user access control tokens.
   - **POSIX (Linux/macOS):** Unix Domain Socket (`~/.scync/agent-<uid>.sock`), created with mode `0600` inside a `0700` directory.
   - **Crypto Delegation:** Client processes never see or transfer raw keys over IPC; the agent executes `ENCRYPT`, `DECRYPT`, and `BATCH_DECRYPT` operations internally.
   - **Eviction:** Auto idle timeout (15 minutes default, refreshed on each operation), maximum lifetime (8 hours), and immediate zeroing on `scync lock` or `scync logout`.
4. **Stream Discipline & Leaks Prevention:**
   - Prompts and warnings always target `stderr`.
   - In pipe mode (`!stdout.isTTY` or `--raw`), `scync get` writes **only** the raw plaintext secret without newlines or terminal formatting.
   - Clipboard copies are cleared automatically after a configurable timeout (30 seconds by default) via a non-blocking detached background process.
   - Subprocess execution (`scync run`) injects secrets directly into child process memory without writing `.env` files to disk.

---

## 🚀 Installation & Setup

### Requirements
- Node.js **20.0.0+** (native WebCrypto support, no polyfills).

### Local Installation
```bash
git clone https://github.com/scync/scync-cli.git
cd scync-cli
npm install
npm run build
```

### Make `scync` Globally Available
```bash
npm link
```
Now `scync` is accessible from any terminal window.

---

## ⚡ Quickstart

### 1. Authenticate
```bash
# Google Sign-in via browser loopback
scync login

# Or Email & Password
scync login --email user@example.com
```

### 2. Unlock Vault
```bash
# Prompts for master password and starts 15m background key agent
scync unlock
```

### 3. Browse & Read Secrets
```bash
# List all secrets (fast, metadata-only without decrypting)
scync ls

# Inspect secret metadata and version history
scync show OPENAI_API_KEY

# View secret (masked in terminal, or reveal)
scync get OPENAI_API_KEY
scync get OPENAI_API_KEY --reveal

# Copy to clipboard with automatic 30s auto-clear (configurable)
scync get OPENAI_API_KEY --copy

# Pipe directly to other tools
scync get DATABASE_URL --raw | docker login ...
```

### 4. Create & Modify Secrets
```bash
# Create a secret (interactive prompt, pipe, or file)
scync set STRIPE_SECRET_KEY --project Payments --env production
cat cert.pem | scync set TLS_CERT --type Certificate
scync set API_TOKEN --file ./token.txt

# Update secret (optimistic concurrency checking on version numbers)
scync update STRIPE_SECRET_KEY --value "sk_live_new..."

# Rotate secret (increments version and updates rotation timestamp)
scync rotate STRIPE_SECRET_KEY

# Restore previous version from history
scync restore STRIPE_SECRET_KEY 1

# Delete secret
scync rm STRIPE_SECRET_KEY --force
```

### 5. Developer Workflows
```bash
# Run commands with secrets directly injected into memory
scync run --project Payments -- npm start

# Export active secrets to .env format (mode 0600)
scync pull --project Payments --env production --output .env

# Import a .env file with dry-run preview and conflict checking
scync push --dry-run .env
scync push --overwrite .env

# Stream real-time vault changes
scync watch

# Lock vault and purge agent memory
scync lock
```

### 6. Interactive TUI (beta)
```bash
# Full-screen vault interface: dashboard, secrets, projects, passwords,
# TOTP, SSH keys, certificates, tools and settings
scync tui

# Fallbacks and options
scync tui --ascii          # ASCII borders for limited terminals
scync tui --no-agent       # Keep keys in-process only
```

The TUI is a separate `src/tui/` app that plugs into the same auth, vault,
crypto, agent and Firestore logic as the commands above. It masks values by
default, auto-hides reveals after 15 seconds, uses the configured clipboard
auto-clear, and writes secrets through the same version-checked CRUD paths.

| Keys | Action |
|---|---|
| `←` / `→` | Previous / next view |
| `U` / `L` | Unlock / lock vault |
| `↑ ↓`, `Enter`, `Tab` | Move, open, switch pane |
| `Esc` | Back: close modal/detail, clear search/filters, then previous view |
| `1` … `9`, `[` / `]` | Jump to a view |
| `/` | Search the current list |
| `n` / `e` / `R` / `v` / `d` | New / edit / rotate / versions / delete secret |
| `r` / `c` / `y` / `s` | Reveal / copy / copy notes / view full value |
| `f` / `x` / `o` / `O` | Filters / clear / cycle sort / direction |
| `Ctrl+R`, `?`, `q` | Refresh, help, quit |

Every screen also has contextual hints in the bottom bar. See
[`src/tui/README.md`](./src/tui/README.md) for the architecture, data flow and
keymap.

---

## 📖 Command Reference

### Authentication & Vault Status
| Command | Options | Description |
|---|---|---|
| `scync login` | `--email <email>`, `--no-browser`, `--port <port>` | Authenticate with Google (OAuth loopback) or Email/Password. |
| `scync logout` | | Clear stored session credentials and lock the agent. |
| `scync whoami` | | Display active session user email, UID, and token expiration. |
| `scync status` | | Show vault initialization, biometric count, emergency kit status, and agent TTL. |
| `scync unlock` | `--timeout <duration>`, `--no-agent` | Verify master password and unlock agent (default 15m idle timeout). |
| `scync lock` | | Terminate key custody agent and wipe memory. |

### Secrets Management
| Command | Options | Description |
|---|---|---|
| `scync ls` | `--project`, `--env`, `--service`, `--type`, `--status`, `--json` | List vaulted secrets without decrypting payloads. Falls back to configured `default.project` / `default.env`. |
| `scync get <name>` | `--reveal`, `--copy`, `--raw`, `--project`, `--env`, `--id` | Decrypt and output a secret. Raw/pipe clean. |
| `scync show <name>` | `--project`, `--env`, `--json` | Display secret metadata, decrypted notes, and version history ledger. |
| `scync set <name>` | `--value`, `--file`, `--project`, `--env`, `--service`, `--type`, `--notes` | Create a secret (v1) or update existing with confirmation. |
| `scync update <name>` | `--value`, `--file`, `--project`, `--env`, `--notes` | Modify value or metadata with optimistic concurrency checking. |
| `scync rotate <name>` | `--value`, `--file` | Increment version, update value, record rotation date, status Active. |
| `scync restore <name> <ver>` | | Restore previous version from the document's history ledger. |
| `scync rm <name>` | `--force`, `--project`, `--env` | Delete secret with confirmation or `--force`. |

### Workflows & Synchronization
| Command | Options | Description |
|---|---|---|
| `scync run -- <cmd>` | `--project`, `--env` | Run subprocess with decrypted secrets injected into `process.env`. |
| `scync pull` / `export` | `--output <file>`, `--project`, `--env`, `--force` | Export active secrets to `.env` (enforces `0600` permissions). |
| `scync push` / `import` | `[file]`, `--dry-run`, `--overwrite`, `--force`, `--project`, `--env`, `--type` | Import variables from `.env` file; duplicate keys collapse with last-value-wins. |
| `scync watch` | `--project`, `--env`, `--reveal` | Real-time Firestore sync stream (`onSnapshot`) logging added/modified/removed secrets. |
| `scync tui` / `ui` | `--no-agent`, `--ascii` | Full-screen interactive vault UI (dashboard, secrets, projects, passwords, TOTP, SSH, certs, tools, settings). |
| `scync config` | `[action] [key] [value]` | View or modify local CLI preferences in `~/.scync/config.json` (`default.project`, `default.env`, `agent.timeout`, `clipboard.timeout`, `output.format`). |
| `scync completion` | `<shell>` | Generate shell completions for `bash`, `zsh`, `fish`, or `powershell`. |

### Specialized Data Types
| Command | Subcommands / Options | Description |
|---|---|---|
| `scync totp` | `[name]`, `--copy` | Generate RFC 6238 6-digit TOTP codes with live remaining second indicators. |
| `scync ssh` | `ls`, `get <name>`, `export <name>`, `config` | Manage SSH keys, print fingerprints, export keypairs (`0600`/`0644`), and output `~/.ssh/config` host blocks. |
| `scync passwords` | `[query]`, `--reveal`, `--copy` | Search and look up saved login passwords (masked by default). |
| `scync certs` | `[query]`, `--reveal-key`, `--json` | Inspect X.509 SSL/TLS certificates, expiry dates, subjects, issuers, and SANs. |

---

## 🛑 Exit Codes

`scync-cli` follows standard POSIX exit codes:
- `0`: Success.
- `1`: General error / usage error.
- `2`: `AUTH_REQUIRED` — Not logged in or session revoked (`scync login` needed).
- `3`: `VAULT_LOCKED` — Master password or `scync unlock` needed.
- `4`: `NOT_FOUND` — Secret, version, SSH key, or project not found.
- `5`: `AMBIGUOUS_MATCH` — Multiple secrets matched name; specify `--project`, `--env`, or `--id`.
- `6`: `CONFLICT` — Remote secret version changed concurrently (use `--force` to override).
- `7`: `NETWORK_ERROR` — Reserved for connectivity/backend failures.

---

## 🧪 Testing & Verification

### Run Unit Tests
```bash
npm test
```
*(Runs 12 suites, 79/79 tests passing, including headless TUI render/key/edit coverage).*

### Run Emulator Integration Tests
Requires Firebase CLI (`npm install -g firebase-tools`):
```bash
npm run test:emulator
```
*(Executes against Firebase Local Emulator Suite Auth `:9099` and Firestore `:8080`; 18 suites, 105/105 tests passing including the unit suites).*

### Run Live Vault Smoke Test
```bash
npm run test:smoke
```
*(Executes 20 live end-to-end assertions against your active vault and cleans up safely).*

---

## 📜 Architectural Decisions & Provenance
- [DECISIONS.md](./DECISIONS.md) — Rationale for IPC transports, WebCrypto isolation, and Windows subprocess execution.
- [PROVENANCE.md](./PROVENANCE.md) — Code tracking against reference commit `61b96af`.

---

## License
MIT
