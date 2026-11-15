import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

export function readClipboard(): string {
  try {
    if (process.platform === 'win32') {
      const res = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard'], { encoding: 'utf8' });
      return (res.stdout || '').trim();
    } else if (process.platform === 'darwin') {
      const res = spawnSync('pbpaste', [], { encoding: 'utf8' });
      return (res.stdout || '').trim();
    } else {
      // Linux
      const res = spawnSync('xclip', ['-selection', 'clipboard', '-o'], { encoding: 'utf8' });
      if (res.error) {
        const wlRes = spawnSync('wl-paste', [], { encoding: 'utf8' });
        return (wlRes.stdout || '').trim();
      }
      return (res.stdout || '').trim();
    }
  } catch {
    return '';
  }
}

export function writeClipboard(text: string): boolean {
  try {
    if (process.platform === 'win32') {
      const res = spawnSync('clip', [], { input: text, encoding: 'utf8' });
      return res.status === 0;
    } else if (process.platform === 'darwin') {
      const res = spawnSync('pbcopy', [], { input: text, encoding: 'utf8' });
      return res.status === 0;
    } else {
      // Linux
      let res = spawnSync('xclip', ['-selection', 'clipboard'], { input: text, encoding: 'utf8' });
      if (res.error || res.status !== 0) {
        res = spawnSync('wl-copy', [], { input: text, encoding: 'utf8' });
      }
      return res.status === 0;
    }
  } catch {
    return false;
  }
}

export function copyWithAutoClear(text: string, timeoutSecs = 30): boolean {
  const success = writeClipboard(text);
  if (!success) return false;

  if (timeoutSecs <= 0) return true;

  // Launch a detached worker process that waits timeoutSecs, verifies the clipboard hasn't changed,
  // and clears it if it still holds what we put there.
  try {
    const script = `
      import { spawnSync, spawn } from 'node:child_process';
      const expected = ${JSON.stringify(text)};
      const platform = process.platform;
      
      function get() {
        if (platform === 'win32') {
          return (spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard'], { encoding: 'utf8' }).stdout || '').trim();
        } else if (platform === 'darwin') {
          return (spawnSync('pbpaste', [], { encoding: 'utf8' }).stdout || '').trim();
        } else {
          return (spawnSync('xclip', ['-selection', 'clipboard', '-o'], { encoding: 'utf8' }).stdout || '').trim();
        }
      }
      
      function clear() {
        if (platform === 'win32') {
          spawnSync('clip', [], { input: '' });
        } else if (platform === 'darwin') {
          spawnSync('pbcopy', [], { input: '' });
        } else {
          spawnSync('xclip', ['-selection', 'clipboard'], { input: '' });
        }
      }

      setTimeout(() => {
        try {
          if (get() === expected.trim()) {
            clear();
          }
        } catch {}
        process.exit(0);
      }, ${timeoutSecs * 1000});
    `;

    const bg = spawn(process.execPath, ['--input-type=module', '-e', script], {
      detached: true,
      stdio: 'ignore'
    });
    bg.unref();
  } catch (err) {
    // Non-fatal if auto-clear daemon fails to spawn
  }

  return true;
}
