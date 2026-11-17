# Scync TUI

A full-screen terminal interface for the Scync vault, modelled on the web app:
dashboard, secrets, projects, passwords, TOTP, SSH keys, certificates, tools and
settings — all using the same zero-knowledge core as the rest of the CLI.

Launch it with:

```bash
scync              # bare command opens the TUI in a real terminal
scync tui          # or: scync ui
scync tui --ascii  # ASCII borders for limited terminals
scync tui --no-agent
```

It requires an interactive TTY. Piped/CI invocations get a clear error and
should use the regular commands instead.

On launch, a short animated splash shows the brand, session identity, vault,
agent and crypto status while bootstrap runs. Any key skips it once ready;
otherwise it advances automatically. On exit, `buildExitScreen()` prints a
branded vault-sealed card to the normal terminal buffer (so it stays in
scrollback), including the reason for closure and a reminder that no plaintext
was written.

## Architecture

```
src/tui/
├── app.ts          # state machine, key routing, async actions, render loop
├── terminal.ts     # alternate screen, raw mode, diffed row rendering, suspend/resume
├── buffer.ts       # ANSI cell grid with clipping, boxes, wide-character support
├── width.ts        # wcwidth-style measurement, wrapping, sanitisation
├── keys.ts         # CSI/SS3/control/bracketed-paste parser
├── theme.ts        # palette + glyphs + truecolor/256/16/none detection
├── editor.ts       # cursor-aware text editor used by form fields
├── overlays.ts     # help, confirm, picker, viewer and form rendering
├── widgets.ts      # header, sidebar, footer, panels, stat tiles, lists
├── logo.ts         # block wordmark + animated sweep
├── views/splash.ts # branded secure-session launch sequence
├── format.ts       # health/attention, filtering, sorting, colors, masks
├── data.ts         # auth, workspace loading, decrypt/copy/export/import/run
├── state.ts        # state shapes, view metadata, modal/form types
└── views/          # one renderer + key handler per screen
```

No third-party TUI framework is used. `Buffer` stores a grid of cells
(character + foreground/background + attributes); components draw into it and
`Terminal` writes only the rows that changed. This makes overlays, clipping,
side-by-side panes and wide characters deterministic, and keeps the dependency
surface of a security tool small.

## Data flow

- The TUI never re-implements crypto. It calls the same `core/crypto.ts`,
  `core/firestore.ts`, `core/vault-session.ts`, agent and auth modules as the
  CLI.
- `data.ts` loads metadata-only collections in parallel. Values are decrypted
  only on explicit reveal/copy/edit/view actions.
- Secrets are masked by default and auto-hide after 15 seconds. Clipboard copies
  use the same detached auto-clear worker and configured timeout as the CLI.
- Writes go through `createSecret` / `updateSecret` / `restoreSecretVersion` with
  optimistic version checks, so concurrent web edits surface as conflicts
  instead of silent overwrites.
- Locking clears all plaintext caches, revealed values and decrypted TOTP
  secrets.

## Keys

Global:

| Key | Action |
|---|---|
| `1` … `9` | Jump to a view |
| `←` / `→` | Previous / next view |
| `[` / `]` | Previous / next view |
| `U` / `L` | Unlock / lock the vault |
| `Ctrl+R` | Refresh vault data |
| `?` | Help overlay |
| `q` / `Ctrl+C` | Quit |

Lists: `↑`/`↓` or `j`/`k` move, `PageUp`/`PageDown` page, `Enter` opens,
`Tab` toggles the detail pane, `/` searches.

`Esc` is the universal back key: it closes a modal, leaves a detail pane,
clears the active search/filters, and then returns to the previous view
(dashboard if there is no history).

A lone `ESC` is held for ~40 ms because it can also be the first byte of an
arrow/function-key sequence. Complete sequences are parsed immediately; split
sequences are reassembled; if no more bytes arrive the key is delivered as
Escape.

Secrets: `n` new, `e` edit, `R` rotate, `v` versions/restore, `d` delete,
`r` reveal, `c` copy value, `y` copy notes, `s` view full value, `f` filters,
`x` clear filters, `o` cycle sort, `O` toggle direction, `p` cycle project.

Passwords: `r` reveal, `c` copy password, `u` copy username, `l` copy URL,
`y` copy notes, `v` view notes.

TOTP: `c` copy code, `s` copy base32 secret, `r` retry decrypt.

SSH: `c` copy public key, `p` view private key, `y` copy private key,
`E` export to `~/.ssh`, `g` copy `~/.ssh/config` block.

Certificates: `v` view PEM, `c` copy PEM, `p` view private key, `y` copy key.

Tools: export `.env`, import `.env`, run a command with secrets injected,
unlock/lock, settings and logout.

## Parity & safety

- CLI and TUI are kept at feature parity. A new capability or behavior belongs
  in both surfaces.
- Destructive actions always confirm: secret/project delete, logout, `.env`
  overwrite, SSH key overwrite, import overwrite/force, and version-conflict
  overwrite.
- The CLI requires `--yes` for destructive non-interactive runs; the TUI shows a
  modal and never proceeds on a single accidental keypress.

## Platform notes

- Windows Terminal (or another VT-capable terminal) is recommended. Node enables
  virtual-terminal processing for TTY stdout; legacy consoles may render
  incorrectly.
- Set `SCYNC_TUI_ASCII=1` (or pass `--ascii`) for ASCII box drawing.
- `SCYNC_TUI_COLORS=0|16|256|24` forces a colour depth; `NO_COLOR` disables
  colour.
- The alternate screen, cursor, raw mode and bracketed paste are restored on
  quit, `Ctrl+C`, uncaught render errors and process signals.

## Adding a view

1. Add an id to `ViewId`/`VIEW_ORDER`/`VIEW_META` in `state.ts`.
2. Create `views/myview.ts` exporting `renderMyView(app, buf, rect)` and
   `handleMyViewKey(app, key)`.
3. Dispatch both in `app.ts` and add footer hints.
4. Add a render case to `views.test.ts` so every view is checked for row-width
   overflow at wide and compact sizes.
