import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class FilePersistence {
  static type = 'LOCAL';
  type = 'LOCAL';

  static getFilePath(): string {
    return path.join(os.homedir(), '.scync', 'auth_state.json');
  }

  private readStorage(): Record<string, any> {
    try {
      const p = FilePersistence.getFilePath();
      if (!fs.existsSync(p)) return {};
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return {};
    }
  }

  private writeStorage(storage: Record<string, any>): void {
    const p = FilePersistence.getFilePath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(p, JSON.stringify(storage, null, 2), {
      mode: 0o600,
      encoding: 'utf8',
    });
  }

  async _isAvailable(): Promise<boolean> {
    return true;
  }

  async _set(key: string, value: any): Promise<void> {
    const storage = this.readStorage();
    storage[key] = value;
    this.writeStorage(storage);
  }

  async _get(key: string): Promise<any> {
    const storage = this.readStorage();
    const value = storage[key];
    return value === undefined ? null : value;
  }

  async _remove(key: string): Promise<void> {
    const storage = this.readStorage();
    delete storage[key];
    this.writeStorage(storage);
  }

  _addListener(): void {}
  _removeListener(): void {}
}

export function clearAuthState(): void {
  try {
    const p = FilePersistence.getFilePath();
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  } catch (_) {}
}
