import crypto from 'node:crypto';
import type { CharacterProfile, CharacterSourceType, CharacterTraits } from '../../shared/types.js';

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export const ALLOWED_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

export const MAX_PHOTOS = 5;
export const MAX_VIDEOS = 1;
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file

export const CHARACTER_STYLE_PRESETS: Record<
  string,
  { traits: CharacterTraits; previewColor: string }
> = {
  'Tech Founder': {
    previewColor: '#6366f1',
    traits: {
      wardrobe: 'Charcoal mock-neck & structured blazer',
      lighting: 'Soft key light with cool rim',
      archetype: 'Visionary Builder',
      expression: 'Confident, articulate',
      accentColor: '#818cf8',
    },
  },
  'Cyberpunk Architect': {
    previewColor: '#06b6d4',
    traits: {
      wardrobe: 'Matte techwear jacket with subtle cyan piping',
      lighting: 'Dual neon cyan/magenta studio edge',
      archetype: 'Systems Futurist',
      expression: 'Focused, analytical',
      accentColor: '#22d3ee',
    },
  },
  'Studio Educator': {
    previewColor: '#f59e0b',
    traits: {
      wardrobe: 'Warm knit sweater & minimalist glasses',
      lighting: 'Warm tungsten 3-point studio wash',
      archetype: 'Master Explainer',
      expression: 'Approachable, curious',
      accentColor: '#fbbf24',
    },
  },
  'Quantum Minimalist': {
    previewColor: '#ec4899',
    traits: {
      wardrobe: 'Monochrome architectural turtleneck',
      lighting: 'High-contrast gallery spotlight',
      archetype: 'Research Lead',
      expression: 'Calm, authoritative',
      accentColor: '#f472b6',
    },
  },
};

export const PRESET_CHARACTERS: CharacterProfile[] = [
  {
    id: 'char-aria-lin',
    name: 'Dr. Aria Lin',
    role: 'Principal Systems Architect',
    sourceType: 'preset',
    mediaUrls: [],
    previewColor: '#06b6d4',
    stylePreset: 'Cyberpunk Architect',
    traits: { ...CHARACTER_STYLE_PRESETS['Cyberpunk Architect'].traits },
    voiceId: 'mock-rachel',
    isPreset: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'char-devon-vance',
    name: 'Devon Vance',
    role: 'Developer Advocate & Host',
    sourceType: 'preset',
    mediaUrls: [],
    previewColor: '#6366f1',
    stylePreset: 'Tech Founder',
    traits: { ...CHARACTER_STYLE_PRESETS['Tech Founder'].traits },
    voiceId: 'mock-adam',
    isPreset: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'char-kira-nova',
    name: 'Kira Nova',
    role: 'AI Visual Educator',
    sourceType: 'preset',
    mediaUrls: [],
    previewColor: '#f59e0b',
    stylePreset: 'Studio Educator',
    traits: { ...CHARACTER_STYLE_PRESETS['Studio Educator'].traits },
    voiceId: 'mock-bella',
    isPreset: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

export interface UploadedMediaFile {
  originalname: string;
  mimetype: string;
  size: number;
  url: string;
}

export function validateCharacterUpload(
  files: UploadedMediaFile[],
  requestedSourceType?: CharacterSourceType
): { valid: true; sourceType: 'photos' | 'video' } | { valid: false; error: string } {
  if (!files || files.length === 0) {
    return {
      valid: false,
      error: 'Upload between 1 and 5 photos, or 1 short reference video.',
    };
  }

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return {
        valid: false,
        error: `File "${file.originalname}" exceeds the 25MB size limit.`,
      };
    }
  }

  const imageFiles = files.filter((f) => ALLOWED_IMAGE_MIME_TYPES.has(f.mimetype));
  const videoFiles = files.filter((f) => ALLOWED_VIDEO_MIME_TYPES.has(f.mimetype));
  const unsupported = files.filter(
    (f) => !ALLOWED_IMAGE_MIME_TYPES.has(f.mimetype) && !ALLOWED_VIDEO_MIME_TYPES.has(f.mimetype)
  );

  if (unsupported.length > 0) {
    return {
      valid: false,
      error: `Unsupported file type "${unsupported[0].mimetype}". Allowed: PNG, JPG, WEBP photos or MP4, WEBM, MOV video.`,
    };
  }

  if (imageFiles.length > 0 && videoFiles.length > 0) {
    return {
      valid: false,
      error: 'Choose either up to 5 photos OR 1 short video per character clone, not both mixed.',
    };
  }

  if (videoFiles.length > 0) {
    if (requestedSourceType === 'photos') {
      return { valid: false, error: 'Photo mode selected, but video files were uploaded.' };
    }
    if (videoFiles.length > MAX_VIDEOS) {
      return { valid: false, error: 'Only 1 short reference video is allowed per character.' };
    }
    return { valid: true, sourceType: 'video' };
  }

  if (requestedSourceType === 'video') {
    return { valid: false, error: 'Video mode selected, but image files were uploaded.' };
  }

  if (imageFiles.length > MAX_PHOTOS) {
    return {
      valid: false,
      error: `Maximum of ${MAX_PHOTOS} reference photos allowed (received ${imageFiles.length}).`,
    };
  }

  return { valid: true, sourceType: 'photos' };
}

export function buildClonedCharacter(params: {
  name: string;
  role?: string;
  sourceType: CharacterSourceType;
  mediaUrls: string[];
  stylePreset?: string;
  voiceId?: string;
  traits?: Partial<CharacterTraits>;
}): CharacterProfile {
  const presetKey =
    params.stylePreset && CHARACTER_STYLE_PRESETS[params.stylePreset]
      ? params.stylePreset
      : 'Tech Founder';
  const preset = CHARACTER_STYLE_PRESETS[presetKey];

  return {
    id: `char-${crypto.randomUUID().slice(0, 8)}`,
    name: params.name.trim(),
    role: params.role?.trim() || 'Technical Narrator',
    sourceType: params.sourceType,
    mediaUrls: params.mediaUrls,
    previewColor: params.traits?.accentColor || preset.previewColor,
    stylePreset: presetKey,
    traits: {
      wardrobe: params.traits?.wardrobe || preset.traits.wardrobe,
      lighting: params.traits?.lighting || preset.traits.lighting,
      archetype: params.traits?.archetype || preset.traits.archetype,
      expression: params.traits?.expression || preset.traits.expression,
      accentColor: params.traits?.accentColor || preset.traits.accentColor,
    },
    voiceId: params.voiceId || 'mock-rachel',
    isPreset: params.sourceType === 'preset',
    createdAt: new Date().toISOString(),
  };
}
