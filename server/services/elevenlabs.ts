import type { ConnectorAccountInfo, VoiceProfile } from '../../shared/types.js';
import { maskCredential, type CredentialVault } from '../store/credentialVault.js';

export const DEFAULT_ELEVENLABS_ENDPOINT = 'https://api.elevenlabs.io/v1';

export const MOCK_VOICES: VoiceProfile[] = [
  {
    voice_id: 'mock-rachel',
    name: 'Rachel — Studio Narrator',
    category: 'premade',
    source: 'mock',
    labels: { accent: 'American', age: 'young', gender: 'female', use_case: 'tech explainer' },
    description: 'Crisp, warm, articulate cadence ideal for complex technical walkthroughs.',
  },
  {
    voice_id: 'mock-adam',
    name: 'Adam — Systems Deep Dive',
    category: 'premade',
    source: 'mock',
    labels: { accent: 'American', age: 'middle_aged', gender: 'male', use_case: 'documentary' },
    description: 'Deep, grounded documentary tone built for architecture breakdowns.',
  },
  {
    voice_id: 'mock-bella',
    name: 'Bella — Product Educator',
    category: 'premade',
    source: 'mock',
    labels: { accent: 'British', age: 'young', gender: 'female', use_case: 'tutorial' },
    description: 'Energetic, approachable studio voice for engaging developer demos.',
  },
  {
    voice_id: 'mock-antoni',
    name: 'Antoni — Executive Brief',
    category: 'premade',
    source: 'mock',
    labels: { accent: 'American', age: 'young', gender: 'male', use_case: 'narration' },
    description: 'Balanced, clear, modern voice tailored for fast-paced explainers.',
  },
  {
    voice_id: 'mock-matilda',
    name: 'Matilda — Research Lead',
    category: 'premade',
    source: 'mock',
    labels: { accent: 'American', age: 'middle_aged', gender: 'female', use_case: 'science' },
    description: 'Thoughtful, precise tone suited for AI/ML and cryptography topics.',
  },
];

export function resolveElevenLabsEndpoint(
  vault?: CredentialVault,
  explicitEndpoint?: string
): string {
  return (
    explicitEndpoint?.trim() ||
    vault?.get('elevenlabs')?.endpoint?.trim() ||
    process.env.ELEVENLABS_API_URL?.trim() ||
    DEFAULT_ELEVENLABS_ENDPOINT
  ).replace(/\/$/, '');
}

export function resolveElevenLabsKey(
  sessionHeaderKey?: string,
  vault?: CredentialVault
): {
  key: string | null;
  source: 'env' | 'vault' | 'session' | 'mock';
  endpoint: string;
  maskedKey?: string;
  account?: ConnectorAccountInfo;
} {
  const endpoint = resolveElevenLabsEndpoint(vault);
  const trimmedHeader = sessionHeaderKey?.trim();
  if (trimmedHeader) {
    return {
      key: trimmedHeader,
      source: 'session',
      endpoint,
      maskedKey: maskCredential(trimmedHeader),
    };
  }

  const vaultEntry = vault?.get('elevenlabs');
  if (vaultEntry?.apiKey) {
    return {
      key: vaultEntry.apiKey,
      source: 'vault',
      endpoint: vaultEntry.endpoint?.trim()?.replace(/\/$/, '') || endpoint,
      maskedKey: maskCredential(vaultEntry.apiKey),
      account: vaultEntry.account,
    };
  }

  const envKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (envKey) {
    return {
      key: envKey,
      source: 'env',
      endpoint,
      maskedKey: maskCredential(envKey),
    };
  }

  return { key: null, source: 'mock', endpoint };
}

export async function verifyElevenLabsCredentials(
  apiKey: string,
  endpoint?: string
): Promise<{
  ok: boolean;
  message: string;
  account?: ConnectorAccountInfo;
  details?: Record<string, string | number | boolean>;
}> {
  const baseUrl = (
    endpoint?.trim() ||
    process.env.ELEVENLABS_API_URL?.trim() ||
    DEFAULT_ELEVENLABS_ENDPOINT
  ).replace(/\/$/, '');

  try {
    const [voicesRes, userRes, subRes] = await Promise.all([
      fetch(`${baseUrl}/voices`, {
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      }),
      fetch(`${baseUrl}/user`, {
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null),
      fetch(`${baseUrl}/user/subscription`, {
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null),
    ]);

    if (!voicesRes.ok && (!userRes || !userRes.ok)) {
      return {
        ok: false,
        message: `ElevenLabs responded with HTTP ${voicesRes.status}. Verify your xi-api-key and permissions.`,
        details: { httpStatus: voicesRes.status },
      };
    }

    let voiceCount = 0;
    if (voicesRes.ok) {
      const voicesData = (await voicesRes.json()) as { voices?: unknown[] };
      voiceCount = voicesData.voices?.length ?? 0;
    }

    let userName: string | undefined;
    let userEmail: string | undefined;
    if (userRes && userRes.ok) {
      const userData = (await userRes.json()) as {
        first_name?: string;
        email?: string;
        subscription?: {
          tier?: string;
          character_count?: number;
          character_limit?: number;
        };
      };
      userName = userData.first_name?.trim() || undefined;
      userEmail = userData.email?.trim() || undefined;
    }

    let tier: string | undefined;
    let characterCount: number | undefined;
    let characterLimit: number | undefined;
    let remainingCharacters: number | undefined;

    if (subRes && subRes.ok) {
      const subData = (await subRes.json()) as {
        tier?: string;
        character_count?: number;
        character_limit?: number;
      };
      tier = subData.tier;
      characterCount = subData.character_count;
      characterLimit = subData.character_limit;
      if (typeof characterLimit === 'number' && typeof characterCount === 'number') {
        remainingCharacters = Math.max(0, characterLimit - characterCount);
      }
    }

    const account: ConnectorAccountInfo = {
      provider: 'elevenlabs',
      label: userName || userEmail || (tier ? `ElevenLabs ${tier}` : 'ElevenLabs Account'),
      tier,
      characterCount,
      characterLimit,
      remainingCharacters,
      voiceCount,
      endpoint: baseUrl,
      verifiedAt: new Date().toISOString(),
    };

    const quotaPart =
      typeof remainingCharacters === 'number' && typeof characterLimit === 'number'
        ? ` • ${remainingCharacters.toLocaleString()} / ${characterLimit.toLocaleString()} chars left`
        : '';
    const tierPart = tier ? ` (${tier})` : '';

    return {
      ok: true,
      message: `Connected to ElevenLabs${tierPart}: ${voiceCount} voices accessible${quotaPart}.`,
      account,
      details: {
        voicesCount: voiceCount,
        ...(tier ? { tier } : {}),
        ...(typeof remainingCharacters === 'number' ? { remainingCharacters } : {}),
      },
    };
  } catch (err) {
    return {
      ok: false,
      message: `ElevenLabs verification failed (${err instanceof Error ? err.message : 'network error'}).`,
    };
  }
}

export async function listElevenLabsVoices(
  sessionHeaderKey?: string,
  vault?: CredentialVault
): Promise<{
  voices: VoiceProfile[];
  source: 'env' | 'vault' | 'session' | 'mock';
  fallbackReason?: string;
}> {
  const { key, source, endpoint } = resolveElevenLabsKey(sessionHeaderKey, vault);

  if (!key) {
    return { voices: MOCK_VOICES, source: 'mock' };
  }

  try {
    const res = await fetch(`${endpoint}/voices`, {
      headers: {
        'xi-api-key': key,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return {
        voices: MOCK_VOICES,
        source: 'mock',
        fallbackReason: `ElevenLabs /v1/voices returned HTTP ${res.status}; using studio mock voices.`,
      };
    }

    const payload = (await res.json()) as {
      voices?: Array<{
        voice_id: string;
        name: string;
        category?: string;
        labels?: Record<string, string>;
        preview_url?: string;
        description?: string;
      }>;
    };

    const voices: VoiceProfile[] = (payload.voices || []).map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category || 'cloned',
      source: 'elevenlabs',
      labels: v.labels || {},
      preview_url: v.preview_url,
      description: v.description,
    }));

    return {
      voices: voices.length > 0 ? voices : MOCK_VOICES,
      source: voices.length > 0 ? source : 'mock',
    };
  } catch (err) {
    return {
      voices: MOCK_VOICES,
      source: 'mock',
      fallbackReason: `ElevenLabs API unreachable (${err instanceof Error ? err.message : 'network error'}); using studio mock voices.`,
    };
  }
}

/**
 * Generates a valid PCM 16-bit mono WAV buffer with subtle syllable-like
 * vocal formant modulation so fallback audio playback works natively in HTMLAudioElement.
 */
export function generateProceduralVoiceWav(text: string, voiceId: string): Buffer {
  const sampleRate = 16000;
  const wordCount = Math.max(2, text.trim().split(/\s+/).length);
  const durationSec = Math.min(4.5, Math.max(1.2, wordCount * 0.18));
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const hash = voiceId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const basePitch = 135 + (hash % 95); // 135Hz - 230Hz fundamental

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const syllableRate = 4.2 + (hash % 3) * 0.4;
    const envelope =
      Math.max(0, Math.sin(Math.PI * syllableRate * t)) *
      Math.min(1, t * 12) *
      Math.min(1, (durationSec - t) * 12);
    const pitchGlide = basePitch * (1 + 0.06 * Math.sin(2 * Math.PI * 1.4 * t));
    const fundamental = Math.sin(2 * Math.PI * pitchGlide * t);
    const formant1 = 0.45 * Math.sin(2 * Math.PI * (pitchGlide * 2.5) * t);
    const formant2 = 0.2 * Math.sin(2 * Math.PI * (pitchGlide * 4.1) * t);
    const sample = Math.max(-1, Math.min(1, (fundamental + formant1 + formant2) * envelope * 0.22));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }

  return buffer;
}

export async function synthesizeElevenLabsSpeech(params: {
  voiceId: string;
  text: string;
  sessionHeaderKey?: string;
  vault?: CredentialVault;
}): Promise<{
  audioBuffer: Buffer;
  contentType: string;
  source: 'elevenlabs' | 'mock';
  fallbackReason?: string;
}> {
  const { key, endpoint } = resolveElevenLabsKey(params.sessionHeaderKey, params.vault);
  const isMockVoice = params.voiceId.startsWith('mock-');

  if (!key || isMockVoice) {
    return {
      audioBuffer: generateProceduralVoiceWav(params.text, params.voiceId),
      contentType: 'audio/wav',
      source: 'mock',
      fallbackReason: !key
        ? 'No ELEVENLABS_API_KEY configured; synthesized local studio preview audio.'
        : 'Using built-in studio demo voice synthesis.',
    };
  }

  try {
    const res = await fetch(
      `${endpoint}/text-to-speech/${encodeURIComponent(params.voiceId)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': key,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: params.text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.52,
            similarity_boost: 0.78,
          },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) {
      return {
        audioBuffer: generateProceduralVoiceWav(params.text, params.voiceId),
        contentType: 'audio/wav',
        source: 'mock',
        fallbackReason: `ElevenLabs TTS returned HTTP ${res.status}; fell back to studio audio preview.`,
      };
    }

    const arrayBuffer = await res.arrayBuffer();
    return {
      audioBuffer: Buffer.from(arrayBuffer),
      contentType: res.headers.get('content-type') || 'audio/mpeg',
      source: 'elevenlabs',
    };
  } catch (err) {
    return {
      audioBuffer: generateProceduralVoiceWav(params.text, params.voiceId),
      contentType: 'audio/wav',
      source: 'mock',
      fallbackReason: `ElevenLabs TTS request failed (${err instanceof Error ? err.message : 'network error'}); fell back to studio audio preview.`,
    };
  }
}
