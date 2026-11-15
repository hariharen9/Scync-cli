import fs from 'node:fs';
import path from 'node:path';
import { getValidSession } from '../../auth/session.js';
import { getSecrets, createSecret, updateSecret, logLedgerEvent } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import { parseEnvFile } from '../../utils/env.js';
import { inferServiceFromName } from '../input.js';
import type { SecretType, Environment, SecretStatus } from '../../core/types.js';
import pc from 'picocolors';

export interface PushOptions {
  project?: string;
  env?: string;
  service?: string;
  type?: string;
  overwrite?: boolean;
  dryRun?: boolean;
}

export async function pushCommand(fileArg?: string, options: PushOptions = {}): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  // 1. Read input content from file or stdin
  let content = '';
  if (fileArg) {
    const absPath = path.resolve(fileArg);
    if (!fs.existsSync(absPath)) {
      throw new CliError(`File '${fileArg}' does not exist.`, ExitCode.NOT_FOUND);
    }
    content = fs.readFileSync(absPath, 'utf8');
  } else if (!process.stdin.isTTY) {
    content = await new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { data += chunk; });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
  } else {
    throw new CliError('Please specify a .env file to import: scync push <file.env>', ExitCode.GENERAL_ERROR);
  }

  // 2. Parse entries
  const entries = parseEnvFile(content);
  if (entries.length === 0) {
    console.error(pc.yellow('No valid environment variables found in input.'));
    return;
  }

  const db = getDb();
  const allSecrets = await getSecrets(session.uid, db);

  const env = (options.env || 'Development') as Environment;
  const project = options.project || null;

  // 3. Dry-run simulation
  if (options.dryRun) {
    console.log(pc.bold(`--- Simulating .env Import (${entries.length} items to ${env}) ---`));
    let wouldCreate = 0;
    let wouldUpdate = 0;
    let wouldSkip = 0;

    for (const item of entries) {
      const match = allSecrets.find(s => 
        s.name.toLowerCase() === item.key.toLowerCase() &&
        s.environment.toLowerCase() === env.toLowerCase() &&
        (s.projectId || null) === project
      );

      const srv = options.service || inferServiceFromName(item.key);

      if (!match) {
        console.log(`${pc.green('[CREATE]'.padEnd(10))} ${pc.bold(item.key.padEnd(24))} (${srv})`);
        wouldCreate++;
      } else if (options.overwrite) {
        console.log(`${pc.yellow('[UPDATE]'.padEnd(10))} ${pc.bold(item.key.padEnd(24))} (v${(match.version || 1) + 1})`);
        wouldUpdate++;
      } else {
        console.log(`${pc.dim('[SKIP]'.padEnd(10))}   ${item.key.padEnd(24)} (already exists, use --overwrite)`);
        wouldSkip++;
      }
    }

    console.log(pc.dim('─'.repeat(50)));
    console.log(`Dry-run summary: ${pc.green(`${wouldCreate} would create`)}, ${pc.yellow(`${wouldUpdate} would update`)}, ${pc.dim(`${wouldSkip} skipped`)}.`);
    return;
  }

  // 4. Real Import
  const { key } = await unlockVault(session.uid, db);

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const errors: Array<{ key: string; error: string }> = [];

  for (const item of entries) {
    const match = allSecrets.find(s => 
      s.name.toLowerCase() === item.key.toLowerCase() &&
      s.environment.toLowerCase() === env.toLowerCase() &&
      (s.projectId || null) === project
    );

    const srv = options.service || inferServiceFromName(item.key);
    const secType = (options.type || 'Secret Key') as SecretType;

    if (!match) {
      // Create new secret
      try {
        await createSecret(session.uid, key, {
          name: item.key,
          service: srv,
          type: secType,
          environment: env,
          status: 'Active',
          value: item.value,
          notes: 'Imported via scync push',
          lastRotated: new Date(),
          expiresOn: null,
          projectId: project,
          remainingCodes: null
        }, db);
        createdCount++;
        console.log(`${pc.green('✓')} Created ${pc.bold(item.key)}`);
      } catch (err: any) {
        errors.push({ key: item.key, error: err.message });
        console.error(`${pc.red('✗')} Failed to create ${item.key}: ${err.message}`);
      }
    } else if (options.overwrite) {
      // Update existing secret
      try {
        await updateSecret(
          session.uid,
          key,
          match.id,
          {
            name: match.name,
            service: match.service,
            type: match.type,
            environment: match.environment,
            status: match.status,
            value: item.value,
            notes: match.encNotes ? 'Imported update' : '',
            lastRotated: match.lastRotated,
            expiresOn: match.expiresOn,
            projectId: match.projectId,
            remainingCodes: match.remainingCodes
          },
          match,
          'updated',
          db,
          { force: true }
        );
        updatedCount++;
        console.log(`${pc.yellow('✓')} Updated ${pc.bold(item.key)} to v${(match.version || 1) + 1}`);
      } catch (err: any) {
        errors.push({ key: item.key, error: err.message });
        console.error(`${pc.red('✗')} Failed to update ${item.key}: ${err.message}`);
      }
    } else {
      skippedCount++;
    }
  }

  // Log activity ledger event
  await logLedgerEvent(session.uid, {
    action: 'env_imported',
    title: `Imported ${entries.length} variables to ${env}`,
    details: `${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped`,
  }, db);

  console.log(pc.bold('\n--- Import Summary ---'));
  console.log(
    `Total: ${entries.length} | ` +
    `${pc.green(`${createdCount} created`)} | ` +
    `${pc.yellow(`${updatedCount} updated`)} | ` +
    `${pc.dim(`${skippedCount} skipped`)}` +
    (errors.length > 0 ? ` | ${pc.red(`${errors.length} failed`)}` : '')
  );
}
