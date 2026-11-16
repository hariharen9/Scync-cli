import {
  loadConfig,
  getConfigValue,
  setConfigValue,
  unsetConfigValue,
} from '../../config/index.js';
import { renderCard, successBanner, infoBanner } from '../tui.js';
import pc from 'picocolors';

export async function configCommand(action?: string, key?: string, value?: string): Promise<void> {
  const normAction = (action || 'list').toLowerCase();

  switch (normAction) {
    case 'list': {
      const cfg = loadConfig();
      const keys = Object.keys(cfg);
      if (keys.length === 0) {
        infoBanner('No configuration settings set. Using defaults.');
        return;
      }
      const rows = keys.sort().map(k => ({
        key: k,
        val: pc.cyan(String(cfg[k]))
      }));
      renderCard({
        title: 'Scync Configuration',
        rows,
        footer: pc.dim('Stored in ~/.scync/config.json')
      });
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
        infoBanner(`Configuration key '${key}' is not set.`);
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
      successBanner(`Updated configuration '${key}'`, [
        { key: 'Key', val: key },
        { key: 'Value', val: pc.cyan(value) }
      ]);
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
        successBanner(`Unset configuration '${key}'`);
      } else {
        infoBanner(`Configuration key '${key}' was not set.`);
      }
      break;
    }

    default:
      console.error(pc.red(`Unknown config action '${action}'. Valid actions: list, get, set, unset.`));
      process.exitCode = 1;
  }
}
