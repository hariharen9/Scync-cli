import {
  loadConfig,
  getConfigValue,
  setConfigValue,
  unsetConfigValue,
} from '../../config/index.js';
import pc from 'picocolors';

export async function configCommand(action?: string, key?: string, value?: string): Promise<void> {
  const normAction = (action || 'list').toLowerCase();

  switch (normAction) {
    case 'list': {
      const cfg = loadConfig();
      const keys = Object.keys(cfg);
      if (keys.length === 0) {
        console.log(pc.dim('No configuration settings set.'));
        return;
      }
      console.log(pc.bold('Current Configuration:'));
      for (const k of keys.sort()) {
        console.log(`  ${pc.cyan(k)} = ${pc.yellow(String(cfg[k]))}`);
      }
      break;
    }

    case 'get': {
      if (!key) {
        console.error(pc.red('Error: Please specify key to get: scync config get <key>'));
        process.exitCode = 1;
        return;
      }
      const val = getConfigValue(key);
      if (val === undefined) {
        console.log(pc.dim(`Configuration key '${key}' is not set.`));
      } else {
        console.log(String(val));
      }
      break;
    }

    case 'set': {
      if (!key || value === undefined) {
        console.error(pc.red('Error: Please specify key and value: scync config set <key> <value>'));
        process.exitCode = 1;
        return;
      }
      setConfigValue(key, value);
      console.log(pc.green(`✓ Set ${key} = ${value}`));
      break;
    }

    case 'unset': {
      if (!key) {
        console.error(pc.red('Error: Please specify key to unset: scync config unset <key>'));
        process.exitCode = 1;
        return;
      }
      const removed = unsetConfigValue(key);
      if (removed) {
        console.log(pc.green(`✓ Unset ${key}`));
      } else {
        console.log(pc.dim(`Configuration key '${key}' was not set.`));
      }
      break;
    }

    default:
      console.error(pc.red(`Unknown config action '${action}'. Valid actions: list, get, set, unset.`));
      process.exitCode = 1;
  }
}
