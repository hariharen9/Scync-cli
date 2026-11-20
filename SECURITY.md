# Security Policy

## Reporting a vulnerability

Do not open a public issue for security problems.

Email **hurryharen@gmail.com** with:

- A description of the issue and its impact
- Reproduction steps or a proof of concept
- Affected version (`scync --version`) and platform

You will get an acknowledgement as soon as possible. Please allow time for a
fix before disclosing publicly.

## Supported versions

The latest published minor release receives security fixes.

## Design notes relevant to reports

- The vault is zero-knowledge: the server stores encrypted blobs and plaintext
  metadata only. Master passwords and derived keys are never written to disk.
- The bundled Firebase web config is public by design — it identifies the
  project, it does not authorize access. Real access control is Firebase Auth;
  confidentiality is AES-256-GCM client-side encryption.
- No OAuth client secret is bundled. Google sign-in uses PKCE with a loopback
  redirect.
- Session tokens are stored in `~/.scync/session.json` with mode `0600`, and the
  login has an absolute 30-day lifetime by default (`auth.maxAge`).
- Leaked secrets, plaintext logging, or unsalted/weak key derivation are in
  scope. Reports about the public Firebase API key alone are not.
