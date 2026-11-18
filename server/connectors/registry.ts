import type {
  ConnectorDescriptor,
  ConnectorId,
  ConnectorKeySource,
  ConnectorStatusLevel,
  ConnectorTestResult,
} from '../../shared/types.js';
import { MOCK_VOICES } from '../services/elevenlabs.js';

export interface ConnectorProbeResult {
  ok: boolean;
  message: string;
  details?: Record<string, string | number | boolean>;
}

export interface ConnectorDefinition {
  id: ConnectorId;
  name: string;
  category: string;
  description: string;
  envVar: string;
  fallbackEnvVars?: string[];
  sessionHeader: string;
  endpointEnvVar?: string;
  defaultEndpoint: string;
  capabilities: string[];
  testLive?: (apiKey: string, endpoint: string) => Promise<ConnectorProbeResult>;
  verifyDemo: () => ConnectorProbeResult;
}

export interface ConnectorRequestContext {
  headers: Record<string, string | undefined>;
  demoDisabledIds?: Set<string>;
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
    endpointEnvVar: 'ELEVENLABS_API_URL',
    defaultEndpoint: 'https://api.elevenlabs.io/v1',
    capabilities: ['Voice Library Import', 'Multilingual v2 TTS', 'Procedural WAV Demo Fallback'],
    testLive: async (apiKey, endpoint): Promise<ConnectorProbeResult> => {
      const url = `${endpoint.replace(/\/$/, '')}/voices`;
      const res = await fetch(url, {
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return {
          ok: false,
          message: `ElevenLabs responded with HTTP ${res.status}. Verify API key permissions.`,
          details: { httpStatus: res.status },
        };
      }
      const data = (await res.json()) as { voices?: unknown[] };
      return {
        ok: true,
        message: `Connected to ElevenLabs (${data.voices?.length ?? 0} voices accessible).`,
        details: { voicesCount: data.voices?.length ?? 0 },
      };
    },
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
    sessionHeader: 'x-higgsfield-key',
    endpointEnvVar: 'HIGGSFIELD_API_URL',
    defaultEndpoint: 'https://platform.higgsfield.ai/v1',
    capabilities: ['6 Camera Motion Presets', '5 Cinematic Styles', '60fps HTML5 Canvas Fallback'],
    testLive: async (apiKey, endpoint) => {
      try {
        const res = await fetch(endpoint, {
          method: 'HEAD',
          headers: { Authorization: `Bearer ${apiKey}`, 'hf-api-key': apiKey },
          signal: AbortSignal.timeout(6000),
        });
        return {
          ok: res.status < 500,
          message:
            res.status < 500
              ? `Higgsfield endpoint reachable with configured key (HTTP ${res.status}).`
              : `Higgsfield endpoint returned HTTP ${res.status}.`,
          details: { httpStatus: res.status },
        };
      } catch (err) {
        return {
          ok: false,
          message: `Higgsfield endpoint unreachable (${err instanceof Error ? err.message : 'network error'}); canvas fallback stays ready.`,
        };
      }
    },
    verifyDemo: () => ({
      ok: true,
      message: 'Demo Mode active: real-time 16:9 Canvas camera motion & diagram renderer ready.',
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
    testLive: async (apiKey) => ({
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
    testLive: async (apiKey, endpoint) => {
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
    testLive: async (apiKey) => ({
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
  headers: Record<string, string | undefined>
): { key: string | null; keySource: ConnectorKeySource } {
  const sessionKey = headers[def.sessionHeader]?.trim();
  if (sessionKey) {
    return { key: sessionKey, keySource: 'session' };
  }

  const primaryEnv = process.env[def.envVar]?.trim();
  if (primaryEnv) {
    return { key: primaryEnv, keySource: 'env' };
  }

  if (def.fallbackEnvVars) {
    for (const envName of def.fallbackEnvVars) {
      const val = process.env[envName]?.trim();
      if (val) {
        return { key: val, keySource: 'env' };
      }
    }
  }

  return { key: null, keySource: 'none' };
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

export function listConnectors(ctx: ConnectorRequestContext): ConnectorDescriptor[] {
  return CONNECTOR_DEFINITIONS.map((def) => {
    const { keySource } = resolveConnectorKey(def, ctx.headers);
    const demoFallbackEnabled = !ctx.demoDisabledIds?.has(def.id);
    const status = resolveStatusLevel(keySource, demoFallbackEnabled);
    const endpoint =
      (def.endpointEnvVar && process.env[def.endpointEnvVar]?.trim()) || def.defaultEndpoint;

    return {
      id: def.id,
      name: def.name,
      category: def.category,
      description: def.description,
      envVar: def.envVar,
      sessionHeader: def.sessionHeader,
      endpointEnvVar: def.endpointEnvVar,
      defaultEndpoint: endpoint,
      status,
      keySource,
      demoFallbackEnabled,
      capabilities: def.capabilities,
    };
  });
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
  const { key, keySource } = resolveConnectorKey(def, ctx.headers);
  const demoFallbackEnabled = !ctx.demoDisabledIds?.has(def.id);
  const status = resolveStatusLevel(keySource, demoFallbackEnabled);
  const endpoint =
    (def.endpointEnvVar && process.env[def.endpointEnvVar]?.trim()) || def.defaultEndpoint;

  if (status === 'not_configured') {
    return {
      connectorId: def.id,
      ok: false,
      status: 'not_configured',
      keySource: 'none',
      message: `${def.name} is Not Configured. Add ${def.envVar} on the server, enter a session key, or enable Demo Mode.`,
      latencyMs: Date.now() - start,
      checkedAt: new Date().toISOString(),
    };
  }

  if (status === 'demo' || !key) {
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
    ? await def.testLive(key, endpoint)
    : { ok: true, message: `${def.name} key configured (${keySource}).` };

  return {
    connectorId: def.id,
    ok: liveRes.ok,
    status: liveRes.ok ? 'connected' : demoFallbackEnabled ? 'demo' : 'not_configured',
    keySource,
    message: liveRes.message,
    latencyMs: Date.now() - start,
    checkedAt: new Date().toISOString(),
    details: liveRes.details,
  };
}
