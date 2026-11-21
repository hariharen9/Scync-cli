# Changelog

All notable changes to `scync-cli` are documented here.

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
