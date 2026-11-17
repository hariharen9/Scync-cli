import fs from 'node:fs';
import path from 'node:path';
import { getValidSession } from '../../auth/session.js';
import { getSecrets, createSecret, updateSecret, decryptSecret, logLedgerEvent, resolveProjectId } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import { parseEnvFile, dedupeEnvEntries } from '../../utils/env.js';
import { inferServiceFromName } from '../input.js';
import { normalizeEnvironment, normalizeSecretType } from '../../core/constants.js';
import { getDefaultScope } from '../../config/index.js';
import { confirmDestructive } from '../confirm.js';
import { sanitizeTerminalOutput } from '../../utils/sanitize.js';
import { renderCard, envBadge, warningBanner } from '../tui.js';
import type { SecretType, Environment, SecretStatus } from '../../core/types.js';
import pc from 'picocolors';

export interface PushOptions {
  project?: string;
  env?: string;
  service?: string;
  type?: string;
  overwrite?: boolean;
  dryRun?: boolean;
  force?: boolean;
  yes?: boolean;
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

  // 2. Parse entries and collapse duplicate variable names (last value wins)
  const parsedEntries = parseEnvFile(content);
  if (parsedEntries.length === 0) {
    console.error(pc.yellow('No valid environment variables found in input.'));
    return;
  }
  const { entries, duplicates } = dedupeEnvEntries(parsedEntries);
  if (duplicates > 0) {
    console.error(pc.yellow(`Warning: ${duplicates} duplicate variable name(s) collapsed (last value wins).`));
  }

  const db = getDb();
  const allSecrets = await getSecrets(session.uid, db);

  const defaults = getDefaultScope();
  const env = options.env
    ? normalizeEnvironment(options.env)
    : (defaults.env ? normalizeEnvironment(defaults.env) : 'Development');
  const projectInput = options.project ?? defaults.project;
  const project = projectInput ? await resolveProjectId(session.uid, projectInput, db) : null;
  const secType = options.type ? normalizeSecretType(options.type) : 'Secret Key';

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
      const safeKey = sanitizeTerminalOutput(item.key);

      if (!match) {
        console.log(`${pc.green('[CREATE]'.padEnd(10))} ${pc.bold(safeKey.padEnd(24))} (${srv})`);
        wouldCreate++;
      } else if (options.overwrite) {
        console.log(`${pc.yellow('[UPDATE]'.padEnd(10))} ${pc.bold(safeKey.padEnd(24))} (v${(match.version || 1) + 1})`);
        wouldUpdate++;
      } else {
        console.log(`${pc.dim('[SKIP]'.padEnd(10))}   ${safeKey.padEnd(24)} (already exists, use --overwrite)`);
        wouldSkip++;
      }
    }

    console.log(pc.dim('─'.repeat(50)));
    console.log(`Dry-run summary: ${pc.green(`${wouldCreate} would create`)}, ${pc.yellow(`${wouldUpdate} would update`)}, ${pc.dim(`${wouldSkip} skipped`)}.`);
    return;
  }

  // 4. Real Import
  if (options.overwrite || options.force) {
    const confirmed = await confirmDestructive(
      `Import will overwrite existing secrets${options.force ? ' and bypass version checks' : ''}. Continue?`,
      { yes: options.yes }
    );
    if (!confirmed) {
      warningBanner('Aborted import. The vault was not modified.');
      return;
    }
  }

  const vault = await unlockVault(session.uid, db);

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
    const safeKey = sanitizeTerminalOutput(item.key);

    if (!match) {
      // Create new secret
      try {
        await createSecret(session.uid, vault, {
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
        console.log(`${pc.green('✓')} Created ${pc.bold(safeKey)}`);
      } catch (err: any) {
        errors.push({ key: item.key, error: err.message });
        console.error(`${pc.red('✗')} Failed to create ${safeKey}: ${err.message}`);
      }
    } else if (options.overwrite) {
      // Update existing secret - preserve existing notes by decrypting if present
      try {
        let existingNotes = '';
        if (match.encNotes) {
          try {
            const dec = await decryptSecret(vault, match);
            existingNotes = dec.notes;
          } catch {
            existingNotes = '';
          }
        }
        await updateSecret(
          session.uid,
          vault,
          match.id,
          {
            name: match.name,
            service: match.service,
            type: match.type,
            environment: match.environment,
            status: match.status,
            value: item.value,
            notes: existingNotes,
            lastRotated: match.lastRotated,
            expiresOn: match.expiresOn,
            projectId: match.projectId,
            remainingCodes: match.remainingCodes
          },
          match,
          'updated',
          db,
          { force: options.force || false }
        );
        updatedCount++;
        console.log(`${pc.yellow('✓')} Updated ${pc.bold(safeKey)} to v${(match.version || 1) + 1}`);
      } catch (err: any) {
        errors.push({ key: item.key, error: err.message });
        console.error(`${pc.red('✗')} Failed to update ${safeKey}: ${err.message}`);
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

  renderCard({
    title: 'Scync Import Summary',
    badge: errors.length > 0 ? pc.red(`● ${errors.length} failed`) : pc.green('● Complete'),
    rows: [
      { key: 'Environment', val: envBadge(env) },
      { key: 'Created', val: pc.green(`${createdCount} secret(s) created`) },
      { key: 'Updated', val: pc.yellow(`${updatedCount} secret(s) updated`) },
      { key: 'Skipped', val: pc.dim(`${skippedCount} unchanged`) },
      { key: 'Total Processed', val: `${entries.length} variable(s)` }
    ],
    footer: pc.dim('Events recorded in Zero-Knowledge Vault Activity Ledger')
  });

  if (errors.length > 0) {
    throw new CliError(`Import completed with ${errors.length} error(s).`, ExitCode.GENERAL_ERROR);
  }
}
