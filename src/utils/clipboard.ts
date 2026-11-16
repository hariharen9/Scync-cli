import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
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

  // Compute SHA-256 hash of the copied value.
  // We NEVER pass the plaintext secret or hash in command line arguments (spec §11.2)
  // because any local process can inspect process arguments (e.g. via Get-CimInstance or ps).
  // The hash is delivered securely over private stdin pipe to the background worker.
  try {
    const expectedHash = crypto.createHash('sha256').update(text).digest('hex');
    const timeoutMs = timeoutSecs * 1000;

    const workerScript = `
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const [expectedHash, timeoutStr] = input.trim().split(/\\r?\\n/);
  const timeoutMs = Number(timeoutStr) || 30000;

  function get() {
    if (process.platform === 'win32') {
      return (spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard'], { encoding: 'utf8' }).stdout || '').replace(/\\r?\\n$/, '');
    } else if (process.platform === 'darwin') {
      return (spawnSync('pbpaste', [], { encoding: 'utf8' }).stdout || '').replace(/\\r?\\n$/, '');
    } else {
      return (spawnSync('xclip', ['-selection', 'clipboard', '-o'], { encoding: 'utf8' }).stdout || '').replace(/\\r?\\n$/, '');
    }
  }

  function clear() {
    if (process.platform === 'win32') {
      spawnSync('clip', [], { input: '' });
    } else if (process.platform === 'darwin') {
      spawnSync('pbcopy', [], { input: '' });
    } else {
      spawnSync('xclip', ['-selection', 'clipboard'], { input: '' });
    }
  }

  setTimeout(() => {
    try {
      const current = get();
      const currentHash = crypto.createHash('sha256').update(current).digest('hex');
      if (currentHash === expectedHash) {
        clear();
      }
    } catch {}
    process.exit(0);
  }, timeoutMs);
});
`;

    const bg = spawn(process.execPath, ['--input-type=module', '-e', workerScript], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });

    bg.stdin.write(expectedHash + '\n' + timeoutMs + '\n');
    bg.stdin.end();
    bg.unref();
  } catch {
    // Non-fatal if auto-clear daemon fails to spawn
  }

  return true;
}
