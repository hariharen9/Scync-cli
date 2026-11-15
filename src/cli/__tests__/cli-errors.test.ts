import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createProgram } from '../index.js';
import { clearSession } from '../../auth/storage.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('CLI Exit Codes & Error Scenarios', () => {
  let testScyncDir: string;

  beforeEach(() => {
    testScyncDir = path.join(os.tmpdir(), `scync-cli-err-${Date.now()}`);
    process.env.SCYNC_DIR = testScyncDir;
    clearSession();
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testScyncDir)) {
        fs.rmSync(testScyncDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('whoami without active session fails with exit code 2 (AUTH_REQUIRED)', async () => {
    const program = createProgram();
    try {
      await program.parseAsync(['node', 'scync', 'whoami']);
      expect.fail('Should have thrown AuthRequiredError');
    } catch (err: any) {
      expect(err.name).toBe('AuthRequiredError');
      expect(err.exitCode).toBe(2);
    }
  });

  it('ls without active session fails with exit code 2 (AUTH_REQUIRED)', async () => {
    const program = createProgram();
    try {
      await program.parseAsync(['node', 'scync', 'ls']);
      expect.fail('Should have thrown AuthRequiredError');
    } catch (err: any) {
      expect(err.name).toBe('AuthRequiredError');
      expect(err.exitCode).toBe(2);
    }
  });

  it('get without active session fails with exit code 2 (AUTH_REQUIRED)', async () => {
    const program = createProgram();
    try {
      await program.parseAsync(['node', 'scync', 'get', 'ANY_SECRET']);
      expect.fail('Should have thrown AuthRequiredError');
    } catch (err: any) {
      expect(err.name).toBe('AuthRequiredError');
      expect(err.exitCode).toBe(2);
    }
  });

  it('pull without active session fails with exit code 2 (AUTH_REQUIRED)', async () => {
    const program = createProgram();
    try {
      await program.parseAsync(['node', 'scync', 'pull']);
      expect.fail('Should have thrown AuthRequiredError');
    } catch (err: any) {
      expect(err.name).toBe('AuthRequiredError');
      expect(err.exitCode).toBe(2);
    }
  });
});
