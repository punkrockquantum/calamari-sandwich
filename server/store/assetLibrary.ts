import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { TechAsset, TechAssetCategory } from '../../shared/types.js';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  MAX_FILE_BYTES,
  MAX_PHOTOS,
  MAX_VIDEOS,
  type UploadedMediaFile,
} from '../services/characterService.js';

interface AssetLibraryFile {
  assets: TechAsset[];
}

function makeBlueprintSvgDataUrl(title: string, subtitle: string, accent: string): string {
  const safeTitle = title.replace(/[<>&"]/g, '');
  const safeSub = subtitle.replace(/[<>&"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#071024"/>
        <stop offset="100%" stop-color="#111827"/>
      </linearGradient>
    </defs>
    <rect width="960" height="540" fill="url(#bg)"/>
    <g stroke="${accent}" stroke-opacity="0.18" stroke-width="1">
      <line x1="0" y1="135" x2="960" y2="135"/><line x1="0" y1="270" x2="960" y2="270"/><line x1="0" y1="405" x2="960" y2="405"/>
      <line x1="240" y1="0" x2="240" y2="540"/><line x1="480" y1="0" x2="480" y2="540"/><line x1="720" y1="0" x2="720" y2="540"/>
    </g>
    <rect x="90" y="96" width="230" height="310" rx="14" fill="#0f172a" stroke="${accent}" stroke-width="2.5"/>
    <rect x="365" y="96" width="230" height="310" rx="14" fill="#0f172a" stroke="${accent}" stroke-width="2.5"/>
    <rect x="640" y="96" width="230" height="310" rx="14" fill="#0f172a" stroke="#a855f7" stroke-width="2.5"/>
    <line x1="320" y1="250" x2="365" y2="250" stroke="${accent}" stroke-width="3"/>
    <line x1="595" y1="250" x2="640" y2="250" stroke="#a855f7" stroke-width="3"/>
    <text x="115" y="145" fill="${accent}" font-family="monospace" font-size="18" font-weight="bold">NODE_CLUSTER_A</text>
    <text x="390" y="145" fill="${accent}" font-family="monospace" font-size="18" font-weight="bold">KV_TENSOR_BUS</text>
    <text x="665" y="145" fill="#c084fc" font-family="monospace" font-size="18" font-weight="bold">NVLINK_FABRIC</text>
    <text x="480" y="472" text-anchor="middle" fill="#f8fafc" font-family="sans-serif" font-size="24" font-weight="bold">${safeTitle}</text>
    <text x="480" y="502" text-anchor="middle" fill="#94a3b8" font-family="monospace" font-size="14">${safeSub}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const STARTER_TECH_ASSETS: TechAsset[] = [
  {
    id: 'asset-gpu-rack-8xh100',
    name: '8x H100 Liquid-Cooled Server Rack',
    category: 'server-rack',
    sourceType: 'photos',
    mediaUrls: [
      makeBlueprintSvgDataUrl(
        '8x H100 NVLink Server Rack',
        '900 GB/s NVSwitch • InfiniBand 400G • Liquid Manifold',
        '#22d3ee'
      ),
    ],
    description:
      'High-density AI compute rack with dual redundant power shelves, NVSwitch interconnect fabric, and direct-to-chip cold plates.',
    technicalSpecs: '8x H100 SXM5 (640GB HBM3), 3.35 TB/s memory bandwidth, 400Gbps NDR InfiniBand',
    tags: ['gpu', 'server', 'rack', 'h100', 'nvlink', 'transformer', 'kv', 'llm', 'datacenter'],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'asset-kv-cache-arch',
    name: 'PagedAttention & KV-Cache Ring Architecture',
    category: 'architecture-diagram',
    sourceType: 'photos',
    mediaUrls: [
      makeBlueprintSvgDataUrl(
        'PagedAttention KV-Cache Block Table',
        'Zero-Copy Virtual Memory Blocks • Speculative Prefill',
        '#38bdf8'
      ),
    ],
    description:
      'Architecture blueprint illustrating how attention keys and values are partitioned into fixed-size virtual memory blocks to eliminate fragmentation.',
    technicalSpecs: '16-token KV pages, copy-on-write prefix sharing, sub-15ms TTFT scheduler',
    tags: ['attention', 'kv', 'cache', 'transformer', 'architecture', 'memory', 'latency', 'llm'],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

export function validateAssetUpload(
  files: UploadedMediaFile[],
  requestedSourceType?: 'photos' | 'video'
): { valid: true; sourceType: 'photos' | 'video' } | { valid: false; error: string } {
  if (!files || files.length === 0) {
    return { valid: false, error: 'Upload 1–5 reference photos or 1 video for this tech asset.' };
  }
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      return { valid: false, error: `File "${f.originalname}" exceeds the 25MB limit.` };
    }
  }
  const images = files.filter((f) => ALLOWED_IMAGE_MIME_TYPES.has(f.mimetype));
  const videos = files.filter((f) => ALLOWED_VIDEO_MIME_TYPES.has(f.mimetype));
  const invalid = files.filter(
    (f) => !ALLOWED_IMAGE_MIME_TYPES.has(f.mimetype) && !ALLOWED_VIDEO_MIME_TYPES.has(f.mimetype)
  );
  if (invalid.length > 0) {
    return {
      valid: false,
      error: `Unsupported asset file type "${invalid[0].mimetype}".`,
    };
  }
  if (images.length > 0 && videos.length > 0) {
    return { valid: false, error: 'Choose either 1–5 photos OR 1 video per asset, not mixed.' };
  }
  if (videos.length > 0) {
    if (requestedSourceType === 'photos') {
      return { valid: false, error: 'Photo mode selected, but a video file was uploaded.' };
    }
    if (videos.length > MAX_VIDEOS) {
      return { valid: false, error: 'Only 1 video file is allowed per asset.' };
    }
    return { valid: true, sourceType: 'video' };
  }
  if (requestedSourceType === 'video') {
    return { valid: false, error: 'Video mode selected, but photo files were uploaded.' };
  }
  if (images.length > MAX_PHOTOS) {
    return { valid: false, error: `Maximum of ${MAX_PHOTOS} photos allowed per asset.` };
  }
  return { valid: true, sourceType: 'photos' };
}

export class AssetLibrary {
  private readonly dataFile: string;
  private readonly assetsUploadDir: string;
  private initialized = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(baseDir: string = path.resolve(process.cwd(), 'data')) {
    this.dataFile = path.join(baseDir, 'assets.json');
    this.assetsUploadDir = path.join(baseDir, 'uploads', 'assets');
  }

  getAssetsUploadDir(): string {
    return this.assetsUploadDir;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
    await fs.mkdir(this.assetsUploadDir, { recursive: true });
    try {
      await fs.access(this.dataFile);
    } catch {
      await this.writeAtomically({
        assets: STARTER_TECH_ASSETS.map((a) => ({ ...a, mediaUrls: [...a.mediaUrls], tags: [...a.tags] })),
      });
    }
    this.initialized = true;
  }

  private async readData(): Promise<AssetLibraryFile> {
    await this.ensureInitialized();
    const raw = await fs.readFile(this.dataFile, 'utf-8');
    const parsed = JSON.parse(raw) as AssetLibraryFile;
    return { assets: Array.isArray(parsed?.assets) ? parsed.assets : [] };
  }

  private async writeAtomically(data: AssetLibraryFile): Promise<void> {
    const tmpFile = `${this.dataFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpFile, this.dataFile);
  }

  private enqueueWrite<T>(
    fn: (data: AssetLibraryFile) => Promise<{ data: AssetLibraryFile; result: T }> | { data: AssetLibraryFile; result: T }
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

  async listAssets(): Promise<TechAsset[]> {
    const data = await this.readData();
    return data.assets;
  }

  async getAsset(id: string): Promise<TechAsset | null> {
    const data = await this.readData();
    return data.assets.find((a) => a.id === id) || null;
  }

  async addAsset(params: {
    name: string;
    category: TechAssetCategory;
    sourceType: 'photos' | 'video';
    mediaUrls: string[];
    description: string;
    technicalSpecs: string;
    tags: string[];
  }): Promise<TechAsset> {
    const asset: TechAsset = {
      id: `asset-${crypto.randomUUID().slice(0, 8)}`,
      name: params.name.trim(),
      category: params.category,
      sourceType: params.sourceType,
      mediaUrls: params.mediaUrls,
      description: params.description.trim(),
      technicalSpecs: params.technicalSpecs.trim(),
      tags: params.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
      createdAt: new Date().toISOString(),
    };

    return this.enqueueWrite((data) => {
      data.assets.unshift(asset);
      return { data, result: asset };
    });
  }

  async deleteAsset(id: string): Promise<boolean> {
    return this.enqueueWrite((data) => {
      const before = data.assets.length;
      data.assets = data.assets.filter((a) => a.id !== id);
      return { data, result: data.assets.length < before };
    });
  }
}
