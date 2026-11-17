import fs from 'node:fs/promises';
import path from 'node:path';
import type { CharacterProfile, ExplainerProject } from '../../shared/types.js';
import { PRESET_CHARACTERS } from '../services/characterService.js';
import { generateExplainerProject } from '../services/scriptGenerator.js';

interface StoreData {
  projects: ExplainerProject[];
  characters: CharacterProfile[];
}

export class ProjectStore {
  private readonly dataFile: string;
  private readonly uploadsDir: string;
  private initialized = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(baseDir: string = path.resolve(process.cwd(), 'data')) {
    this.dataFile = path.join(baseDir, 'projects.json');
    this.uploadsDir = path.join(baseDir, 'uploads');
  }

  getUploadsDir(): string {
    return this.uploadsDir;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
    await fs.mkdir(this.uploadsDir, { recursive: true });

    try {
      await fs.access(this.dataFile);
    } catch {
      const seedCharacters = PRESET_CHARACTERS.map((c) => ({ ...c, traits: { ...c.traits } }));
      const seedProject = generateExplainerProject({
        topic: 'How Transformer Attention & KV Caching Scale LLMs',
        durationMinutes: 5,
        audience: 'engineering',
        title: 'Transformers & KV Cache — 5m Studio Explainer',
        primaryVoiceId: 'mock-rachel',
        characters: seedCharacters,
      });
      const initial: StoreData = {
        projects: [seedProject],
        characters: seedCharacters,
      };
      await this.writeAtomically(initial);
    }
    this.initialized = true;
  }

  private async readData(): Promise<StoreData> {
    await this.ensureInitialized();
    const raw = await fs.readFile(this.dataFile, 'utf-8');
    return JSON.parse(raw) as StoreData;
  }

  private async writeAtomically(data: StoreData): Promise<void> {
    const tmpFile = `${this.dataFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpFile, this.dataFile);
  }

  private enqueueWrite<T>(fn: (data: StoreData) => Promise<{ data: StoreData; result: T }> | { data: StoreData; result: T }): Promise<T> {
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

  async listProjects(): Promise<ExplainerProject[]> {
    const data = await this.readData();
    return data.projects;
  }

  async getProject(id: string): Promise<ExplainerProject | null> {
    const data = await this.readData();
    return data.projects.find((p) => p.id === id) || null;
  }

  async saveProject(project: ExplainerProject): Promise<ExplainerProject> {
    return this.enqueueWrite((data) => {
      const idx = data.projects.findIndex((p) => p.id === project.id);
      const updated = { ...project, updatedAt: new Date().toISOString() };
      if (idx >= 0) {
        data.projects[idx] = updated;
      } else {
        data.projects.unshift(updated);
      }
      return { data, result: updated };
    });
  }

  async deleteProject(id: string): Promise<boolean> {
    return this.enqueueWrite((data) => {
      const before = data.projects.length;
      data.projects = data.projects.filter((p) => p.id !== id);
      return { data, result: data.projects.length < before };
    });
  }

  async listCharacters(): Promise<CharacterProfile[]> {
    const data = await this.readData();
    return data.characters;
  }

  async saveCharacter(character: CharacterProfile, attachToProjectId?: string): Promise<CharacterProfile> {
    return this.enqueueWrite((data) => {
      const idx = data.characters.findIndex((c) => c.id === character.id);
      if (idx >= 0) {
        data.characters[idx] = character;
      } else {
        data.characters.push(character);
      }
      if (attachToProjectId) {
        const proj = data.projects.find((p) => p.id === attachToProjectId);
        if (proj) {
          const existsInProj = proj.characters.some((c) => c.id === character.id);
          if (!existsInProj) {
            proj.characters.push(character);
            proj.updatedAt = new Date().toISOString();
          }
        }
      }
      return { data, result: character };
    });
  }
}
