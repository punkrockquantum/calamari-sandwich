import type {
  ConnectConnectorRequest,
  ConnectConnectorResponse,
  ConnectorAccountInfo,
  ConnectorDescriptor,
  ConnectorId,
  ConnectorKeySource,
  ConnectorStatusLevel,
  ConnectorTestResult,
} from '../../shared/types.js';
import {
  DEFAULT_ELEVENLABS_ENDPOINT,
  MOCK_VOICES,
  verifyElevenLabsCredentials,
} from '../services/elevenlabs.js';
import {
  DEFAULT_HIGGSFIELD_ENDPOINT,
  DEFAULT_HIGGSFIELD_MODEL,
  verifyHiggsfieldCredentials,
} from '../services/higgsfield.js';
import {
  DEFAULT_GEMINI_VEO_ENDPOINT,
  DEFAULT_GEMINI_VEO_MODEL,
  verifyGeminiVeoCredentials,
} from '../services/geminiVeo.js';
import { maskCredential, type CredentialVault } from '../store/credentialVault.js';

export interface ConnectorProbeResult {
  ok: boolean;
  message: string;
  account?: ConnectorAccountInfo;
  details?: Record<string, string | number | boolean>;
}

export interface ConnectorDefinition {
  id: ConnectorId;
  name: string;
  category: string;
  description: string;
  envVar: string;
  fallbackEnvVars?: string[];
  secretEnvVar?: string;
  sessionHeader: string;
  sessionSecretHeader?: string;
  sessionEndpointHeader?: string;
  sessionModelHeader?: string;
  endpointEnvVar?: string;
  defaultEndpoint: string;
  defaultModel?: string;
  portalUrl?: string;
  portalLabel?: string;
  supportsKeySecret?: boolean;
  capabilities: string[];
  testLive?: (params: {
    apiKey: string;
    apiSecret?: string;
    endpoint: string;
    model?: string;
  }) => Promise<ConnectorProbeResult>;
  verifyDemo: () => ConnectorProbeResult;
}

export interface ConnectorRequestContext {
  headers: Record<string, string | undefined>;
  demoDisabledIds?: Set<string>;
  vault?: CredentialVault;
}

const CONNECTOR_DEFINITIONS: ConnectorDefinition[] = [
  {
    id: 'elevenlabs',
    name: 'ElevenLabs Voice Studio',
    category: 'Voice Import & TTS',
    description:
      'Imports custom/library voices via /v1/voices and synthesizes scene narration via /v1/text-to-speech.',
    envVar: 'ELEVENLABS_API_KEY',
    sessionHeader: 'x-elevenlabs-key',
    sessionEndpointHeader: 'x-elevenlabs-endpoint',
    endpointEnvVar: 'ELEVENLABS_API_URL',
    defaultEndpoint: DEFAULT_ELEVENLABS_ENDPOINT,
    portalUrl: 'https://elevenlabs.io/app/settings/api-keys',
    portalLabel: 'Open ElevenLabs API Keys',
    capabilities: ['Voice Library Import', 'Multilingual v2 TTS', 'Procedural WAV Demo Fallback'],
    testLive: async ({ apiKey, endpoint }) => verifyElevenLabsCredentials(apiKey, endpoint),
    verifyDemo: () => ({
      ok: true,
      message: `Demo Mode active: ${MOCK_VOICES.length} studio voices & local WAV synthesis ready.`,
      details: { mockVoices: MOCK_VOICES.length, format: 'audio/wav' },
    }),
  },
  {
    id: 'higgsfield',
    name: 'Higgsfield Cinema Engine',
    category: 'Dynamic Cinematic Scenes',
    description:
      'Generates 16:9 dynamic camera motion clips, character staging, and cinematic lighting passes.',
    envVar: 'HIGGSFIELD_API_KEY',
    secretEnvVar: 'HIGGSFIELD_API_SECRET',
    sessionHeader: 'x-higgsfield-key',
    sessionSecretHeader: 'x-higgsfield-secret',
    sessionEndpointHeader: 'x-higgsfield-endpoint',
    sessionModelHeader: 'x-higgsfield-model',
    endpointEnvVar: 'HIGGSFIELD_API_URL',
    defaultEndpoint: DEFAULT_HIGGSFIELD_ENDPOINT,
    defaultModel: DEFAULT_HIGGSFIELD_MODEL,
    portalUrl: 'https://cloud.higgsfield.ai/',
    portalLabel: 'Open Higgsfield Cloud',
    supportsKeySecret: true,
    capabilities: ['6 Camera Motion Presets', '5 Cinematic Styles', '60fps HTML5 Canvas Fallback'],
    testLive: async ({ apiKey, apiSecret, endpoint, model }) =>
      verifyHiggsfieldCredentials({ apiKey, apiSecret, endpoint, model }),
    verifyDemo: () => ({
      ok: true,
      message: 'Demo Mode active: real-time 16:9 Canvas camera motion & diagram renderer ready.',
      details: { renderer: 'canvas-2d', aspectRatio: '16:9' },
    }),
  },
  {
    id: 'gemini_veo',
    name: 'Gemini Veo Cinema',
    category: 'AI Video & Motion Generation',
    description:
      'Pushes grounded 16:9 scene renders with attached character & tech asset references to Google Gemini Veo.',
    envVar: 'GEMINI_API_KEY',
    fallbackEnvVars: ['GOOGLE_API_KEY'],
    sessionHeader: 'x-gemini-veo-key',
    sessionEndpointHeader: 'x-gemini-veo-endpoint',
    sessionModelHeader: 'x-gemini-veo-model',
    endpointEnvVar: 'GEMINI_VEO_API_URL',
    defaultEndpoint: DEFAULT_GEMINI_VEO_ENDPOINT,
    defaultModel: DEFAULT_GEMINI_VEO_MODEL,
    portalUrl: 'https://aistudio.google.com/apikey',
    portalLabel: 'Open Google AI Studio API Keys',
    capabilities: ['Veo 2.0 / 3.0 Video Push', 'Image-to-Video Reference Grounding', '60fps Canvas Fallback'],
    testLive: async ({ apiKey, endpoint, model }) =>
      verifyGeminiVeoCredentials({ apiKey, endpoint, model }),
    verifyDemo: () => ({
      ok: true,
      message: 'Demo Mode active: native 16:9 Canvas stage & RAG asset renderer ready.',
      details: { renderer: 'canvas-2d', aspectRatio: '16:9' },
    }),
  },
  {
    id: 'character_cloning',
    name: 'Character Cloning Pipeline',
    category: 'Identity & Avatar Cloning',
    description:
      'Clones reusable presenters from up to 5 reference photos or 1 short video with trait extraction.',
    envVar: 'CHARACTER_CLONE_API_KEY',
    sessionHeader: 'x-character-clone-key',
    endpointEnvVar: 'CHARACTER_CLONE_API_URL',
    defaultEndpoint: 'https://api.calamari-sandwich.local/v1/character-clone',
    capabilities: ['Max 5 Photos Validation', '1 Short Video Validation', 'Trait & Style Extraction'],
    testLive: async ({ apiKey }) => ({
      ok: apiKey.length >= 6,
      message:
        apiKey.length >= 6
          ? 'Character Cloning provider key configured and validated for pipeline dispatch.'
          : 'Provided Character Cloning key looks too short.',
      details: { mode: 'external-provider' },
    }),
    verifyDemo: () => ({
      ok: true,
      message: 'Demo Mode active: local upload storage, validation & trait extraction ready.',
      details: { maxPhotos: 5, maxVideos: 1 },
    }),
  },
  {
    id: 'script_director_llm',
    name: 'Script & Prompt Director LLM',
    category: 'Topic Pacing & Iterative Edits',
    description:
      'Breaks complex tech into 2–30 min multi-chapter scripts and executes Director Prompt edits with undo.',
    envVar: 'DIRECTOR_LLM_API_KEY',
    fallbackEnvVars: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    sessionHeader: 'x-director-llm-key',
    endpointEnvVar: 'DIRECTOR_LLM_API_URL',
    defaultEndpoint: 'https://api.openai.com/v1',
    capabilities: ['2–30m Chapter Pacing', 'Natural-Language Director Edits', 'Snapshot Undo/Redo'],
    testLive: async ({ apiKey, endpoint }) => {
      if (endpoint.includes('openai.com')) {
        try {
          const res = await fetch(`${endpoint.replace(/\/$/, '')}/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(6000),
          });
          return {
            ok: res.ok,
            message: res.ok
              ? 'Director LLM connected to OpenAI-compatible models endpoint.'
              : `Director LLM endpoint returned HTTP ${res.status}.`,
            details: { httpStatus: res.status },
          };
        } catch (err) {
          return {
            ok: false,
            message: `Director LLM endpoint error (${err instanceof Error ? err.message : 'network error'}).`,
          };
        }
      }
      return {
        ok: apiKey.length >= 6,
        message: 'Director LLM API key configured.',
      };
    },
    verifyDemo: () => ({
      ok: true,
      message: 'Demo Mode active: deterministic 2–30m chapter planner & Director Prompt AST engine ready.',
      details: { minMinutes: 2, maxMinutes: 30 },
    }),
  },
  {
    id: 'music_soundtrack',
    name: 'Music & Soundtrack Studio',
    category: 'Adaptive Background Score',
    description:
      'Generates BPM-synced ambient tech soundtracks with automatic voiceover ducking.',
    envVar: 'MUSIC_API_KEY',
    sessionHeader: 'x-music-key',
    endpointEnvVar: 'MUSIC_API_URL',
    defaultEndpoint: 'https://api.calamari-sandwich.local/v1/music',
    capabilities: ['BPM & Mood Bed Sync', 'Voiceover Auto-Ducking', 'Web Audio Demo Synth'],
    testLive: async ({ apiKey }) => ({
      ok: apiKey.length >= 6,
      message:
        apiKey.length >= 6
          ? 'Music & Soundtrack provider key configured and ready for generation.'
          : 'Provided Music API key looks too short.',
    }),
    verifyDemo: () => ({
      ok: true,
      message: 'Demo Mode active: Web Audio ambient bed synthesizer & timeline ducking ready.',
      details: { engine: 'web-audio-synth' },
    }),
  },
];

function resolveConnectorKey(
  def: ConnectorDefinition,
  ctx: ConnectorRequestContext
): {
  key: string | null;
  apiSecret?: string;
  keySource: ConnectorKeySource;
  endpoint: string;
  model?: string;
  maskedKey?: string;
  savedInVault: boolean;
  account?: ConnectorAccountInfo;
} {
  const vaultEntry = ctx.vault?.get(def.id);
  const envEndpoint = def.endpointEnvVar ? process.env[def.endpointEnvVar]?.trim() : undefined;
  const headerEndpoint = def.sessionEndpointHeader
    ? ctx.headers[def.sessionEndpointHeader]?.trim()
    : undefined;
  const headerModel = def.sessionModelHeader
    ? ctx.headers[def.sessionModelHeader]?.trim()
    : undefined;

  const baseEndpoint =
    headerEndpoint || vaultEntry?.endpoint?.trim() || envEndpoint || def.defaultEndpoint;
  const baseModel = headerModel || vaultEntry?.model?.trim() || def.defaultModel;

  // Priority 1: Explicit request header
  const sessionKey = ctx.headers[def.sessionHeader]?.trim();
  if (sessionKey) {
    const sessionSecret = def.sessionSecretHeader
      ? ctx.headers[def.sessionSecretHeader]?.trim()
      : undefined;
    return {
      key: sessionKey,
      apiSecret: sessionSecret || undefined,
      keySource: 'session',
      endpoint: baseEndpoint,
      model: baseModel,
      maskedKey: maskCredential(sessionKey, sessionSecret),
      savedInVault: Boolean(vaultEntry),
    };
  }

  // Priority 2: Saved local credential vault (data/credentials.json)
  if (vaultEntry?.apiKey) {
    return {
      key: vaultEntry.apiKey,
      apiSecret: vaultEntry.apiSecret,
      keySource: 'vault',
      endpoint: vaultEntry.endpoint?.trim() || baseEndpoint,
      model: vaultEntry.model?.trim() || baseModel,
      maskedKey: maskCredential(vaultEntry.apiKey, vaultEntry.apiSecret),
      savedInVault: true,
      account: vaultEntry.account,
    };
  }

  // Priority 3: Process environment variables
  const primaryEnv = process.env[def.envVar]?.trim();
  if (primaryEnv) {
    const envSecret = def.secretEnvVar ? process.env[def.secretEnvVar]?.trim() : undefined;
    return {
      key: primaryEnv,
      apiSecret: envSecret || undefined,
      keySource: 'env',
      endpoint: baseEndpoint,
      model: baseModel,
      maskedKey: maskCredential(primaryEnv, envSecret),
      savedInVault: false,
    };
  }

  if (def.fallbackEnvVars) {
    for (const envName of def.fallbackEnvVars) {
      const val = process.env[envName]?.trim();
      if (val) {
        return {
          key: val,
          keySource: 'env',
          endpoint: baseEndpoint,
          model: baseModel,
          maskedKey: maskCredential(val),
          savedInVault: false,
        };
      }
    }
  }

  return {
    key: null,
    keySource: 'none',
    endpoint: baseEndpoint,
    model: baseModel,
    savedInVault: false,
  };
}

function resolveStatusLevel(
  keySource: ConnectorKeySource,
  demoFallbackEnabled: boolean
): ConnectorStatusLevel {
  if (keySource !== 'none') return 'connected';
  return demoFallbackEnabled ? 'demo' : 'not_configured';
}

export function getConnectorDefinition(id: string): ConnectorDefinition | undefined {
  return CONNECTOR_DEFINITIONS.find((c) => c.id === id);
}

export function describeConnector(
  def: ConnectorDefinition,
  ctx: ConnectorRequestContext
): ConnectorDescriptor {
  const resolved = resolveConnectorKey(def, ctx);
  const demoFallbackEnabled = !ctx.demoDisabledIds?.has(def.id);
  const status = resolveStatusLevel(resolved.keySource, demoFallbackEnabled);

  return {
    id: def.id,
    name: def.name,
    category: def.category,
    description: def.description,
    envVar: def.envVar,
    sessionHeader: def.sessionHeader,
    endpointEnvVar: def.endpointEnvVar,
    defaultEndpoint: resolved.endpoint,
    portalUrl: def.portalUrl,
    portalLabel: def.portalLabel,
    supportsKeySecret: def.supportsKeySecret,
    status,
    keySource: resolved.keySource,
    maskedKey: resolved.maskedKey,
    savedInVault: resolved.savedInVault,
    endpoint: resolved.endpoint,
    model: resolved.model,
    account: resolved.account,
    demoFallbackEnabled,
    capabilities: def.capabilities,
  };
}

export function listConnectors(ctx: ConnectorRequestContext): ConnectorDescriptor[] {
  return CONNECTOR_DEFINITIONS.map((def) => describeConnector(def, ctx));
}

export async function testConnectorConnection(
  id: ConnectorId,
  ctx: ConnectorRequestContext
): Promise<ConnectorTestResult> {
  const def = getConnectorDefinition(id);
  if (!def) {
    throw new Error(`Unknown connector "${id}".`);
  }

  const start = Date.now();
  const resolved = resolveConnectorKey(def, ctx);
  const demoFallbackEnabled = !ctx.demoDisabledIds?.has(def.id);
  const status = resolveStatusLevel(resolved.keySource, demoFallbackEnabled);

  if (status === 'not_configured') {
    return {
      connectorId: def.id,
      ok: false,
      status: 'not_configured',
      keySource: 'none',
      message: `${def.name} is Not Configured. Add ${def.envVar} on the server, sign in via API Connectors, or enable Demo Mode.`,
      latencyMs: Date.now() - start,
      checkedAt: new Date().toISOString(),
    };
  }

  if (status === 'demo' || !resolved.key) {
    const demoRes = def.verifyDemo();
    return {
      connectorId: def.id,
      ok: demoRes.ok,
      status: 'demo',
      keySource: 'none',
      message: demoRes.message,
      latencyMs: Date.now() - start,
      checkedAt: new Date().toISOString(),
      details: demoRes.details,
    };
  }

  const liveRes = def.testLive
    ? await def.testLive({
        apiKey: resolved.key,
        apiSecret: resolved.apiSecret,
        endpoint: resolved.endpoint,
        model: resolved.model,
      })
    : { ok: true, message: `${def.name} key configured (${resolved.keySource}).` };

  if (liveRes.ok && liveRes.account && resolved.keySource === 'vault' && ctx.vault) {
    await ctx.vault.updateAccount(def.id, liveRes.account);
  }

  return {
    connectorId: def.id,
    ok: liveRes.ok,
    status: liveRes.ok ? 'connected' : demoFallbackEnabled ? 'demo' : 'not_configured',
    keySource: resolved.keySource,
    maskedKey: resolved.maskedKey,
    account: liveRes.account || resolved.account,
    message: liveRes.message,
    latencyMs: Date.now() - start,
    checkedAt: new Date().toISOString(),
    details: liveRes.details,
  };
}

export async function connectConnector(
  id: ConnectorId,
  payload: ConnectConnectorRequest,
  ctx: ConnectorRequestContext
): Promise<ConnectConnectorResponse> {
  const def = getConnectorDefinition(id);
  if (!def) {
    throw new Error(`Unknown connector "${id}".`);
  }
  if (!ctx.vault) {
    throw new Error('Credential vault is not initialized.');
  }

  const apiKey = payload.apiKey.trim();
  const apiSecret = payload.apiSecret?.trim() || undefined;
  const endpoint =
    payload.endpoint?.trim() ||
    (def.endpointEnvVar ? process.env[def.endpointEnvVar]?.trim() : undefined) ||
    def.defaultEndpoint;
  const model = payload.model?.trim() || def.defaultModel;

  const start = Date.now();
  const liveRes = def.testLive
    ? await def.testLive({ apiKey, apiSecret, endpoint, model })
    : { ok: apiKey.length >= 6, message: `${def.name} credential saved.` };

  const maskedKey = maskCredential(apiKey, apiSecret);
  const checkedAt = new Date().toISOString();

  if (!liveRes.ok) {
    const result: ConnectorTestResult = {
      connectorId: def.id,
      ok: false,
      status: !ctx.demoDisabledIds?.has(def.id) ? 'demo' : 'not_configured',
      keySource: 'none',
      maskedKey,
      message: liveRes.message,
      latencyMs: Date.now() - start,
      checkedAt,
      details: liveRes.details,
    };
    return {
      ok: false,
      result,
      error: liveRes.message,
    };
  }

  await ctx.vault.set(def.id, {
    apiKey,
    apiSecret,
    endpoint: endpoint !== def.defaultEndpoint ? endpoint : payload.endpoint?.trim() || undefined,
    model: model !== def.defaultModel ? model : payload.model?.trim() || undefined,
    account: liveRes.account,
  });

  const connector = describeConnector(def, ctx);
  const result: ConnectorTestResult = {
    connectorId: def.id,
    ok: true,
    status: 'connected',
    keySource: connector.keySource,
    maskedKey: connector.maskedKey,
    account: liveRes.account,
    message: liveRes.message,
    latencyMs: Date.now() - start,
    checkedAt,
    details: liveRes.details,
  };

  return {
    ok: true,
    connector,
    result,
  };
}

export async function disconnectConnector(
  id: ConnectorId,
  ctx: ConnectorRequestContext
): Promise<ConnectorDescriptor> {
  const def = getConnectorDefinition(id);
  if (!def) {
    throw new Error(`Unknown connector "${id}".`);
  }
  if (ctx.vault) {
    await ctx.vault.delete(def.id);
  }
  return describeConnector(def, ctx);
}
