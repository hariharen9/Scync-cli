import { getValidSession } from '../../auth/session.js';
import { getSecrets, restoreSecretVersion, resolveProjectId } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import { resolveSingleSecret } from '../resolve.js';
import type { SecretVersion } from '../../core/types.js';
import { successBanner, envBadge } from '../tui.js';
import pc from 'picocolors';

export interface RestoreOptions {
  project?: string;
  env?: string;
  id?: string;
  force?: boolean;
}

export async function restoreCommand(name: string, versionArg: string, options: RestoreOptions): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const targetVerNum = parseInt(versionArg.replace(/^v/i, ''), 10);
  if (isNaN(targetVerNum)) {
    throw new CliError(`Invalid version number '${versionArg}'. Must be an integer like 1 or v1.`, ExitCode.GENERAL_ERROR);
  }

  const db = getDb();
  const allSecrets = await getSecrets(session.uid, db);
  const projectId = options.project ? await resolveProjectId(session.uid, options.project, db) : undefined;
  const target = resolveSingleSecret(allSecrets, name, {
    id: options.id,
    project: projectId,
    env: options.env
  });
  const versions = target.versions || [];
  const targetVer = versions.find((v: SecretVersion) => v.version === targetVerNum);

  if (!targetVer) {
    const available = versions.map((v: SecretVersion) => `v${v.version}`).join(', ') || 'none';
    throw new CliError(
      `Version ${targetVerNum} not found in history for secret '${target.name}'. Available versions: ${available}`,
      ExitCode.NOT_FOUND
    );
  }

  const vault = await unlockVault(session.uid, db);

  await restoreSecretVersion(session.uid, vault, target.id, targetVerNum, target, db);

  const nextVer = (target.version || 1) + 1;
  successBanner(`Restored '${target.name}' from v${targetVerNum}`, [
    { key: 'Version', val: `${pc.dim(`v${target.version || 1}`)} → ${pc.bold(`v${nextVer}`)} (restored from v${targetVerNum})` },
    { key: 'Environment', val: envBadge(target.environment) },
    { key: 'Service', val: target.service }
  ]);
}
