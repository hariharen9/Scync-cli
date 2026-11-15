import fs from 'node:fs';
import path from 'node:path';
import { promptPassword } from './prompts.js';
import pc from 'picocolors';

export interface SecretInputOptions {
  value?: string;
  file?: string;
}

export async function readSecretValueInput(
  name: string,
  options: SecretInputOptions,
  promptLabel = 'Secret value: '
): Promise<string> {
  // 1. Direct command line option --value
  if (options.value !== undefined) {
    console.error(
      pc.yellow(
        '⚠️  Security Warning: Passing secrets as command line flags (--value) leaks them into\n' +
        '   shell history and process listings. Prefer stdin, --file, or hidden prompt.\n'
      )
    );
    return options.value;
  }

  // 2. Read from file --file
  if (options.file) {
    const filePath = path.resolve(options.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Secret input file '${options.file}' does not exist.`);
    }
    return fs.readFileSync(filePath, 'utf8').trim();
  }

  // 3. Piped stdin
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { data += chunk; });
      process.stdin.on('end', () => {
        resolve(data.trim());
      });
      process.stdin.on('error', reject);
    });
  }

  // 4. Interactive masked prompt
  return await promptPassword(promptLabel);
}

/**
 * Infers a standard ServiceName from secret name heuristics.
 * e.g. STRIPE_API_KEY -> Stripe, AWS_SECRET_ACCESS_KEY -> AWS
 */
export function inferServiceFromName(name: string): string {
  const upper = name.toUpperCase();
  if (upper.includes('STRIPE')) return 'Stripe';
  if (upper.includes('AWS')) return 'AWS';
  if (upper.includes('OPENAI')) return 'OpenAI';
  if (upper.includes('ANTHROPIC')) return 'Anthropic';
  if (upper.includes('GITHUB')) return 'GitHub';
  if (upper.includes('GITLAB')) return 'GitLab';
  if (upper.includes('SUPABASE')) return 'Supabase';
  if (upper.includes('FIREBASE')) return 'Firebase';
  if (upper.includes('VERCEL')) return 'Vercel';
  if (upper.includes('NETLIFY')) return 'Netlify';
  if (upper.includes('RAILWAY')) return 'Railway';
  if (upper.includes('CLOUDFLARE')) return 'Cloudflare';
  if (upper.includes('TWILIO')) return 'Twilio';
  if (upper.includes('SLACK')) return 'Slack';
  if (upper.includes('AZURE')) return 'Azure';
  if (upper.includes('DIGITALOCEAN')) return 'DigitalOcean';
  if (upper.includes('HUGGINGFACE')) return 'HuggingFace';
  return 'Other';
}
