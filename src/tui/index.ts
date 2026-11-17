import { TuiApp, type TuiOptions } from './app.js';

export type { TuiOptions } from './app.js';
export { TuiApp } from './app.js';

/**
 * Launch the interactive terminal UI. Resolves when the user quits; the caller
 * (runCli) is then responsible for closing Firebase and exiting the process.
 */
export async function runTui(options: TuiOptions = {}): Promise<void> {
  const app = new TuiApp(options);
  await app.run();
}
