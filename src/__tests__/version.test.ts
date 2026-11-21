import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../version.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../../package.json'), 'utf8')) as {
  version: string;
};

describe('version', () => {
  it('matches package.json so releases cannot drift', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('is a plain semver release string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
