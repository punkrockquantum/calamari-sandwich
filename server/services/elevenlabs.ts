import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  ConnectorAccountInfo,
  PushVoiceElevenLabsResult,
  TtsBrowserFallback,
  TtsSpeechConfig,
  VoicePlaybackMode,
  VoiceProfile,
} from '../../shared/types.js';
import { maskCredential, type CredentialVault } from '../store/credentialVault.js';
import type { VoiceStore } from '../store/voiceStore.js';

const execFileAsync = promisify(execFile);

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options?: { timeout?: number }
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

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
  vault?: CredentialVault,
  voiceStore?: VoiceStore
): Promise<{
  voices: VoiceProfile[];
  source: 'env' | 'vault' | 'session' | 'mock';
  fallbackReason?: string;
}> {
  const nativeVoices = voiceStore ? await voiceStore.listVoices() : [];
  const { key, source, endpoint } = resolveElevenLabsKey(sessionHeaderKey, vault);

  if (!key) {
    return { voices: [...nativeVoices, ...MOCK_VOICES], source: 'mock' };
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
        voices: [...nativeVoices, ...MOCK_VOICES],
        source: 'mock',
        fallbackReason: `ElevenLabs /v1/voices returned HTTP ${res.status}; using studio voices.`,
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

    const elVoices: VoiceProfile[] = (payload.voices || []).map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category || 'cloned',
      source: 'elevenlabs',
      labels: v.labels || {},
      preview_url: v.preview_url,
      description: v.description,
    }));

    return {
      voices: elVoices.length > 0 ? [...nativeVoices, ...elVoices] : [...nativeVoices, ...MOCK_VOICES],
      source: elVoices.length > 0 ? source : 'mock',
    };
  } catch (err) {
    return {
      voices: [...nativeVoices, ...MOCK_VOICES],
      source: 'mock',
      fallbackReason: `ElevenLabs API unreachable (${err instanceof Error ? err.message : 'network error'}); using studio voices.`,
    };
  }
}

export function sanitizeSpeechText(text: string): string {
  const cleaned = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
  if (!cleaned) return 'Narration ready.';
  // Guard against leading '-' being parsed as a CLI option flag by BSD say/espeak
  return cleaned.startsWith('-') ? ` ${cleaned}` : cleaned;
}

export interface SpeechProfileMapping {
  voiceName: string;
  macOsVoice: 'Samantha' | 'Daniel' | 'Karen' | 'Rishi' | 'Ava' | 'Alex';
  wpm: number;
  espeakVoice: string;
  espeakPitch: number;
  browserSpeechConfig: TtsSpeechConfig;
}

export function resolveSpeechProfile(
  voiceId: string,
  nativeVoice?: VoiceProfile | null
): SpeechProfileMapping {
  const mockVoice = MOCK_VOICES.find((v) => v.voice_id === voiceId);
  const traits = nativeVoice?.traits;
  const labels = nativeVoice?.labels || mockVoice?.labels || {};
  const toneLower = (traits?.tone || '').toLowerCase();
  const pitchTrait = traits?.pitch || 'medium';
  const cadence = traits?.cadence || 'conversational';
  const warmth = traits?.warmth ?? 68;

  let macOsVoice: SpeechProfileMapping['macOsVoice'] = 'Samantha';
  let gender: 'female' | 'male' | 'neutral' = 'female';
  let lang = 'en-US';
  let espeakVoice = 'en-us+f3';

  if (voiceId === 'mock-adam') {
    macOsVoice = 'Daniel';
    gender = 'male';
    lang = 'en-GB';
    espeakVoice = 'en-gb+m2';
  } else if (voiceId === 'mock-bella') {
    macOsVoice = 'Karen';
    gender = 'female';
    lang = 'en-AU';
    espeakVoice = 'en-us+f4';
  } else if (voiceId === 'mock-antoni') {
    macOsVoice = 'Alex';
    gender = 'male';
    lang = 'en-US';
    espeakVoice = 'en-us+m3';
  } else if (voiceId === 'mock-matilda') {
    macOsVoice = 'Ava';
    gender = 'female';
    lang = 'en-US';
    espeakVoice = 'en-us+f2';
  } else if (nativeVoice) {
    const labelGender = (labels.gender || '').toLowerCase();
    if (
      labelGender === 'male' ||
      pitchTrait === 'low' ||
      toneLower.includes('deep') ||
      toneLower.includes('documentary')
    ) {
      gender = 'male';
      macOsVoice = toneLower.includes('analyst') ? 'Rishi' : pitchTrait === 'low' ? 'Daniel' : 'Alex';
      espeakVoice = pitchTrait === 'low' ? 'en-us+m2' : 'en-us+m3';
    } else if (pitchTrait === 'high' || toneLower.includes('energetic')) {
      gender = 'female';
      macOsVoice = toneLower.includes('energetic') ? 'Karen' : 'Ava';
      espeakVoice = 'en-us+f4';
    } else if (toneLower.includes('crisp') || toneLower.includes('analyst')) {
      gender = 'female';
      macOsVoice = 'Ava';
      espeakVoice = 'en-us+f2';
    } else {
      gender = 'female';
      macOsVoice = 'Samantha';
      espeakVoice = 'en-us+f3';
    }
  }

  const wpm = cadence === 'brisk' ? 204 : cadence === 'measured' ? 152 : 176;
  const espeakPitch = pitchTrait === 'low' ? 36 : pitchTrait === 'high' ? 66 : 50;
  const rate = cadence === 'brisk' ? 1.16 : cadence === 'measured' ? 0.88 : 1.02;
  const warmthPitchOffset = ((warmth - 65) / 100) * -0.05;
  const pitch = Number(
    Math.max(
      0.7,
      Math.min(1.4, (pitchTrait === 'low' ? 0.86 : pitchTrait === 'high' ? 1.16 : 1.0) + warmthPitchOffset)
    ).toFixed(2)
  );

  const preferredVoices =
    gender === 'male'
      ? [macOsVoice, 'Daniel', 'Alex', 'Rishi', 'Google UK English Male', 'Google US English']
      : [macOsVoice, 'Samantha', 'Ava', 'Karen', 'Google US English', 'Google UK English Female'];

  return {
    voiceName: nativeVoice?.name || mockVoice?.name || 'Studio Narrator',
    macOsVoice,
    wpm,
    espeakVoice,
    espeakPitch,
    browserSpeechConfig: {
      rate,
      pitch,
      lang,
      gender,
      preferredVoices: Array.from(new Set(preferredVoices)),
      tone: traits?.tone,
      warmth,
      cadence,
    },
  };
}

export function buildMacOsSayArgs(params: {
  voice: string;
  wpm: number;
  outputPath: string;
  text: string;
  fileFormat?: 'WAVE' | 'AIFF';
}): string[] {
  const args = [
    '-v',
    params.voice,
    '-r',
    String(Math.max(90, Math.min(320, Math.round(params.wpm)))),
    '-o',
    params.outputPath,
  ];
  if (params.fileFormat === 'WAVE') {
    args.push('--file-format=WAVE');
  }
  args.push('--data-format=LEI16@22050', sanitizeSpeechText(params.text));
  return args;
}

export function buildEspeakArgs(params: {
  voice: string;
  wpm: number;
  pitch: number;
  outputPath: string;
  text: string;
}): string[] {
  return [
    '-v',
    params.voice,
    '-s',
    String(Math.max(80, Math.min(320, Math.round(params.wpm)))),
    '-p',
    String(Math.max(0, Math.min(99, Math.round(params.pitch)))),
    '-w',
    params.outputPath,
    '--',
    sanitizeSpeechText(params.text),
  ];
}

export function createPcmWavHeader(
  dataSize: number,
  sampleRate = 22050,
  channels = 1,
  bitsPerSample = 16
): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
}

function decodeIeeeExtended80(buf: Buffer, offset: number): number {
  const exponent = ((buf[offset] & 0x7f) << 8) | buf[offset + 1];
  const hi = buf.readUInt32BE(offset + 2);
  const lo = buf.readUInt32BE(offset + 6);
  if (exponent === 0 && hi === 0 && lo === 0) return 22050;
  const mantissa = hi / 2 ** 31 + lo / 2 ** 63;
  const val = mantissa * 2 ** (exponent - 16383);
  return Number.isFinite(val) && val > 0 ? Math.round(val) : 22050;
}

export function aiffToWav(aiffBuffer: Buffer): Buffer {
  if (
    aiffBuffer.length >= 12 &&
    aiffBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    aiffBuffer.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return aiffBuffer;
  }

  if (aiffBuffer.length < 12 || aiffBuffer.subarray(0, 4).toString('ascii') !== 'FORM') {
    throw new Error('Invalid AIFF buffer: missing FORM header.');
  }

  const formType = aiffBuffer.subarray(8, 12).toString('ascii');
  if (formType !== 'AIFF' && formType !== 'AIFC') {
    throw new Error(`Unsupported FORM type "${formType}"`);
  }

  let channels = 1;
  let sampleRate = 22050;
  let bitsPerSample = 16;
  let isLittleEndianPcm = false;
  let pcmData: Buffer | null = null;

  let offset = 12;
  while (offset + 8 <= aiffBuffer.length) {
    const chunkId = aiffBuffer.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = aiffBuffer.readUInt32BE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = Math.min(aiffBuffer.length, dataStart + chunkSize);

    if (chunkId === 'COMM' && dataEnd - dataStart >= 18) {
      channels = aiffBuffer.readInt16BE(dataStart);
      bitsPerSample = aiffBuffer.readInt16BE(dataStart + 6);
      sampleRate = decodeIeeeExtended80(aiffBuffer, dataStart + 8);
      if (formType === 'AIFC' && dataEnd - dataStart >= 22) {
        const comp = aiffBuffer.subarray(dataStart + 18, dataStart + 22).toString('ascii');
        isLittleEndianPcm = comp === 'sowt';
      }
    } else if (chunkId === 'SSND' && dataEnd - dataStart >= 8) {
      const ssndOffset = aiffBuffer.readUInt32BE(dataStart);
      const audioStart = Math.min(dataEnd, dataStart + 8 + ssndOffset);
      const rawAudio = aiffBuffer.subarray(audioStart, dataEnd);
      if (bitsPerSample === 16 && !isLittleEndianPcm) {
        const swapped = Buffer.alloc(rawAudio.length);
        for (let i = 0; i + 1 < rawAudio.length; i += 2) {
          swapped[i] = rawAudio[i + 1];
          swapped[i + 1] = rawAudio[i];
        }
        pcmData = swapped;
      } else {
        pcmData = Buffer.from(rawAudio);
      }
    }

    offset = dataStart + chunkSize + (chunkSize % 2);
  }

  if (!pcmData) {
    throw new Error('Invalid AIFF buffer: missing SSND audio chunk.');
  }

  const header = createPcmWavHeader(pcmData.length, sampleRate, channels, bitsPerSample);
  return Buffer.concat([header, pcmData]);
}

export async function synthesizeSystemSpeechWav(params: {
  text: string;
  voiceId: string;
  nativeVoice?: VoiceProfile | null;
  platform?: NodeJS.Platform;
  execFileFn?: ExecFileLike;
}): Promise<{
  audioBuffer: Buffer;
  engine: 'macos-say' | 'espeak-ng' | 'espeak';
} | null> {
  const platform = params.platform ?? process.platform;
  const runExec: ExecFileLike = params.execFileFn ?? execFileAsync;
  const profile = resolveSpeechProfile(params.voiceId, params.nativeVoice);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'calamari-tts-'));

  try {
    if (platform === 'darwin') {
      const wavPath = path.join(tmpDir, 'speech.wav');
      try {
        await runExec(
          '/usr/bin/say',
          buildMacOsSayArgs({
            voice: profile.macOsVoice,
            wpm: profile.wpm,
            outputPath: wavPath,
            text: params.text,
            fileFormat: 'WAVE',
          }),
          { timeout: 25000 }
        );
        const wavBuf = await fs.readFile(wavPath);
        if (wavBuf.length > 44 && wavBuf.subarray(0, 4).toString('ascii') === 'RIFF') {
          return { audioBuffer: wavBuf, engine: 'macos-say' };
        }
      } catch {
        // Fallback to AIFF -> WAV conversion when --file-format=WAVE is unavailable
      }

      const aiffPath = path.join(tmpDir, 'speech.aiff');
      try {
        await runExec(
          '/usr/bin/say',
          buildMacOsSayArgs({
            voice: profile.macOsVoice,
            wpm: profile.wpm,
            outputPath: aiffPath,
            text: params.text,
            fileFormat: 'AIFF',
          }),
          { timeout: 25000 }
        );
        const aiffBuf = await fs.readFile(aiffPath);
        const wavBuf = aiffToWav(aiffBuf);
        if (wavBuf.length > 44) {
          return { audioBuffer: wavBuf, engine: 'macos-say' };
        }
      } catch {
        return null;
      }
      return null;
    }

    for (const bin of ['espeak-ng', 'espeak'] as const) {
      const wavPath = path.join(tmpDir, `${bin}.wav`);
      try {
        await runExec(
          bin,
          buildEspeakArgs({
            voice: profile.espeakVoice,
            wpm: profile.wpm,
            pitch: profile.espeakPitch,
            outputPath: wavPath,
            text: params.text,
          }),
          { timeout: 20000 }
        );
        const wavBuf = await fs.readFile(wavPath);
        if (wavBuf.length > 44 && wavBuf.subarray(0, 4).toString('ascii') === 'RIFF') {
          return { audioBuffer: wavBuf, engine: bin };
        }
      } catch {
        // Binary missing or failed; try next candidate
      }
    }

    return null;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export type SynthesizeSpeechResult =
  | {
      kind: 'audio';
      audioBuffer: Buffer;
      contentType: string;
      source: 'elevenlabs' | 'native' | 'mock';
      synthesisMode: 'elevenlabs' | 'direct-sample' | 'macos-say' | 'espeak-ng' | 'espeak';
      fallbackReason?: string;
    }
  | {
      kind: 'speech-synthesis';
      source: 'native' | 'mock';
      fallback: TtsBrowserFallback;
      fallbackReason: string;
    };

function buildBrowserSpeechFallback(params: {
  text: string;
  voiceId: string;
  source: 'native' | 'mock';
  nativeVoice?: VoiceProfile | null;
  reason: string;
}): SynthesizeSpeechResult {
  const profile = resolveSpeechProfile(params.voiceId, params.nativeVoice);
  return {
    kind: 'speech-synthesis',
    source: params.source,
    fallbackReason: params.reason,
    fallback: {
      mode: 'browser-speech-synthesis',
      source: params.source,
      text: sanitizeSpeechText(params.text).trim(),
      voiceId: params.voiceId,
      voiceName: profile.voiceName,
      speechConfig: profile.browserSpeechConfig,
      sampleUrl: params.nativeVoice?.sampleUrl,
      fallbackReason: params.reason,
    },
  };
}

function readVoiceSampleFromUploads(
  sampleUrl: string | undefined,
  uploadsRootDir: string | undefined
): Buffer | null {
  if (!sampleUrl || !uploadsRootDir || !sampleUrl.startsWith('/uploads/')) {
    return null;
  }
  const rel = sampleUrl.replace(/^\/uploads\//, '');
  const fullPath = path.resolve(uploadsRootDir, rel);
  if (!fullPath.startsWith(path.resolve(uploadsRootDir)) || !fsSync.existsSync(fullPath)) {
    return null;
  }
  const buf = fsSync.readFileSync(fullPath);
  return buf.length > 0 ? buf : null;
}

export async function synthesizeElevenLabsSpeech(params: {
  voiceId: string;
  text: string;
  playbackMode?: 'auto' | VoicePlaybackMode;
  uploadsRootDir?: string;
  sessionHeaderKey?: string;
  vault?: CredentialVault;
  voiceStore?: VoiceStore;
  platform?: NodeJS.Platform;
  execFileFn?: ExecFileLike;
}): Promise<SynthesizeSpeechResult> {
  const { key, endpoint } = resolveElevenLabsKey(params.sessionHeaderKey, params.vault);
  const nativeVoice = params.voiceStore ? await params.voiceStore.getVoice(params.voiceId) : null;

  if (nativeVoice) {
    const effectiveMode: VoicePlaybackMode =
      params.playbackMode && params.playbackMode !== 'auto'
        ? params.playbackMode
        : nativeVoice.playbackMode || 'speak-script';

    if (effectiveMode === 'direct-sample' && nativeVoice.sampleUrl) {
      const sampleBuf = readVoiceSampleFromUploads(nativeVoice.sampleUrl, params.uploadsRootDir);
      if (sampleBuf) {
        return {
          kind: 'audio',
          audioBuffer: sampleBuf,
          contentType: nativeVoice.sampleMimeType || 'audio/wav',
          source: 'native',
          synthesisMode: 'direct-sample',
        };
      }
    }

    if (key && nativeVoice.elevenlabsVoiceId) {
      try {
        const res = await fetch(
          `${endpoint}/text-to-speech/${encodeURIComponent(nativeVoice.elevenlabsVoiceId)}`,
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
                stability: Math.max(0.2, Math.min(0.9, (nativeVoice.traits?.warmth ?? 60) / 100)),
                similarity_boost: 0.8,
              },
            }),
            signal: AbortSignal.timeout(15000),
          }
        );
        if (res.ok) {
          const buf = await res.arrayBuffer();
          return {
            kind: 'audio',
            audioBuffer: Buffer.from(buf),
            contentType: res.headers.get('content-type') || 'audio/mpeg',
            source: 'elevenlabs',
            synthesisMode: 'elevenlabs',
          };
        }
      } catch {
        // Fall through to system speech synthesis
      }
    }

    const systemSpeech = await synthesizeSystemSpeechWav({
      text: params.text,
      voiceId: params.voiceId,
      nativeVoice,
      platform: params.platform,
      execFileFn: params.execFileFn,
    });
    if (systemSpeech) {
      return {
        kind: 'audio',
        audioBuffer: systemSpeech.audioBuffer,
        contentType: 'audio/wav',
        source: 'native',
        synthesisMode: systemSpeech.engine,
      };
    }

    return buildBrowserSpeechFallback({
      text: params.text,
      voiceId: params.voiceId,
      source: 'native',
      nativeVoice,
      reason:
        'Using browser SpeechSynthesis with native voice traits (no server speech binary installed).',
    });
  }

  const isMockVoice = params.voiceId.startsWith('mock-');
  let upstreamFailureReason: string | undefined;

  if (key && !isMockVoice) {
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

      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        return {
          kind: 'audio',
          audioBuffer: Buffer.from(arrayBuffer),
          contentType: res.headers.get('content-type') || 'audio/mpeg',
          source: 'elevenlabs',
          synthesisMode: 'elevenlabs',
        };
      }
      upstreamFailureReason = `ElevenLabs TTS returned HTTP ${res.status}; fell back to local speech.`;
    } catch (err) {
      upstreamFailureReason = `ElevenLabs TTS request failed (${err instanceof Error ? err.message : 'network error'}); fell back to local speech.`;
    }
  }

  const systemSpeech = await synthesizeSystemSpeechWav({
    text: params.text,
    voiceId: params.voiceId,
    platform: params.platform,
    execFileFn: params.execFileFn,
  });
  if (systemSpeech) {
    return {
      kind: 'audio',
      audioBuffer: systemSpeech.audioBuffer,
      contentType: 'audio/wav',
      source: 'mock',
      synthesisMode: systemSpeech.engine,
      fallbackReason:
        upstreamFailureReason ||
        (!key
          ? `Synthesized spoken voiceover via ${systemSpeech.engine}.`
          : `Synthesized studio voiceover via ${systemSpeech.engine}.`),
    };
  }

  return buildBrowserSpeechFallback({
    text: params.text,
    voiceId: params.voiceId,
    source: 'mock',
    reason:
      upstreamFailureReason ||
      (!key
        ? 'No ELEVENLABS_API_KEY or server TTS binary available; using browser SpeechSynthesis.'
        : 'Using browser SpeechSynthesis for studio voice narration.'),
  });
}

export async function pushVoiceToElevenLabs(params: {
  voice: VoiceProfile;
  uploadsRootDir: string;
  sessionHeaderKey?: string;
  vault?: CredentialVault;
  voiceStore: VoiceStore;
}): Promise<PushVoiceElevenLabsResult> {
  const { key, endpoint } = resolveElevenLabsKey(params.sessionHeaderKey, params.vault);
  const targetUrl = `${endpoint}/voices/add`;

  if (!key) {
    const updated =
      (await params.voiceStore.updateVoice(params.voice.voice_id, {
        pushStatus: 'export-ready',
      })) || { ...params.voice, pushStatus: 'export-ready' as const };

    return {
      ok: true,
      mode: 'export-ready',
      voice: updated,
      message:
        'ElevenLabs is disconnected — generated ready workflow export. Connect ElevenLabs to push directly.',
      workflowExport: {
        endpoint: targetUrl,
        method: 'POST',
        headers: { 'xi-api-key': '<ELEVENLABS_API_KEY>' },
        sampleUrl: params.voice.sampleUrl,
        payload: {
          name: params.voice.name,
          description: params.voice.description,
          labels: params.voice.labels,
          traits: params.voice.traits,
        },
      },
    };
  }

  const form = new FormData();
  form.append('name', params.voice.name);
  if (params.voice.description) {
    form.append('description', params.voice.description);
  }
  form.append('labels', JSON.stringify(params.voice.labels || {}));

  let sampleBuffer: Buffer | null = readVoiceSampleFromUploads(
    params.voice.sampleUrl,
    params.uploadsRootDir
  );
  let sampleName = 'voice-sample.wav';
  const sampleMime = params.voice.sampleMimeType || 'audio/wav';

  if (sampleBuffer && params.voice.sampleUrl) {
    sampleName = path.basename(params.voice.sampleUrl);
  }

  if (!sampleBuffer) {
    const systemSample = await synthesizeSystemSpeechWav({
      text: `Voice calibration sample for ${params.voice.name}.`,
      voiceId: params.voice.voice_id,
      nativeVoice: params.voice,
    });
    sampleBuffer = systemSample?.audioBuffer || null;
  }

  if (!sampleBuffer) {
    throw new Error(
      'Record or upload an audio sample for this voice before pushing to ElevenLabs.'
    );
  }

  form.append('files', new Blob([new Uint8Array(sampleBuffer)], { type: sampleMime }), sampleName);

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs /v1/voices/add returned HTTP ${res.status}${errText ? `: ${errText}` : ''}`);
  }

  const data = (await res.json()) as { voice_id?: string };
  const elevenlabsVoiceId = data.voice_id;
  const updated =
    (await params.voiceStore.updateVoice(params.voice.voice_id, {
      elevenlabsVoiceId,
      pushStatus: 'pushed',
    })) || {
      ...params.voice,
      elevenlabsVoiceId,
      pushStatus: 'pushed' as const,
    };

  return {
    ok: true,
    mode: 'pushed',
    elevenlabsVoiceId,
    voice: updated,
    message: `Pushed "${params.voice.name}" to ElevenLabs (${elevenlabsVoiceId || 'synced'}).`,
  };
}
