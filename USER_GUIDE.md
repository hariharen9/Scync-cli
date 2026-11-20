# Scync CLI — User Guide

This guide explains how to actually *use* `scync` day to day. For architecture and
the full option-by-option reference, see the [README](./README.md); this document
is the "how do I do X" version.

---

## 1. The mental model (read this once)

There are two separate things that must happen before you can touch secrets:

```
scync login    ->  proves WHO you are   (your Scync / Google / email account)
scync unlock   ->  proves you OWN the vault  (your master password)
```

They are independent on purpose, just like the web app:

- **Login** is a normal account sign-in. It is remembered on disk
  (`~/.scync/session.json`), so you typically do this **once per machine**.
- **Unlock** asks for your **master password** — the real encryption key. It is
  never stored anywhere. When you unlock, a small **background agent** process
  starts and holds the unlocked key in memory for you (default: 15 minutes of
  inactivity). Every `scync` command you run afterwards talks to that agent, so
  you don't retype the password for every single command.

So your daily flow is usually:

```bash
scync unlock      # once, when you sit down
scync get STRIPE_KEY --copy
scync run -- npm start
scync lock        # when you're done (optional — it also auto-locks)
```

It works exactly like `ssh-agent`: one unlock, then fast commands for a while.

---

## 2. Install

Requirements: Node.js 20+.

```bash
cd scync-cli
npm install
npm run build
npm link        # makes `scync` available globally in your terminal
```

Check it works:

```bash
scync --version
```

---

## 3. First-time setup (do these in order)

### Step 1 — Sign in

```bash
scync login
```

This opens your browser and signs you in with Google — **the same account you
use in the Scync web app**. If your account is email/password instead:

```bash
scync login --email you@example.com
```

You'll be prompted for your password (hidden as you type). After this you
usually never need to log in again on this machine.

Verify with:

```bash
scync whoami
```

### Step 2 — Unlock the vault

```bash
scync unlock
```

You'll be prompted:

```
Enter vault master password:
```

Type your **master password** (the one you use in the web app — there is no
separate CLI password). If it's correct you'll see the agent start:

```
Scync Vault Session
  Status:    ● Unlocked & Ready
  Custody:   Background Agent Daemon
  Idle TTL:  15m (auto-locks on inactivity)
```

Useful variants:

| Command | What it does |
|---|---|
| `scync unlock --timeout 1h` | Keep the agent alive for 1 hour of inactivity instead of 15 min |
| `scync unlock --no-agent` | Verify the password but hold the key only for this one command (paranoid mode) |

### Step 3 — Check your vault works

```bash
scync status      # vault state, agent status
scync projects    # list your projects
scync ls          # list secrets
```

If `scync ls` shows your secrets, everything is wired up correctly.

### Managing projects

```bash
scync projects                                         # list projects + counts
scync projects create "Payments" --color violet --description "Billing services"
scync projects update Payments --name "Payments API" --color blue
scync projects delete Payments --move-to MyApp --yes   # destructive: confirm
```

`projects delete` asks for confirmation unless `--yes`; secrets in the project
are moved to `--move-to` or left uncategorized.

---

## 4. Reading secrets

### List secrets (fast, nothing is decrypted)

```bash
scync ls                       # everything
scync ls -p myapp              # secrets of project "myapp"
scync ls -p myapp -e Production
scync ls -s AWS                # by service (AWS, Stripe, OpenAI, ...)
scync ls --status Active
scync ls -q openai             # text search
scync ls --json                # machine-readable output
```

Tip: if you always work in one project, set defaults (see section 8) and then
plain `scync ls` is already filtered.

### Get one secret's value

```bash
scync get OPENAI_API_KEY
```

In a terminal this shows a card with the value **masked**:

```
Secret: OPENAI_API_KEY
  Value:  sk-proj-******************** (51 chars)

Tip: Use -r (--reveal) to print value, or -c (--copy) to copy to clipboard
```

To actually see or use the value:

```bash
scync get OPENAI_API_KEY --reveal     # print plaintext to the terminal
scync get OPENAI_API_KEY --copy      # copy to clipboard (auto-clears after 30s)
scync get DATABASE_URL --raw         # print raw value, no decoration (for piping)
```

When you **pipe** the output somewhere, `scync` automatically switches to clean
raw output — only the value reaches the pipe, nothing else:

```bash
scync get DOCKER_PASS | docker login -u me --password-stdin
kubectl create secret generic db --from-literal=url="$(scync get DATABASE_URL --raw)"
```

The clipboard copy is cleared automatically after 30 seconds (configurable) —
and only if the clipboard still contains what was copied.

### If a name matches multiple secrets

Names are per project/environment, so `scync get API_KEY` can be ambiguous.
The CLI tells you and exits with code 5. Disambiguate:

```bash
scync get API_KEY -p myapp            # by project
scync get API_KEY -p myapp -e Production
scync get API_KEY --id <docId>        # by exact document id
```

### Inspect one secret in detail

```bash
scync show STRIPE_SECRET_KEY
scync show STRIPE_SECRET_KEY --json
scync show STRIPE_SECRET_KEY --reveal   # also print the decrypted value and notes
```

This shows metadata (environment, service, type, status, expiry), notes, and
the **version history** — who changed what and when.

---

## 5. Creating and changing secrets

The value never has to appear as a visible command argument. The command helps
you avoid leaking secrets into shell history and process lists.

### Create a new secret

```bash
scync set STRIPE_SECRET_KEY
# -> prompts "Secret value for STRIPE_SECRET_KEY:" (hidden)
```

or non-interactively:

```bash
cat cert.pem | scync set TLS_CERT                    # from a pipe
scync set API_TOKEN --file ./token.txt               # from a file
scync set DB_URL -v "postgres://..."                 # direct (warning printed to stderr)
```

With metadata:

```bash
scync set STRIPE_SECRET_KEY -s Stripe -t "API Key" -e Production -p myapp --notes "main acct"
```

- `-e/--env` defaults to `Development`
- `-p/--project` assigns to one of your projects (see `scync projects`)
- `-t/--type` is a friendly type name (`API Key`, `Database URL`, ...)

If a secret with that name already exists in that environment, `scync set`
asks for confirmation and then behaves like `update`. Use `--yes` to skip the
prompt; `--force` bypasses conflict checks but still asks for confirmation
(combine with `--yes` for automation).

### Update value and/or metadata

```bash
scync update STRIPE_SECRET_KEY -v "sk_live_new..."
scync update STRIPE_SECRET_KEY --notes "moved to new account"
scync update STRIPE_SECRET_KEY -F ./new-token.txt
```

### Rotate a key

Same as update, but it also records that a rotation happened (visible in the
web app's dashboard):

```bash
scync rotate STRIPE_SECRET_KEY -v "sk_live_rotated..."
```

### Restore an old version

`scync show` lists previous versions. To roll back:

```bash
scync restore STRIPE_SECRET_KEY 1      # restore value from version 1
```

### Delete

```bash
scync rm OLD_KEY               # asks for confirmation
scync rm OLD_KEY --yes         # explicit confirmation for scripts
```

### About conflicts

Every write checks that the secret hasn't changed in the web app (or another
terminal) since you read it. If it changed in the meantime, the CLI refuses
with `CONFLICT` (exit code 6) instead of silently overwriting. If you're sure
you want to overwrite anyway, re-run with `--force` and confirm the prompt.
For non-interactive use: `--force --yes`.

---

## 6. Developer workflows (the reason the CLI exists)

### Run a command with secrets injected — nothing written to disk

```bash
scync run -p myapp -e Development -- npm run dev
scync run -p myapp -- docker compose up
```

This decrypts the matching secrets in memory and starts your command with them
in its environment. No `.env` file is created, no value appears on the command
line. Exit codes and `Ctrl+C` pass straight through to your command.

### Export to a `.env` file

```bash
scync pull > .env                                   # to stdout
scync pull -p myapp -e Development -o .env          # straight to a file
```

If no `--project`/`--env` is given, your configured defaults apply (section 8).

### Import an existing `.env` file

```bash
scync push .env --dry-run             # preview only: what would be created/updated
scync push .env                       # create new secrets; ask before overwriting
scync push .env --overwrite --yes     # overwrite existing ones (confirmed)
```

- Duplicate keys in the file: last value wins, duplicates collapsed.
- One bad line or one failed write doesn't abort the rest — you get a summary
  of imported / skipped / failed at the end.

### Watch live changes

See changes made in the web app (or another terminal) appear in real time:

```bash
scync watch
scync watch -p myapp -e Production --reveal   # print decrypted values on change
```

Press `Ctrl+C` to stop.

---

## 7. Special secret types

### TOTP two-factor codes

```bash
scync totp                 # list all TOTP tokens and current codes
scync totp GITHUB          # generate the 6-digit code for one (with countdown)
scync totp GITHUB --copy   # copy code to clipboard
```

### SSH keys

```bash
scync ssh ls                       # list vaulted SSH keys
scync ssh get my-server            # show public key / fingerprint
scync ssh export my-server         # write private/public key files to ~/.ssh
scync ssh config my-server         # print an ~/.ssh/config host block to paste
```

Private keys are exported with `0600` permissions, public keys with `0644`.

### Passwords (read-only)

```bash
scync passwords                    # list saved logins
scync passwords github             # search
scync passwords github --reveal    # print the actual password
scync passwords github --copy     # copy to clipboard (auto-clear)
```

### Certificates (read-only)

```bash
scync certs                        # list certificates
scync certs example.com            # show expiry, subject, issuer, SANs
```

---

## 8. Configuration

Preferences live in `~/.scync/config.json`:

```bash
scync config                                  # show current config
scync config set default.project myapp        # default project filter
scync config set default.env Development      # default environment filter
scync config set agent.timeout 30m            # how long the agent stays unlocked
scync config set auth.maxAge 30d              # how long a stored login stays valid
scync config set clipboard.timeout 30s        # 0 disables clipboard auto-clear
scync config set output.format json           # table | json | plain
scync config get default.project
scync config unset default.project
```

With `default.project` and `default.env` set, bulk commands (`ls`, `pull`,
`push`, `run`, `watch`) are automatically scoped — explicit flags still win
when given.

### Session lifetimes

Two independent timers:

| What | Default | How it ends |
|---|---|---|
| **Login** (`scync login`) | 30 days | Re-run `scync login` after the max age, or if Firebase revokes the refresh token |
| **Unlock** (`scync unlock`) | 15 min idle, 8 h maximum | `scync lock`, idle timeout, or the 8-hour cap |

The 1-hour Firebase ID token refreshes automatically and never extends the
30-day login lifetime. Raise or lower it with `auth.maxAge` (`7d`, `12h`), or
disable the cap entirely with `auth.maxAge off` — not recommended on shared
machines. `scync whoami` shows both timers.

---

## 9. Pipes, scripts and safety behavior

Brief recap of what a secrets tool must do right:

- **Secrets are masked by default** when output goes to a terminal. You must
  explicitly use `--reveal` or `--copy`, or pipe the output, to see them.
- **Pipes are special-cased**: when stdout is not a terminal, `get` prints only
  the raw value, without newlines, colors, or decoration. Human messages go to
  `stderr`, so `scync get X 2>err.log | other-tool` stays clean.
- **Prompts and warnings target stderr** — they never corrupt redirected output.
- **Values as CLI arguments** (`-v "value"`) work, but print a warning because
  arguments land in shell history and process lists. Prefer prompts, pipes, or
  `--file`.
- **Clipboard** auto-clears after 30 seconds by default, only if unchanged.

### Exit codes

| Code | Meaning | Typical fix |
|---|---|---|
| 0 | Success | — |
| 1 | General / usage error | Check the command syntax |
| 2 | Not logged in / session revoked | `scync login` |
| 3 | Vault locked | `scync unlock` |
| 4 | Secret / project not found | `scync ls` to check names |
| 5 | Multiple secrets matched | Add `-p`, `-e`, or `--id` |
| 6 | Conflict (changed elsewhere) | Re-try, or `--force` if sure |
| 7 | Network / backend error | Check connectivity |

These make scripts safe: `set -e` or `if scync get X; then ...` behave sensibly.

---

## 10. Troubleshooting

**"Auth required" (exit 2)** — your session expired or was revoked.
Run `scync login` again.

**"Vault locked" (exit 3)** — the agent timed out (default 15 min idle) or was
never unlocked. Run `scync unlock`.

**Wrong master password** — fails cleanly with no side effects. Try again; the
password is the same one you use in the web app. (Forgotten it? Use the web
app's recovery key flow.)

**`scync ls` shows an empty vault** — you logged in with a different account
than the one holding your secrets. Check `scync whoami` and re-login.

**`Secret 'X' is ambiguous` (exit 5)** — same name in multiple
projects/environments. Add `-p myapp`, `-e Production`, or `--id <docId>`.

**Command "hangs" at the end** — shouldn't happen; all one-shot commands close
their background connections. If you see it, report it (it's a bug, not a
feature).

**Vault data lives at** `~/.scync/` (session, config), or `%USERPROFILE%\.scync`
on Windows. Override the location with the `SCYNC_DIR` environment variable.

**Paranoid / CI mode** — run any key-touching command with `--no-agent`, or
`scync unlock --no-agent`, so the key lives in memory only for the duration of
that single command.

---

## 11. Command cheat sheet

```bash
# Identity
scync login [--email you@example.com]     sign in (Google or email/password)
scync whoami                              who am I signed in as
scync logout                              sign out and lock the agent

# Vault
scync unlock [--timeout 1h|--no-agent]    unlock with master password
scync lock                                lock now, purge keys from memory
scync status                              vault + agent status
scync projects                            list projects
scync projects create/update/delete       manage projects (delete asks confirmation)

# Secrets
scync ls [filters]                        list (metadata only, fast)
scync get NAME [--reveal|--copy|--raw]    get one value
scync show NAME [--json|--reveal]         full details + version history
scync set NAME                            create (value: prompt | stdin | --file)
scync update NAME -v "..."                update value/metadata
scync rotate NAME -v "..."                rotate + record rotation
scync restore NAME 1                      restore old version
scync rm NAME [--yes]                     delete (confirmed)

# Workflows
scync run -p myapp -- npm start           run with secrets in env (no .env file)
scync pull [-o .env]                      export to .env format
scync push .env [--dry-run|--overwrite --yes]   import from .env
scync watch                               stream live vault changes

# Specialized
scync totp [name]                         2FA codes
scync ssh [ls|get|export|config]          SSH keys
scync passwords [query]                   saved logins (read-only)
scync certs [query]                       certificates (read-only)

# CLI itself
scync config [list|get|set|unset]         preferences
scync completion bash|zsh|fish|powershell shell autocompletion
```
