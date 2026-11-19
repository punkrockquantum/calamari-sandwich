import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ImportedSource } from '../../shared/types.js';

interface SourceStoreFile {
  sources: ImportedSource[];
}

export class SourceStore {
  private readonly dataFile: string;
  private readonly sourcesUploadDir: string;
  private initialized = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(baseDir: string = path.resolve(process.cwd(), 'data')) {
    this.dataFile = path.join(baseDir, 'sources.json');
    this.sourcesUploadDir = path.join(baseDir, 'uploads', 'sources');
  }

  getSourcesUploadDir(): string {
    return this.sourcesUploadDir;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
    await fs.mkdir(this.sourcesUploadDir, { recursive: true });
    try {
      await fs.access(this.dataFile);
    } catch {
      await this.writeAtomically({ sources: [] });
    }
    this.initialized = true;
  }

  private async readData(): Promise<SourceStoreFile> {
    await this.ensureInitialized();
    const raw = await fs.readFile(this.dataFile, 'utf-8');
    const parsed = JSON.parse(raw) as SourceStoreFile;
    return { sources: Array.isArray(parsed?.sources) ? parsed.sources : [] };
  }

  private async writeAtomically(data: SourceStoreFile): Promise<void> {
    const tmpFile = `${this.dataFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpFile, this.dataFile);
  }

  private enqueueWrite<T>(
    fn: (
      data: SourceStoreFile
    ) => Promise<{ data: SourceStoreFile; result: T }> | { data: SourceStoreFile; result: T }
  ): Promise<T> {
    const run = this.writeQueue.then(async () => {
      const current = await this.readData();
      const { data, result } = await fn(current);
      await this.writeAtomically(data);
      return result;
    });
    this.writeQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async listSources(): Promise<ImportedSource[]> {
    const data = await this.readData();
    return data.sources;
  }

  async getSource(id: string): Promise<ImportedSource | null> {
    const data = await this.readData();
    return data.sources.find((s) => s.id === id) || null;
  }

  async getSourcesByIds(ids: string[]): Promise<ImportedSource[]> {
    if (!ids || ids.length === 0) return [];
    const data = await this.readData();
    const map = new Map(data.sources.map((s) => [s.id, s]));
    return ids.map((id) => map.get(id)).filter((s): s is ImportedSource => Boolean(s));
  }

  async addSource(source: Omit<ImportedSource, 'id' | 'createdAt'> & { id?: string }): Promise<ImportedSource> {
    const record: ImportedSource = {
      ...source,
      id: source.id || `src-${crypto.randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
    };
    return this.enqueueWrite((data) => {
      data.sources.unshift(record);
      return { data, result: record };
    });
  }

  async deleteSource(id: string): Promise<boolean> {
    return this.enqueueWrite((data) => {
      const before = data.sources.length;
      data.sources = data.sources.filter((s) => s.id !== id);
      return { data, result: data.sources.length < before };
    });
  }
}
