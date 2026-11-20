# Scync CLI — Release TODO

Goal: publish `scync-cli` to npm so users can run:

```bash
npm install -g scync-cli
scync
```

The installed command is `scync`. It works against the hosted Scync backend out
of the box, while self-hosted backends override every field through env vars.

**Status:** published. `scync-cli@0.1.0` is live on npm (`latest` and `next`),
installed and verified from the registry, with signed SLSA provenance.

---

## P0 — Out-of-the-box backend

- [x] Capture the official public Firebase web config used by the Scync web app.
- [x] Bundle it as the CLI default backend (public client config only — no
  service-account JSON, no private secrets).
- [x] Replace the old `demo-scync` fallback with the hosted production config.
- [x] Config precedence:
  1. `SCYNC_*` environment variables / `~/.scync/.env`
  2. `VITE_*` development variables
  3. bundled hosted default
- [x] Emulator mode is opt-in only (`SCYNC_USE_EMULATORS=true`).
- [x] Self-hosted projects can override every field through `SCYNC_FIREBASE_*`.
- [x] Google sign-in decision: bundle the public desktop client id and use PKCE
  loopback; ship no client secret. Email/password is the guaranteed path and
  the error message points users to it.
- [ ] Manual fresh-home test with no `~/.scync`: `scync` → login →
  unlock → `ls`/`get` → `pull`/`push` → lock.
- [x] New-user path: documented — create the account and vault at
  <https://scync.space/app>, then sign in from the terminal. The CLI detects a
  missing vault and points there.
- [x] Tests for hosted default, env override, self-host values, emulator mode.
- [ ] Optional `scync doctor` / `scync setup` (moved to P1).

---

## P0 — Package correctness

- [x] Add `LICENSE` (MIT).
- [x] Add `"files": ["dist", "bin", "README.md", "USER_GUIDE.md", "LICENSE", "CHANGELOG.md", "SECURITY.md"]`.
- [x] Add `repository`, `homepage`, `bugs`, `author`, `publishConfig`.
- [x] Add `prepublishOnly` (typecheck + tests + build).
- [x] `chmod +x bin/scync.js` (git index mode `100755`).
- [x] `npm pack --dry-run`: 15 files, ~310 kB tarball, no source/tests/scripts/
  emulator config/`.env`.
- [x] Ship `dist/*.map` for debuggability.
- [x] Clean build produces `dist` before packing.
- [x] Package name `scync-cli` is available on npm (registry 404).
- [x] Install from the packed tarball verified:
  - [x] `scync --version` → `0.1.0`
  - [x] `scync --help` (exit 0)
  - [x] bare `scync` in a non-TTY prints help
  - [x] bundled hosted config present in `dist`, no OAuth secret in `dist`
  - [ ] `scync` opens the TUI in a real terminal
  - [ ] `npx scync-cli` on Windows Terminal, macOS and Linux
- [x] Add `CHANGELOG.md`.
- [x] Add `SECURITY.md` with a reporting contact.

---

## P0 — Release pipeline

- [x] Add a GitHub Actions release workflow (`.github/workflows/publish-cli.yml`)
  triggered by `v*` tags or manual dispatch.
- [x] CI steps: `npm ci` → typecheck → tests → build → `npm pack` → publish.
- [x] Configure npm 2FA / token with bypass for CI and add the `NPM_TOKEN` secret.
- [x] Publish with provenance (`--provenance`).
- [x] Publish `0.1.0` (npm exposed it under both `next` and `latest`).
- [x] Install-test `scync-cli@next` from the registry on Windows.
- [ ] Install-test on macOS and Linux.
- [ ] Create GitHub Release notes and checksums.
- [ ] Update the website install block to `npm install -g scync-cli`.
- [x] Update README install order: npm first, source install only for
  contributors.
- [x] Update USER_GUIDE with install, first run, self-hosting, config precedence,
  Google sign-in, and session lifetimes.
- [x] Keep clone/build/link documented for contributors and self-hosters.

---

## P1 — Post-release polish

- [ ] `scync doctor` for backend/auth/agent health.
- [ ] Optional `scync setup` wizard for hosted vs self-hosted config.
- [ ] Shell completion install instructions for bash/zsh/fish/PowerShell.
- [ ] Homebrew tap and Scoop manifest.
- [ ] CI matrix across Node 20/22 and Windows/macOS/Linux.
- [ ] npm download/version badges.
- [ ] Decide whether standalone binaries are ever needed. Not a blocker; npm is
  the primary channel.

---

## Release recommendation

Use npm as the primary distribution channel. Pair it with GitHub Releases for
notes/checksums. Do not make a curl installer or raw repo tarball the main
install path.

Keep the package name `scync-cli`; the installed binary remains `scync`.
