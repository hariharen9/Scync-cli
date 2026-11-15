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
      const child = spawn('powershell', ['-NoProfile', '-Command', '$Input | Set-Clipboard'], {
        stdio: ['pipe', 'ignore', 'ignore']
      });
      child.stdin.write(text);
      child.stdin.end();
      return true;
    } else if (process.platform === 'darwin') {
      const child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
      child.stdin.write(text);
      child.stdin.end();
      return true;
    } else {
      // Linux
      const child = spawn('xclip', ['-selection', 'clipboard'], { stdio: ['pipe', 'ignore', 'ignore'] });
      child.on('error', () => {
        try {
          const wlChild = spawn('wl-copy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
          wlChild.stdin.write(text);
          wlChild.stdin.end();
        } catch {}
      });
      child.stdin.write(text);
      child.stdin.end();
      return true;
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
          const c = spawn('powershell', ['-NoProfile', '-Command', 'Set-Clipboard -Value \"\"'], { stdio: 'ignore' });
        } else if (platform === 'darwin') {
          const c = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
          c.stdin.end();
        } else {
          const c = spawn('xclip', ['-selection', 'clipboard'], { stdio: ['pipe', 'ignore', 'ignore'] });
          c.stdin.end();
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
