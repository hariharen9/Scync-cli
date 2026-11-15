import * as readline from 'node:readline';

export async function promptPassword(query = 'Master password: '): Promise<string> {
  // Support non-interactive master password from env if explicitly set
  if (process.env.SCYNC_MASTER_PASSWORD) {
    return process.env.SCYNC_MASTER_PASSWORD;
  }

  return new Promise((resolve) => {
    // If stdin is not a TTY (pipe), read directly without raw mode
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr,
        terminal: false
      });
      rl.question('', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    process.stderr.write(query);
    let password = '';

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (chunk: Buffer) => {
      const str = chunk.toString();
      for (const char of str) {
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004': // EOT
            process.stdin.setRawMode(false);
            process.stdin.removeListener('data', onData);
            process.stderr.write('\n');
            resolve(password);
            return;
          case '\u0003': // Ctrl+C
            process.stdin.setRawMode(false);
            process.stderr.write('\n');
            process.exit(130);
            return;
          case '\u0008': // Backspace
          case '\x7f':
            if (password.length > 0) {
              password = password.slice(0, -1);
            }
            break;
          default:
            password += char;
            break;
        }
      }
    };

    process.stdin.on('data', onData);
  });
}

export async function promptText(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr
    });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function promptConfirm(query: string, defaultYes = false): Promise<boolean> {
  const suffix = defaultYes ? ' [Y/n]: ' : ' [y/N]: ';
  const answer = await promptText(query + suffix);
  if (!answer) return defaultYes;
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}
