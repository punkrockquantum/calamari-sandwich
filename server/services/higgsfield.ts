import crypto from 'node:crypto';
import type {
  CameraMotionPreset,
  CharacterProfile,
  HiggsfieldJobState,
  SceneItem,
} from '../../shared/types.js';

const CAMERA_PRESET_MAP: Record<CameraMotionPreset, string> = {
  'Slow Dolly In': 'dolly_in_slow',
  'Orbital Pan': 'orbit_360_smooth',
  'Crane Pullback': 'crane_up_reveal',
  'Handheld Micro': 'handheld_doc_subtle',
  'Rack Focus': 'rack_focus_depth',
  'Static Tripod': 'static_locked',
};

export function resolveHiggsfieldKey(sessionHeaderKey?: string): {
  key: string | null;
  source: 'env' | 'session' | 'fallback';
} {
  const trimmedHeader = sessionHeaderKey?.trim();
  if (trimmedHeader) {
    return { key: trimmedHeader, source: 'session' };
  }
  const envKey = process.env.HIGGSFIELD_API_KEY?.trim();
  if (envKey) {
    return { key: envKey, source: 'env' };
  }
  return { key: null, source: 'fallback' };
}

export async function generateHiggsfieldScene(params: {
  scene: SceneItem;
  character?: CharacterProfile;
  sessionHeaderKey?: string;
}): Promise<HiggsfieldJobState> {
  const { key } = resolveHiggsfieldKey(params.sessionHeaderKey);
  const now = new Date().toISOString();

  const requestPayload = {
    model: 'higgsfield-dop-turbo',
    prompt: params.scene.visualPrompt,
    camera_motion: CAMERA_PRESET_MAP[params.scene.cameraMotion] || 'dolly_in_slow',
    style: params.scene.cinematicStyle,
    duration_sec: Math.min(10, Math.max(3, params.scene.durationSec)),
    aspect_ratio: '16:9',
    character_reference: params.character
      ? {
          id: params.character.id,
          name: params.character.name,
          placement: params.scene.characterPlacement,
          traits: params.character.traits,
        }
      : undefined,
  };

  if (!key) {
    return {
      status: 'fallback',
      provider: 'canvas-fallback',
      jobId: `hf-sim-${crypto.randomUUID().slice(0, 8)}`,
      renderNote: `Canvas Stage Fallback (${params.scene.cameraMotion} • ${params.scene.cinematicStyle}). Add HIGGSFIELD_API_KEY in Settings or .env for cloud render.`,
      updatedAt: now,
    };
  }

  try {
    const endpoint =
      process.env.HIGGSFIELD_API_URL?.trim() ||
      'https://platform.higgsfield.ai/v1/motions/generate';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'hf-api-key': key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return {
        status: 'fallback',
        provider: 'canvas-fallback',
        jobId: `hf-fallback-${crypto.randomUUID().slice(0, 6)}`,
        renderNote: `Higgsfield API returned HTTP ${res.status}; rendering with interactive 16:9 canvas engine.`,
        updatedAt: now,
      };
    }

    const data = (await res.json()) as {
      id?: string;
      job_id?: string;
      status?: string;
      video_url?: string;
      output_url?: string;
    };

    const videoUrl = data.video_url || data.output_url;
    return {
      status: videoUrl ? 'ready' : 'queued',
      provider: 'higgsfield',
      jobId: data.job_id || data.id || `hf-${crypto.randomUUID().slice(0, 8)}`,
      videoUrl,
      renderNote: videoUrl
        ? 'Higgsfield cinematic render ready.'
        : 'Higgsfield render job queued; previewing live canvas stage while rendering.',
      updatedAt: now,
    };
  } catch (err) {
    return {
      status: 'fallback',
      provider: 'canvas-fallback',
      jobId: `hf-fallback-${crypto.randomUUID().slice(0, 6)}`,
      renderNote: `Higgsfield endpoint unavailable (${err instanceof Error ? err.message : 'network error'}); using interactive canvas fallback.`,
      updatedAt: now,
    };
  }
}
