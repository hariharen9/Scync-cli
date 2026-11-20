# Scync CLI — Release TODO

Goal: publish `scync-cli` to npm so users can run:

```bash
npm install -g scync-cli
scync
```

The installed command is `scync`. It must work against the hosted Scync backend out of the box, while still allowing self-hosted backends.

Do not publish until all **P0** items are done.

---

## P0 — Out-of-the-box backend

- [ ] Capture the official public Firebase web config used by the Scync web app:
  - `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`
- [ ] Bundle that config as the CLI default backend (public Firebase client config only — no service-account JSON, no private secrets).
- [ ] Replace the current `demo-scync` fallback with the hosted production config.
- [ ] Define config precedence clearly:
  1. Explicit environment variables / `~/.scync/.env`
  2. Bundled hosted default
- [ ] Keep emulator mode opt-in only (`SCYNC_USE_EMULATORS=true`); never accidentally default to emulators.
- [ ] Verify self-hosted projects can override every field through `SCYNC_FIREBASE_*` variables.
- [ ] Decide Google sign-in behavior for npm users:
  - bundle an official desktop/loopback OAuth client, or
  - make email/password the guaranteed out-of-box path and clearly explain Google setup.
- [ ] Verify first-run experience with no `~/.scync` directory: `scync` → login → setup/unlock works.
- [ ] Verify new-user account creation:
  - either support it in the CLI/TUI, or send users to the web app with clear instructions.
- [ ] Decide whether to add `scync doctor` / `scync setup` for backend config and connectivity checks.
- [ ] Add tests for: hosted default, env override, self-host values, emulator mode.
- [ ] Manual fresh-home test: login → setup/unlock → `ls`/`get` → `pull`/`push` → lock.

---

## P0 — Package correctness

Current issues found in `npm pack --dry-run`:

- 121 files / 2.1 MB unpacked, including `src/`, tests, scripts, `spec.md`, `preview.html`, `firebase.json`, and internal docs.
- No `LICENSE` file, despite `"license": "MIT"`.
- No `files` allowlist or publish metadata.
- `bin/scync.js` is mode `0644`.

Tasks:

- [ ] Add `LICENSE` (MIT).
- [ ] Add `"files": ["dist", "bin", "README.md", "USER_GUIDE.md", "LICENSE"]`.
- [ ] Add `repository`, `homepage`, `bugs`, and a real `author`.
- [ ] Add `prepublishOnly` that runs typecheck/build/unit tests.
- [ ] Add `publishConfig` as needed.
- [ ] `chmod +x bin/scync.js` and verify the shebang.
- [ ] Re-run `npm pack --dry-run`; confirm no source, tests, scripts, emulator config, preview HTML, or `.env` files.
- [ ] Decide whether to ship `dist/*.map` (debuggability vs. package size).
- [ ] Verify a clean checkout can build `dist` before packing.
- [ ] Verify package name `scync-cli` availability; decide fallback to a scoped name if taken.
- [ ] Install from the packed tarball and verify:
  - [ ] `scync --help`
  - [ ] `scync` opens the TUI in a real terminal
  - [ ] `npx scync-cli`
  - [ ] Windows Terminal and Unix terminals
- [ ] Add a `CHANGELOG.md`.
- [ ] Add `SECURITY.md` or a release security contact.

---

## P0 — Release pipeline

- [ ] Add a GitHub Actions release workflow triggered by version tags.
- [ ] CI steps: `npm ci` → typecheck → unit tests → build → `npm pack` → publish.
- [ ] Enable npm 2FA / trusted publishing.
- [ ] Publish with provenance from CI (`--provenance`).
- [ ] Publish `0.1.0` as a beta first (`--tag next`), not `latest`.
- [ ] Install-test `scync-cli@next` on Windows, macOS, and Linux.
- [ ] Promote to `latest` only after the beta install and fresh-home tests pass.
- [ ] Create GitHub Release notes and checksums.
- [ ] Update the website install block to `npm install -g scync-cli` after publication.
- [ ] Update README install order: npm first, source install only for contributors.
- [ ] Update USER_GUIDE with install, first run, self-hosting, config precedence, Google sign-in, and troubleshooting.
- [ ] Keep clone/build/link documented for contributors and self-hosters.

---

## P1 — Post-release polish

- [ ] `scync doctor` for backend/auth/agent health.
- [ ] Optional `scync setup` wizard for hosted vs self-hosted config.
- [ ] Shell completion install instructions for bash/zsh/fish/PowerShell.
- [ ] Homebrew tap and Scoop manifest.
- [ ] CI matrix across Node 20/22 and Windows/macOS/Linux.
- [ ] npm download/version badges.
- [ ] Decide whether standalone binaries are ever needed. Not a blocker; npm is the primary channel.

---

## Release recommendation

Use npm as the primary distribution channel. Pair it with GitHub Releases for notes/checksums. Do not make a curl installer or raw repo tarball the main install path.

Keep the package name `scync-cli` if available; the installed binary remains `scync`. A scoped package is a good fallback if the unscoped name is unavailable.
