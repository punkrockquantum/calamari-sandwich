import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { VoiceAcousticSignature, VoiceProfile, VoiceTraits } from '../../shared/types.js';

export const ALLOWED_VOICE_AUDIO_MIMES = new Set([
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/vnd.wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/webm',
  'audio/ogg',
  'audio/opus',
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
  'audio/x-aac',
  'audio/x-m4a',
  'audio/flac',
  'audio/x-flac',
  'audio/3gpp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

const VOICE_EXTENSION_MIME_MAP: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

export function normalizeMimeType(mimetype?: string): string {
  return (mimetype || '').split(';')[0].trim().toLowerCase();
}

export function resolveVoiceSampleMimeType(mimetype?: string, filename?: string): string | null {
  const normalized = normalizeMimeType(mimetype);
  if (ALLOWED_VOICE_AUDIO_MIMES.has(normalized)) {
    return normalized;
  }
  if (!normalized || normalized === 'application/octet-stream') {
    const ext = path.extname(filename || '').toLowerCase();
    return VOICE_EXTENSION_MIME_MAP[ext] || null;
  }
  return null;
}

export function inferVoiceExtension(mimetype?: string, filename?: string): string {
  const rawExt = path.extname(filename || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  if (rawExt && VOICE_EXTENSION_MIME_MAP[rawExt]) {
    return rawExt;
  }
  const normalized = normalizeMimeType(mimetype);
  switch (normalized) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return '.mp3';
    case 'audio/webm':
      return '.webm';
    case 'audio/ogg':
    case 'audio/opus':
      return '.ogg';
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/x-m4a':
      return '.m4a';
    case 'audio/aac':
    case 'audio/x-aac':
      return '.aac';
    case 'audio/flac':
    case 'audio/x-flac':
      return '.flac';
    case 'video/mp4':
      return '.mp4';
    case 'video/webm':
      return '.webm';
    case 'video/quicktime':
      return '.mov';
    default:
      return '.wav';
  }
}

interface VoiceStoreFile {
  voices: VoiceProfile[];
}

export class VoiceStore {
  private readonly dataFile: string;
  private readonly voicesUploadDir: string;
  private initialized = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(baseDir: string = path.resolve(process.cwd(), 'data')) {
    this.dataFile = path.join(baseDir, 'voices.json');
    this.voicesUploadDir = path.join(baseDir, 'uploads', 'voices');
  }

  getVoicesUploadDir(): string {
    return this.voicesUploadDir;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
    await fs.mkdir(this.voicesUploadDir, { recursive: true });
    try {
      await fs.access(this.dataFile);
    } catch {
      await this.writeAtomically({ voices: [] });
    }
    this.initialized = true;
  }

  private async readData(): Promise<VoiceStoreFile> {
    await this.ensureInitialized();
    const raw = await fs.readFile(this.dataFile, 'utf-8');
    const parsed = JSON.parse(raw) as VoiceStoreFile;
    return { voices: Array.isArray(parsed?.voices) ? parsed.voices : [] };
  }

  private async writeAtomically(data: VoiceStoreFile): Promise<void> {
    const tmpFile = `${this.dataFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpFile, this.dataFile);
  }

  private enqueueWrite<T>(
    fn: (data: VoiceStoreFile) => Promise<{ data: VoiceStoreFile; result: T }> | { data: VoiceStoreFile; result: T }
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

  async listVoices(): Promise<VoiceProfile[]> {
    const data = await this.readData();
    return data.voices;
  }

  async getVoice(voiceId: string): Promise<VoiceProfile | null> {
    const data = await this.readData();
    return data.voices.find((v) => v.voice_id === voiceId) || null;
  }

  async createClonedVoice(params: {
    name: string;
    description?: string;
    sampleUrl?: string;
    sampleMimeType?: string;
    playbackMode?: 'speak-script' | 'direct-sample';
    traits: VoiceTraits;
    acousticSignature?: VoiceAcousticSignature;
  }): Promise<VoiceProfile> {
    const sig = params.acousticSignature;
    const voice: VoiceProfile = {
      voice_id: `native-${crypto.randomUUID().slice(0, 8)}`,
      name: params.name.trim(),
      category: 'cloned-native',
      source: 'native',
      labels: {
        tone: params.traits.tone,
        pitch: params.traits.pitch,
        cadence: params.traits.cadence,
        warmth: `${params.traits.warmth}%`,
        ...(sig ? { f0: `${sig.f0Hz}Hz`, rate: `${sig.speakingRateWpm}wpm` } : {}),
      },
      description:
        params.description?.trim() ||
        `Native voice (${params.traits.tone}, ${params.traits.pitch} pitch, ${params.traits.cadence} cadence${sig ? `, ${sig.f0Hz} Hz` : ''}).`,
      sampleUrl: params.sampleUrl,
      sampleMimeType: params.sampleMimeType,
      playbackMode: params.playbackMode || 'speak-script',
      traits: params.traits,
      acousticSignature: sig,
      pushStatus: 'local',
      createdAt: new Date().toISOString(),
    };

    return this.enqueueWrite((data) => {
      data.voices.unshift(voice);
      return { data, result: voice };
    });
  }

  async updateVoice(
    voiceId: string,
    patch: Partial<VoiceProfile>
  ): Promise<VoiceProfile | null> {
    return this.enqueueWrite((data) => {
      const idx = data.voices.findIndex((v) => v.voice_id === voiceId);
      if (idx < 0) return { data, result: null };
      const updated = { ...data.voices[idx], ...patch };
      data.voices[idx] = updated;
      return { data, result: updated };
    });
  }

  async deleteVoice(voiceId: string): Promise<boolean> {
    return this.enqueueWrite((data) => {
      const before = data.voices.length;
      data.voices = data.voices.filter((v) => v.voice_id !== voiceId);
      return { data, result: data.voices.length < before };
    });
  }
}
