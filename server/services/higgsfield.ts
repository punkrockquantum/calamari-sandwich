import crypto from 'node:crypto';
import type {
  CameraMotionPreset,
  CharacterProfile,
  ConnectorAccountInfo,
  HiggsfieldJobState,
  SceneItem,
} from '../../shared/types.js';
import {
  formatHiggsfieldAuth,
  maskCredential,
  type CredentialVault,
} from '../store/credentialVault.js';

export const DEFAULT_HIGGSFIELD_ENDPOINT = 'https://platform.higgsfield.ai/v1/motions/generate';
export const DEFAULT_HIGGSFIELD_MODEL = 'higgsfield-dop-turbo';

const CAMERA_PRESET_MAP: Record<CameraMotionPreset, string> = {
  'Slow Dolly In': 'dolly_in_slow',
  'Orbital Pan': 'orbit_360_smooth',
  'Crane Pullback': 'crane_up_reveal',
  'Handheld Micro': 'handheld_doc_subtle',
  'Rack Focus': 'rack_focus_depth',
  'Static Tripod': 'static_locked',
};

export function resolveHiggsfieldKey(
  sessionHeaderKey?: string,
  vault?: CredentialVault,
  options?: {
    sessionSecret?: string;
    sessionEndpoint?: string;
    sessionModel?: string;
  }
): {
  key: string | null;
  apiSecret?: string;
  source: 'env' | 'vault' | 'session' | 'fallback';
  endpoint: string;
  model: string;
  maskedKey?: string;
  account?: ConnectorAccountInfo;
} {
  const vaultEntry = vault?.get('higgsfield');
  const defaultEndpoint =
    options?.sessionEndpoint?.trim() ||
    vaultEntry?.endpoint?.trim() ||
    process.env.HIGGSFIELD_API_URL?.trim() ||
    DEFAULT_HIGGSFIELD_ENDPOINT;
  const defaultModel =
    options?.sessionModel?.trim() ||
    vaultEntry?.model?.trim() ||
    process.env.HIGGSFIELD_MODEL?.trim() ||
    DEFAULT_HIGGSFIELD_MODEL;

  const trimmedHeader = sessionHeaderKey?.trim();
  if (trimmedHeader) {
    const secret = options?.sessionSecret?.trim();
    return {
      key: trimmedHeader,
      apiSecret: secret || undefined,
      source: 'session',
      endpoint: defaultEndpoint,
      model: defaultModel,
      maskedKey: maskCredential(trimmedHeader, secret),
    };
  }

  if (vaultEntry?.apiKey) {
    return {
      key: vaultEntry.apiKey,
      apiSecret: vaultEntry.apiSecret,
      source: 'vault',
      endpoint: vaultEntry.endpoint?.trim() || defaultEndpoint,
      model: vaultEntry.model?.trim() || defaultModel,
      maskedKey: maskCredential(vaultEntry.apiKey, vaultEntry.apiSecret),
      account: vaultEntry.account,
    };
  }

  const envKey = process.env.HIGGSFIELD_API_KEY?.trim();
  const envSecret = process.env.HIGGSFIELD_API_SECRET?.trim();
  if (envKey) {
    return {
      key: envKey,
      apiSecret: envSecret || undefined,
      source: 'env',
      endpoint: defaultEndpoint,
      model: defaultModel,
      maskedKey: maskCredential(envKey, envSecret),
    };
  }

  return {
    key: null,
    source: 'fallback',
    endpoint: defaultEndpoint,
    model: defaultModel,
  };
}

function buildHiggsfieldHeaders(apiKey: string, apiSecret?: string): Record<string, string> {
  const auth = formatHiggsfieldAuth(apiKey, apiSecret);
  const headers: Record<string, string> = {
    Authorization: auth.authHeader,
    'hf-api-key': auth.keyId,
    Accept: 'application/json',
  };
  if (auth.keySecret) {
    headers['hf-secret'] = auth.keySecret;
  }
  return headers;
}

export async function verifyHiggsfieldCredentials(params: {
  apiKey: string;
  apiSecret?: string;
  endpoint?: string;
  model?: string;
}): Promise<{
  ok: boolean;
  message: string;
  account?: ConnectorAccountInfo;
  details?: Record<string, string | number | boolean>;
}> {
  const endpoint = (
    params.endpoint?.trim() ||
    process.env.HIGGSFIELD_API_URL?.trim() ||
    DEFAULT_HIGGSFIELD_ENDPOINT
  ).trim();
  const model = (
    params.model?.trim() ||
    process.env.HIGGSFIELD_MODEL?.trim() ||
    DEFAULT_HIGGSFIELD_MODEL
  ).trim();

  const auth = formatHiggsfieldAuth(params.apiKey, params.apiSecret);
  if (auth.keyId.length < 4) {
    return {
      ok: false,
      message: 'Higgsfield credential is too short. Paste your API Key or Key ID + Secret.',
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'HEAD',
      headers: buildHiggsfieldHeaders(params.apiKey, params.apiSecret),
      signal: AbortSignal.timeout(7000),
    });

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        message: `Higgsfield rejected credentials (HTTP ${res.status}). Check your Key ID & Secret or API Key.`,
        details: { httpStatus: res.status },
      };
    }

    if (res.status >= 500) {
      return {
        ok: false,
        message: `Higgsfield endpoint returned HTTP ${res.status}.`,
        details: { httpStatus: res.status },
      };
    }

    const account: ConnectorAccountInfo = {
      provider: 'higgsfield',
      label: auth.scheme === 'Key' ? 'Higgsfield Key Pair' : 'Higgsfield API Token',
      endpoint,
      model,
      verifiedAt: new Date().toISOString(),
    };

    return {
      ok: true,
      message: `Higgsfield verified (${auth.scheme} auth • ${model}, HTTP ${res.status}).`,
      account,
      details: {
        httpStatus: res.status,
        authScheme: auth.scheme,
        model,
      },
    };
  } catch (err) {
    return {
      ok: false,
      message: `Higgsfield endpoint unreachable (${err instanceof Error ? err.message : 'network error'}); canvas fallback stays ready.`,
    };
  }
}

function mapUpstreamStatus(rawStatus?: string, hasVideoUrl?: boolean): HiggsfieldJobState['status'] {
  if (hasVideoUrl) return 'ready';
  const s = (rawStatus || '').toLowerCase();
  if (s === 'completed' || s === 'succeeded' || s === 'ready' || s === 'done') return 'ready';
  if (s === 'failed' || s === 'error' || s === 'canceled' || s === 'cancelled') return 'failed';
  if (s === 'in_progress' || s === 'processing' || s === 'generating' || s === 'rendering' || s === 'running') {
    return 'generating';
  }
  return 'queued';
}

interface HiggsfieldUpstreamPayload {
  id?: string;
  job_id?: string;
  request_id?: string;
  status?: string;
  status_url?: string;
  urls?: { status?: string; get?: string };
  video_url?: string;
  output_url?: string;
  video?: { url?: string };
  outputs?: Array<{ url?: string; video_url?: string }>;
  error?: string | { message?: string };
  detail?: string;
}

function extractVideoUrl(data: HiggsfieldUpstreamPayload): string | undefined {
  return (
    data.video_url ||
    data.output_url ||
    data.video?.url ||
    data.outputs?.[0]?.url ||
    data.outputs?.[0]?.video_url
  );
}

function extractErrorMessage(data: HiggsfieldUpstreamPayload): string | undefined {
  if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
  if (data.error && typeof data.error === 'object' && data.error.message) {
    return data.error.message;
  }
  if (typeof data.detail === 'string' && data.detail.trim()) return data.detail.trim();
  return undefined;
}

function buildDefaultStatusUrl(endpoint: string, jobId: string): string {
  const cleaned = endpoint
    .replace(/\/$/, '')
    .replace(/\/(motions\/generate|image2video\/dop|generate)$/i, '');
  return `${cleaned}/jobs/${encodeURIComponent(jobId)}`;
}

export async function generateHiggsfieldScene(params: {
  scene: SceneItem;
  character?: CharacterProfile;
  sessionHeaderKey?: string;
  sessionSecret?: string;
  sessionEndpoint?: string;
  sessionModel?: string;
  vault?: CredentialVault;
}): Promise<HiggsfieldJobState> {
  const resolved = resolveHiggsfieldKey(params.sessionHeaderKey, params.vault, {
    sessionSecret: params.sessionSecret,
    sessionEndpoint: params.sessionEndpoint,
    sessionModel: params.sessionModel,
  });
  const now = new Date().toISOString();

  if (!resolved.key) {
    return {
      status: 'fallback',
      provider: 'canvas-fallback',
      jobId: `hf-sim-${crypto.randomUUID().slice(0, 8)}`,
      renderNote: `Canvas Stage Fallback (${params.scene.cameraMotion} • ${params.scene.cinematicStyle}). Connect Higgsfield for cloud video generation.`,
      updatedAt: now,
    };
  }

  const requestPayload = {
    model: resolved.model,
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

  try {
    const res = await fetch(resolved.endpoint, {
      method: 'POST',
      headers: {
        ...buildHiggsfieldHeaders(resolved.key, resolved.apiSecret),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as HiggsfieldUpstreamPayload;
      const upstreamMsg = extractErrorMessage(errBody);
      const errMessage = upstreamMsg
        ? `Higgsfield API HTTP ${res.status}: ${upstreamMsg}`
        : `Higgsfield API returned HTTP ${res.status}.`;
      return {
        status: 'failed',
        provider: 'higgsfield',
        jobId: `hf-err-${crypto.randomUUID().slice(0, 6)}`,
        endpoint: resolved.endpoint,
        model: resolved.model,
        errorMessage: errMessage,
        renderNote: `${errMessage} PreviewPlayer falls back to 60fps Canvas stage.`,
        updatedAt: now,
      };
    }

    const data = (await res.json()) as HiggsfieldUpstreamPayload;
    const jobId = data.job_id || data.request_id || data.id || `hf-${crypto.randomUUID().slice(0, 8)}`;
    const videoUrl = extractVideoUrl(data);
    const status = mapUpstreamStatus(data.status, Boolean(videoUrl));
    const statusUrl =
      data.status_url ||
      data.urls?.status ||
      data.urls?.get ||
      buildDefaultStatusUrl(resolved.endpoint, jobId);

    if (status === 'failed') {
      const errMessage = extractErrorMessage(data) || 'Higgsfield generation failed.';
      return {
        status: 'failed',
        provider: 'higgsfield',
        jobId,
        statusUrl,
        endpoint: resolved.endpoint,
        model: resolved.model,
        errorMessage: errMessage,
        renderNote: `${errMessage} PreviewPlayer falls back to 60fps Canvas stage.`,
        updatedAt: now,
      };
    }

    return {
      status,
      provider: 'higgsfield',
      jobId,
      statusUrl,
      videoUrl,
      endpoint: resolved.endpoint,
      model: resolved.model,
      renderNote:
        status === 'ready'
          ? `Higgsfield video ready (${resolved.model}).`
          : `Higgsfield job ${status} (${jobId}) — polling for video output.`,
      updatedAt: now,
    };
  } catch (err) {
    const errMessage = `Higgsfield request error: ${err instanceof Error ? err.message : 'network error'}`;
    return {
      status: 'failed',
      provider: 'higgsfield',
      jobId: `hf-err-${crypto.randomUUID().slice(0, 6)}`,
      endpoint: resolved.endpoint,
      model: resolved.model,
      errorMessage: errMessage,
      renderNote: `${errMessage}. PreviewPlayer falls back to 60fps Canvas stage.`,
      updatedAt: now,
    };
  }
}

export async function pollHiggsfieldJobStatus(params: {
  scene: SceneItem;
  sessionHeaderKey?: string;
  sessionSecret?: string;
  sessionEndpoint?: string;
  sessionModel?: string;
  vault?: CredentialVault;
}): Promise<HiggsfieldJobState> {
  const current = params.scene.higgsfield;
  const resolved = resolveHiggsfieldKey(params.sessionHeaderKey, params.vault, {
    sessionSecret: params.sessionSecret,
    sessionEndpoint: params.sessionEndpoint || current.endpoint,
    sessionModel: params.sessionModel || current.model,
  });

  if (!resolved.key || !current.jobId) {
    return current;
  }

  if (current.status === 'ready' || current.status === 'failed' || current.status === 'fallback') {
    return current;
  }

  const statusUrl =
    current.statusUrl || buildDefaultStatusUrl(current.endpoint || resolved.endpoint, current.jobId);
  const now = new Date().toISOString();

  try {
    const res = await fetch(statusUrl, {
      method: 'GET',
      headers: buildHiggsfieldHeaders(resolved.key, resolved.apiSecret),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as HiggsfieldUpstreamPayload;
      const errMessage = extractErrorMessage(errBody) || `Status check returned HTTP ${res.status}.`;
      return {
        ...current,
        status: 'failed',
        errorMessage: errMessage,
        renderNote: `${errMessage} PreviewPlayer falls back to 60fps Canvas stage.`,
        updatedAt: now,
      };
    }

    const data = (await res.json()) as HiggsfieldUpstreamPayload;
    const videoUrl = extractVideoUrl(data);
    const nextStatus = mapUpstreamStatus(data.status, Boolean(videoUrl));

    if (nextStatus === 'failed') {
      const errMessage = extractErrorMessage(data) || 'Higgsfield job failed.';
      return {
        ...current,
        status: 'failed',
        errorMessage: errMessage,
        renderNote: `${errMessage} PreviewPlayer falls back to 60fps Canvas stage.`,
        updatedAt: now,
      };
    }

    return {
      ...current,
      status: nextStatus,
      videoUrl: videoUrl || current.videoUrl,
      renderNote:
        nextStatus === 'ready'
          ? `Higgsfield video ready (${current.model || resolved.model}).`
          : `Higgsfield job ${nextStatus} (${current.jobId})...`,
      updatedAt: now,
    };
  } catch (err) {
    return {
      ...current,
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : 'Status poll failed',
      renderNote: `Higgsfield status poll failed (${err instanceof Error ? err.message : 'network error'}).`,
      updatedAt: now,
    };
  }
}
