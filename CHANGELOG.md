# Changelog

All notable changes to `scync-cli` are documented here.

## 0.1.4 — 2026-11-20

### Fixed

- The published `0.1.3` tarball shipped **without** the Google client. npm runs
  `prepublishOnly` (and therefore a rebuild) without the build environment, and
  the generator overwrote the injected values with empty strings. The generator
  now preserves an existing client, the publish step receives the values, and CI
  verifies the packed tarball before uploading.

## 0.1.3 — 2026-11-20

### Fixed

- Google sign-in works on a fresh install via the bundled Google Desktop app
  OAuth client, injected from repository secrets at build time.

## 0.1.2 — 2026-11-20

### Fixed

- `scync --version` and the TUI header now report the real package version.
  They were hardcoded, so `0.1.1` still announced itself as `0.1.0`.
- Added a unit test that fails if the reported version and `package.json`
  drift apart.

## 0.1.1 — 2026-11-20

### Fixed

- **Login works out of the box.** `scync login` previously defaulted to Google
  with a Web application OAuth client, which Google rejects during token
  exchange unless a client secret is supplied — so a fresh install could not
  sign in. Email/password is now the default path and needs no configuration.
- Google sign-in is now opt-in (`scync login --google`) and only offered when an
  OAuth client id is configured. The TUI hides the Google action otherwise.

## 0.1.0 — 2026-11-20

First npm release, distributed as `scync-cli`.

### Added

- Full-screen terminal UI and scriptable CLI for the Scync zero-knowledge vault.
- Hosted Scync backend bundled as the default, so `npm install -g scync-cli && scync` works without local configuration.
- Self-hosting overrides through `SCYNC_FIREBASE_*` and `SCYNC_GOOGLE_*` variables.
- Global `/` search across secrets, projects, passwords, TOTP, SSH keys, and certificates.
- Session lifetime cap (`auth.maxAge`, default 30 days) with visible deadline in `scync whoami`.
- Zero-knowledge encryption (PBKDF2-HMAC-SHA-256, 310,000 iterations, AES-256-GCM) and a short-lived key agent.
- Google loopback sign-in (PKCE) and email/password sign-in.

### Notes

- Google sign-in uses a bundled public desktop client id and PKCE. No client secret is shipped.
- Existing Scync accounts work immediately. New accounts and vaults are created at <https://scync.space/app>.
