import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConnectorAccountInfo, ConnectorId } from '../../shared/types.js';

export interface StoredConnectorCredential {
  apiKey: string;
  apiSecret?: string;
  endpoint?: string;
  model?: string;
  account?: ConnectorAccountInfo;
  updatedAt: string;
}

type VaultFileSchema = Partial<Record<ConnectorId, StoredConnectorCredential>>;

export function maskCredential(apiKey?: string | null, apiSecret?: string | null): string | undefined {
  const raw = (apiSecret?.trim() || apiKey?.trim() || '').replace(/^(Bearer|Key)\s+/i, '');
  if (!raw) return undefined;
  const tailTarget = raw.includes(':') ? raw.split(':').pop() || raw : raw;
  if (tailTarget.length <= 4) {
    return '***';
  }
  return `...${tailTarget.slice(-4)}`;
}

/**
 * Formats Higgsfield credentials from either a single API key/Bearer token
 * or a Key ID + Key Secret (`Key <id>:<secret>`).
 */
export function formatHiggsfieldAuth(
  apiKey: string,
  apiSecret?: string
): {
  authHeader: string;
  scheme: 'Key' | 'Bearer';
  keyId: string;
  keySecret?: string;
  combinedRaw: string;
} {
  const trimmedKey = apiKey.trim();
  const trimmedSecret = apiSecret?.trim();

  if (trimmedSecret) {
    const cleanId = trimmedKey.replace(/^Key\s+/i, '').split(':')[0].trim();
    const combined = `Key ${cleanId}:${trimmedSecret}`;
    return {
      authHeader: combined,
      scheme: 'Key',
      keyId: cleanId,
      keySecret: trimmedSecret,
      combinedRaw: `${cleanId}:${trimmedSecret}`,
    };
  }

  if (/^Key\s+[^:\s]+:[^\s]+$/i.test(trimmedKey)) {
    const body = trimmedKey.replace(/^Key\s+/i, '').trim();
    const [keyId, ...rest] = body.split(':');
    const keySecret = rest.join(':');
    return {
      authHeader: `Key ${keyId}:${keySecret}`,
      scheme: 'Key',
      keyId,
      keySecret,
      combinedRaw: `${keyId}:${keySecret}`,
    };
  }

  if (/^[^:\s]+:[^\s]+$/.test(trimmedKey) && !trimmedKey.startsWith('http')) {
    const [keyId, ...rest] = trimmedKey.split(':');
    const keySecret = rest.join(':');
    return {
      authHeader: `Key ${keyId}:${keySecret}`,
      scheme: 'Key',
      keyId,
      keySecret,
      combinedRaw: `${keyId}:${keySecret}`,
    };
  }

  const token = trimmedKey.replace(/^Bearer\s+/i, '').trim();
  return {
    authHeader: `Bearer ${token}`,
    scheme: 'Bearer',
    keyId: token,
    combinedRaw: token,
  };
}

export class CredentialVault {
  private readonly vaultFile: string;
  private cache: VaultFileSchema = {};
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(baseDir: string = path.resolve(process.cwd(), 'data')) {
    this.vaultFile = path.join(baseDir, 'credentials.json');
    this.loadSync();
  }

  getVaultPath(): string {
    return this.vaultFile;
  }

  private loadSync(): void {
    try {
      if (fsSync.existsSync(this.vaultFile)) {
        const raw = fsSync.readFileSync(this.vaultFile, 'utf-8');
        const parsed = JSON.parse(raw) as VaultFileSchema;
        if (parsed && typeof parsed === 'object') {
          this.cache = parsed;
        }
      }
      this.loaded = true;
    } catch {
      this.cache = {};
      this.loaded = true;
    }
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loadSync();
  }

  get(id: ConnectorId): StoredConnectorCredential | undefined {
    const entry = this.cache[id];
    if (!entry || !entry.apiKey?.trim()) return undefined;
    return entry;
  }

  has(id: ConnectorId): boolean {
    return Boolean(this.get(id));
  }

  private async writeAtomically(data: VaultFileSchema): Promise<void> {
    await fs.mkdir(path.dirname(this.vaultFile), { recursive: true });
    const tmpFile = `${this.vaultFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    await fs.rename(tmpFile, this.vaultFile);
    try {
      await fs.chmod(this.vaultFile, 0o600);
    } catch {
      // Ignore chmod issues on filesystems without POSIX permissions
    }
  }

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(fn);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async set(
    id: ConnectorId,
    credential: Omit<StoredConnectorCredential, 'updatedAt'>
  ): Promise<StoredConnectorCredential> {
    return this.enqueueWrite(async () => {
      const nextEntry: StoredConnectorCredential = {
        ...credential,
        apiKey: credential.apiKey.trim(),
        apiSecret: credential.apiSecret?.trim() || undefined,
        endpoint: credential.endpoint?.trim() || undefined,
        model: credential.model?.trim() || undefined,
        updatedAt: new Date().toISOString(),
      };
      this.cache = {
        ...this.cache,
        [id]: nextEntry,
      };
      await this.writeAtomically(this.cache);
      return nextEntry;
    });
  }

  async updateAccount(
    id: ConnectorId,
    account: ConnectorAccountInfo
  ): Promise<StoredConnectorCredential | undefined> {
    return this.enqueueWrite(async () => {
      const existing = this.cache[id];
      if (!existing) return undefined;
      const updated: StoredConnectorCredential = {
        ...existing,
        account,
        updatedAt: new Date().toISOString(),
      };
      this.cache = {
        ...this.cache,
        [id]: updated,
      };
      await this.writeAtomically(this.cache);
      return updated;
    });
  }

  async delete(id: ConnectorId): Promise<boolean> {
    return this.enqueueWrite(async () => {
      const existed = Boolean(this.cache[id]);
      if (!existed) return false;
      const next = { ...this.cache };
      delete next[id];
      this.cache = next;
      await this.writeAtomically(this.cache);
      return true;
    });
  }
}
