/**
 * Single source of truth for the version printed by `scync --version`, the TUI
 * header and the status card.
 *
 * The build is bundled, so reading package.json at runtime does not survive
 * (the path would resolve relative to dist). A unit test asserts this value
 * matches package.json so the two cannot drift during a release.
 */
export const VERSION = '0.1.2';
