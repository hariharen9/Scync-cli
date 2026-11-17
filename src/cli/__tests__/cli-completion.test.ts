import { describe, it, expect } from 'vitest';
import {
  generateBashCompletion,
  generateZshCompletion,
  generatePowerShellCompletion,
} from '../commands/completion.js';

describe('Shell Completion Generators', () => {
  it('generates valid Bash completion script', () => {
    const bash = generateBashCompletion();
    expect(bash).toContain('_scync_completions()');
    expect(bash).toContain('complete -F _scync_completions scync');
    expect(bash).toContain('unlock');
    expect(bash).toContain('run');
    expect(bash).toContain('watch');
    for (const cmd of ['projects', 'totp', 'ssh', 'passwords', 'certs', 'tui']) {
      expect(bash).toContain(cmd);
    }
  });

  it('generates valid Zsh completion script', () => {
    const zsh = generateZshCompletion();
    expect(zsh).toContain('#compdef scync');
    expect(zsh).toContain('_scync()');
    expect(zsh).toContain('run:Run command with secrets injected');
  });

  it('generates valid PowerShell completion script', () => {
    const pwsh = generatePowerShellCompletion();
    expect(pwsh).toContain('Register-ArgumentCompleter');
    expect(pwsh).toContain('-CommandName scync');
    expect(pwsh).toContain('unlock');
    expect(pwsh).toContain('run');
    expect(pwsh).toContain('totp');
    expect(pwsh).toContain('certs');
  });
});
