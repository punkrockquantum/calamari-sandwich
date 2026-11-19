import crypto from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';
import type {
  CharacterProfile,
  ConnectorAccountInfo,
  HiggsfieldJobState,
  SceneItem,
  TechAsset,
} from '../../shared/types.js';
import { maskCredential, type CredentialVault } from '../store/credentialVault.js';

export const DEFAULT_GEMINI_VEO_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_GEMINI_VEO_MODEL = 'veo-2.0-generate-001';

export function resolveGeminiVeoKey(
  sessionHeaderKey?: string,
  vault?: CredentialVault,
  options?: {
    sessionEndpoint?: string;
    sessionModel?: string;
  }
): {
  key: string | null;
  source: 'env' | 'vault' | 'session' | 'fallback';
  endpoint: string;
  model: string;
  maskedKey?: string;
  account?: ConnectorAccountInfo;
} {
  const vaultEntry = vault?.get('gemini_veo');
  const defaultEndpoint = (
    options?.sessionEndpoint?.trim() ||
    vaultEntry?.endpoint?.trim() ||
    process.env.GEMINI_VEO_API_URL?.trim() ||
    DEFAULT_GEMINI_VEO_ENDPOINT
  ).replace(/\/$/, '');
  const defaultModel =
    options?.sessionModel?.trim() ||
    vaultEntry?.model?.trim() ||
    process.env.GEMINI_VEO_MODEL?.trim() ||
    DEFAULT_GEMINI_VEO_MODEL;

  const trimmedHeader = sessionHeaderKey?.trim();
  if (trimmedHeader) {
    return {
      key: trimmedHeader,
      source: 'session',
      endpoint: defaultEndpoint,
      model: defaultModel,
      maskedKey: maskCredential(trimmedHeader),
    };
  }

  if (vaultEntry?.apiKey) {
    return {
      key: vaultEntry.apiKey,
      source: 'vault',
      endpoint: vaultEntry.endpoint?.trim()?.replace(/\/$/, '') || defaultEndpoint,
      model: vaultEntry.model?.trim() || defaultModel,
      maskedKey: maskCredential(vaultEntry.apiKey),
      account: vaultEntry.account,
    };
  }

  const envKey =
    process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (envKey) {
    return {
      key: envKey,
      source: 'env',
      endpoint: defaultEndpoint,
      model: defaultModel,
      maskedKey: maskCredential(envKey),
    };
  }

  return {
    key: null,
    source: 'fallback',
    endpoint: defaultEndpoint,
    model: defaultModel,
  };
}

export async function verifyGeminiVeoCredentials(params: {
  apiKey: string;
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
    process.env.GEMINI_VEO_API_URL?.trim() ||
    DEFAULT_GEMINI_VEO_ENDPOINT
  ).replace(/\/$/, '');
  const model = (
    params.model?.trim() ||
    process.env.GEMINI_VEO_MODEL?.trim() ||
    DEFAULT_GEMINI_VEO_MODEL
  ).trim();

  if (params.apiKey.trim().length < 6) {
    return {
      ok: false,
      message: 'Gemini API key looks too short. Copy a valid key from Google AI Studio.',
    };
  }

  try {
    const res = await fetch(`${endpoint}/models`, {
      method: 'GET',
      headers: {
        'x-goog-api-key': params.apiKey.trim(),
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return {
        ok: false,
        message: `Google AI Studio rejected the Gemini API key (HTTP ${res.status}).`,
        details: { httpStatus: res.status },
      };
    }

    if (res.status >= 500) {
      return {
        ok: false,
        message: `Gemini API endpoint returned HTTP ${res.status}.`,
        details: { httpStatus: res.status },
      };
    }

    let modelCount = 0;
    if (res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { models?: unknown[] };
      modelCount = Array.isArray(payload.models) ? payload.models.length : 0;
    }

    const account: ConnectorAccountInfo = {
      provider: 'gemini_veo',
      label: 'Google AI Studio (Gemini Veo)',
      endpoint,
      model,
      verifiedAt: new Date().toISOString(),
    };

    return {
      ok: true,
      message: `Connected to Gemini Veo (${model}${modelCount > 0 ? ` • ${modelCount} models visible` : ''}).`,
      account,
      details: { httpStatus: res.status, model, modelCount },
    };
  } catch (err) {
    return {
      ok: false,
      message: `Gemini Veo endpoint unreachable (${err instanceof Error ? err.message : 'network error'}).`,
    };
  }
}

function tryReadUploadAsInlineData(
  mediaUrl: string,
  uploadsRootDir?: string
): { mimeType: string; data: string } | null {
  if (!uploadsRootDir || !mediaUrl.startsWith('/uploads/')) return null;
  const rel = mediaUrl.replace(/^\/uploads\//, '');
  const fullPath = path.resolve(uploadsRootDir, rel);
  if (!fullPath.startsWith(path.resolve(uploadsRootDir))) return null;
  try {
    const buf = fsSync.readFileSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.mp4'
              ? 'video/mp4'
              : ext === '.webm'
                ? 'video/webm'
                : 'application/octet-stream';
    if (!mimeType.startsWith('image/')) return null;
    return { mimeType, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

interface GeminiOperationPayload {
  name?: string;
  done?: boolean;
  error?: { message?: string; code?: number };
  video_url?: string;
  output_url?: string;
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>;
    };
    generatedVideos?: Array<{ video?: { uri?: string } }>;
  };
}

function extractGeminiVideoUrl(data: GeminiOperationPayload): string | undefined {
  return (
    data.video_url ||
    data.output_url ||
    data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
    data.response?.generatedVideos?.[0]?.video?.uri
  );
}

export async function generateGeminiVeoScene(params: {
  scene: SceneItem;
  character?: CharacterProfile;
  assets?: TechAsset[];
  uploadsRootDir?: string;
  sessionHeaderKey?: string;
  sessionEndpoint?: string;
  sessionModel?: string;
  vault?: CredentialVault;
}): Promise<HiggsfieldJobState> {
  const resolved = resolveGeminiVeoKey(params.sessionHeaderKey, params.vault, {
    sessionEndpoint: params.sessionEndpoint,
    sessionModel: params.sessionModel,
  });
  const now = new Date().toISOString();

  const attachedMediaUrls = Array.from(
    new Set([
      ...(params.character?.mediaUrls || []),
      ...(params.assets || []).flatMap((a) => a.mediaUrls),
      ...(params.scene.ragContext || [])
        .map((r) => r.mediaUrl)
        .filter((u): u is string => Boolean(u)),
    ])
  );

  if (!resolved.key) {
    return {
      status: 'fallback',
      provider: 'canvas-fallback',
      jobId: `veo-sim-${crypto.randomUUID().slice(0, 8)}`,
      attachedMediaUrls,
      renderNote: `Native Canvas Stage active (${params.scene.cameraMotion} • ${params.scene.cinematicStyle}). Connect Gemini Veo to push cloud renders.`,
      updatedAt: now,
    };
  }

  const inlineRef = attachedMediaUrls
    .map((u) => tryReadUploadAsInlineData(u, params.uploadsRootDir))
    .find((x): x is { mimeType: string; data: string } => Boolean(x));

  const assetContextSummary = (params.assets || [])
    .map((a) => `${a.name}: ${a.technicalSpecs || a.description}`)
    .join(' | ');

  const promptText = [
    params.scene.visualPrompt,
    `Camera: ${params.scene.cameraMotion}, Style: ${params.scene.cinematicStyle}.`,
    params.character
      ? `Presenter: ${params.character.name} (${params.character.role}, ${params.character.traits.wardrobe}).`
      : '',
    assetContextSummary ? `Technical reference assets: ${assetContextSummary}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const instance: Record<string, unknown> = { prompt: promptText };
  if (inlineRef) {
    instance.image = {
      bytesBase64Encoded: inlineRef.data,
      mimeType: inlineRef.mimeType,
    };
  }

  const requestBody = {
    instances: [instance],
    parameters: {
      aspectRatio: '16:9',
      durationSeconds: Math.min(8, Math.max(5, Math.round(params.scene.durationSec))),
      personGeneration: 'allow_adult',
    },
  };

  try {
    const generateUrl = `${resolved.endpoint}/models/${encodeURIComponent(resolved.model)}:predictLongRunning`;
    const res = await fetch(generateUrl, {
      method: 'POST',
      headers: {
        'x-goog-api-key': resolved.key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      const errMsg =
        errBody.error?.message || `Gemini Veo API returned HTTP ${res.status}.`;
      return {
        status: 'failed',
        provider: 'gemini_veo',
        jobId: `veo-err-${crypto.randomUUID().slice(0, 6)}`,
        endpoint: resolved.endpoint,
        model: resolved.model,
        attachedMediaUrls,
        errorMessage: errMsg,
        renderNote: `${errMsg} PreviewPlayer keeps native 60fps Canvas fallback active.`,
        updatedAt: now,
      };
    }

    const data = (await res.json()) as GeminiOperationPayload;
    const opName = data.name || `operations/veo-${crypto.randomUUID().slice(0, 8)}`;
    const videoUrl = extractGeminiVideoUrl(data);
    const statusUrl = opName.startsWith('http')
      ? opName
      : `${resolved.endpoint}/${opName.replace(/^\//, '')}`;

    if (data.error?.message) {
      return {
        status: 'failed',
        provider: 'gemini_veo',
        jobId: opName,
        statusUrl,
        endpoint: resolved.endpoint,
        model: resolved.model,
        attachedMediaUrls,
        errorMessage: data.error.message,
        renderNote: data.error.message,
        updatedAt: now,
      };
    }

    const status: HiggsfieldJobState['status'] = videoUrl
      ? 'ready'
      : data.done
        ? 'ready'
        : 'queued';

    return {
      status,
      provider: 'gemini_veo',
      jobId: opName,
      statusUrl,
      videoUrl,
      endpoint: resolved.endpoint,
      model: resolved.model,
      attachedMediaUrls,
      renderNote:
        status === 'ready'
          ? `Gemini Veo render ready (${resolved.model}).`
          : `Pushed to Gemini Veo (${opName}) with ${attachedMediaUrls.length} reference file(s) — polling status.`,
      updatedAt: now,
    };
  } catch (err) {
    const errMsg = `Gemini Veo request failed: ${err instanceof Error ? err.message : 'network error'}`;
    return {
      status: 'failed',
      provider: 'gemini_veo',
      jobId: `veo-err-${crypto.randomUUID().slice(0, 6)}`,
      endpoint: resolved.endpoint,
      model: resolved.model,
      attachedMediaUrls,
      errorMessage: errMsg,
      renderNote: `${errMsg}. PreviewPlayer continues using native Canvas stage.`,
      updatedAt: now,
    };
  }
}

export async function pollGeminiVeoJobStatus(params: {
  job: HiggsfieldJobState;
  sessionHeaderKey?: string;
  sessionEndpoint?: string;
  sessionModel?: string;
  vault?: CredentialVault;
}): Promise<HiggsfieldJobState> {
  const current = params.job;
  const resolved = resolveGeminiVeoKey(params.sessionHeaderKey, params.vault, {
    sessionEndpoint: params.sessionEndpoint || current.endpoint,
    sessionModel: params.sessionModel || current.model,
  });

  if (!resolved.key || !current.jobId) return current;
  if (current.status === 'ready' || current.status === 'failed' || current.status === 'fallback') {
    return current;
  }

  const statusUrl =
    current.statusUrl ||
    `${current.endpoint || resolved.endpoint}/${current.jobId.replace(/^\//, '')}`;
  const now = new Date().toISOString();

  try {
    const res = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        'x-goog-api-key': resolved.key,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      const errMsg = errBody.error?.message || `Gemini Veo poll returned HTTP ${res.status}.`;
      return {
        ...current,
        status: 'failed',
        errorMessage: errMsg,
        renderNote: errMsg,
        updatedAt: now,
      };
    }

    const data = (await res.json()) as GeminiOperationPayload;
    if (data.error?.message) {
      return {
        ...current,
        status: 'failed',
        errorMessage: data.error.message,
        renderNote: data.error.message,
        updatedAt: now,
      };
    }

    const videoUrl = extractGeminiVideoUrl(data);
    if (videoUrl || data.done) {
      return {
        ...current,
        status: 'ready',
        videoUrl: videoUrl || current.videoUrl,
        renderNote: `Gemini Veo video ready (${current.model || resolved.model}).`,
        updatedAt: now,
      };
    }

    return {
      ...current,
      status: 'generating',
      renderNote: `Gemini Veo generating (${current.jobId})...`,
      updatedAt: now,
    };
  } catch (err) {
    return {
      ...current,
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : 'Status poll failed',
      renderNote: `Gemini Veo poll failed (${err instanceof Error ? err.message : 'network error'}).`,
      updatedAt: now,
    };
  }
}
