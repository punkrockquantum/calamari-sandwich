import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { VoiceAcousticSignature, VoiceTraits } from '../../shared/types.js';

const execFileAsync = promisify(execFile);

export interface ParsedPcmWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: Float32Array; // mono normalized [-1, 1]
}

export function parsePcmWavMono(wavBuffer: Buffer): ParsedPcmWav | null {
  if (
    wavBuffer.length < 44 ||
    wavBuffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    wavBuffer.subarray(8, 12).toString('ascii') !== 'WAVE'
  ) {
    return null;
  }

  let sampleRate = 22050;
  let channels = 1;
  let bitsPerSample = 16;
  let audioFormat = 1;
  let dataStart = -1;
  let dataSize = 0;

  let offset = 12;
  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    const bodyEnd = Math.min(wavBuffer.length, bodyStart + chunkSize);

    if (chunkId === 'fmt ' && bodyEnd - bodyStart >= 16) {
      audioFormat = wavBuffer.readUInt16LE(bodyStart);
      channels = Math.max(1, wavBuffer.readUInt16LE(bodyStart + 2));
      sampleRate = Math.max(8000, wavBuffer.readUInt32LE(bodyStart + 4));
      bitsPerSample = wavBuffer.readUInt16LE(bodyStart + 14);
    } else if (chunkId === 'data') {
      dataStart = bodyStart;
      dataSize = bodyEnd - bodyStart;
      break;
    }

    offset = bodyStart + chunkSize + (chunkSize % 2);
  }

  if (dataStart < 0 || dataSize <= 0) {
    return null;
  }
  if (audioFormat !== 1 && audioFormat !== 3) {
    return null;
  }

  const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
  const frameSize = bytesPerSample * channels;
  const frameCount = Math.floor(dataSize / frameSize);
  if (frameCount <= 0) {
    return null;
  }

  const mono = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      const pos = dataStart + i * frameSize + ch * bytesPerSample;
      if (audioFormat === 3 && bitsPerSample === 32 && pos + 4 <= wavBuffer.length) {
        sum += wavBuffer.readFloatLE(pos);
      } else if (bitsPerSample === 16 && pos + 2 <= wavBuffer.length) {
        sum += wavBuffer.readInt16LE(pos) / 32768;
      } else if (bitsPerSample === 8 && pos < wavBuffer.length) {
        sum += (wavBuffer.readUInt8(pos) - 128) / 128;
      } else if (bitsPerSample === 24 && pos + 3 <= wavBuffer.length) {
        const b0 = wavBuffer[pos];
        const b1 = wavBuffer[pos + 1];
        const b2 = wavBuffer[pos + 2];
        let val = b0 | (b1 << 8) | (b2 << 16);
        if (val & 0x800000) val |= ~0xffffff;
        sum += val / 8388608;
      }
    }
    mono[i] = sum / channels;
  }

  return { sampleRate, channels, bitsPerSample, samples: mono };
}

export function encodeMonoPcm16Wav(samples: Float32Array, sampleRate: number): Buffer {
  const dataSize = samples.length * 2;
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  const pcm = Buffer.alloc(dataSize);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const intVal = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, intVal)), i * 2);
  }
  return Buffer.concat([header, pcm]);
}

export function deriveFallbackAcousticSignature(traits?: VoiceTraits): VoiceAcousticSignature {
  const pitch = traits?.pitch || 'medium';
  const warmth = traits?.warmth ?? 70;
  const cadence = traits?.cadence || 'conversational';
  const toneLower = (traits?.tone || '').toLowerCase();

  const f0Hz =
    pitch === 'low' ? 118 : pitch === 'high' ? 212 : toneLower.includes('deep') ? 132 : 168;
  const brightness = toneLower.includes('crisp') || toneLower.includes('energetic')
    ? 68
    : Math.max(25, Math.min(85, 100 - Math.round(warmth * 0.55)));
  const speakingRateWpm = cadence === 'brisk' ? 202 : cadence === 'measured' ? 150 : 174;

  return {
    f0Hz,
    brightness,
    warmth,
    speakingRateWpm,
    analyzedFromSample: false,
  };
}

function estimateFramePitchHz(
  samples: Float32Array,
  start: number,
  frameLen: number,
  sampleRate: number
): number | null {
  const minLag = Math.max(2, Math.floor(sampleRate / 340));
  const maxLag = Math.min(frameLen - 2, Math.floor(sampleRate / 70));
  if (maxLag <= minLag) return null;

  let energy = 0;
  for (let i = 0; i < frameLen; i++) {
    const s = samples[start + i];
    energy += s * s;
  }
  const rms = Math.sqrt(energy / frameLen);
  if (rms < 0.008) return null;

  let bestLag = -1;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let denomA = 0;
    let denomB = 0;
    const limit = frameLen - lag;
    for (let i = 0; i < limit; i++) {
      const a = samples[start + i];
      const b = samples[start + i + lag];
      num += a * b;
      denomA += a * a;
      denomB += b * b;
    }
    const denom = Math.sqrt(denomA * denomB);
    const norm = denom > 1e-9 ? num / denom : 0;
    if (norm > bestCorr) {
      bestCorr = norm;
      bestLag = lag;
    }
  }

  if (bestLag > 0 && bestCorr > 0.38) {
    return sampleRate / bestLag;
  }
  return null;
}

export function analyzePcmSamples(
  samples: Float32Array,
  sampleRate: number,
  fallbackTraits?: VoiceTraits
): VoiceAcousticSignature {
  const fallback = deriveFallbackAcousticSignature(fallbackTraits);
  if (samples.length < Math.max(256, Math.floor(sampleRate * 0.08))) {
    return fallback;
  }

  let totalSq = 0;
  let zeroCrossings = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    totalSq += s * s;
    if (i > 0 && ((samples[i - 1] >= 0 && s < 0) || (samples[i - 1] < 0 && s >= 0))) {
      zeroCrossings++;
    }
  }
  const energyRms = Math.sqrt(totalSq / samples.length);
  const durationSec = Number((samples.length / sampleRate).toFixed(2));
  if (energyRms < 0.002) {
    return { ...fallback, energyRms: Number(energyRms.toFixed(4)), durationSec };
  }

  // Pitch estimation across frames
  const frameLen = Math.min(samples.length, Math.max(256, Math.round(sampleRate * 0.04)));
  const hop = Math.max(128, Math.floor(frameLen / 2));
  const pitches: number[] = [];
  for (let start = 0; start + frameLen <= samples.length; start += hop) {
    const hz = estimateFramePitchHz(samples, start, frameLen, sampleRate);
    if (hz !== null) pitches.push(hz);
    if (pitches.length >= 120) break;
  }

  let f0Hz = fallback.f0Hz;
  if (pitches.length > 0) {
    pitches.sort((a, b) => a - b);
    f0Hz = Math.round(pitches[Math.floor(pitches.length / 2)]);
  }

  // Brightness / warmth via 1-pole low-pass split around ~800Hz + ZCR
  const rc = 1 / (2 * Math.PI * 800);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  let lp = 0;
  let lowEnergy = 0;
  let highEnergy = 0;
  for (let i = 0; i < samples.length; i++) {
    lp = lp + alpha * (samples[i] - lp);
    const hp = samples[i] - lp;
    lowEnergy += lp * lp;
    highEnergy += hp * hp;
  }
  const totalBandEnergy = lowEnergy + highEnergy + 1e-12;
  const highRatio = highEnergy / totalBandEnergy;
  const zcrHz = (zeroCrossings / durationSec) * 0.5;
  const brightnessRaw = highRatio * 95 + Math.min(35, zcrHz / 85);
  const brightness = Math.round(Math.max(15, Math.min(95, brightnessRaw)));
  const warmth = Math.round(Math.max(15, Math.min(95, 100 - brightness * 0.65 + (f0Hz < 150 ? 14 : 0))));

  // Speaking rate estimation from 25ms energy envelope peaks (syllable cadence)
  const envStep = Math.max(1, Math.round(sampleRate * 0.025));
  const env: number[] = [];
  for (let i = 0; i + envStep <= samples.length; i += envStep) {
    let e = 0;
    for (let j = 0; j < envStep; j++) {
      e += Math.abs(samples[i + j]);
    }
    env.push(e / envStep);
  }
  const meanEnv = env.reduce((a, b) => a + b, 0) / Math.max(1, env.length);
  let peaks = 0;
  let cooldown = 0;
  for (let i = 1; i + 1 < env.length; i++) {
    if (cooldown > 0) {
      cooldown--;
      continue;
    }
    if (env[i] > meanEnv * 1.18 && env[i] >= env[i - 1] && env[i] >= env[i + 1]) {
      peaks++;
      cooldown = 4; // >= 100ms between syllables
    }
  }
  const syllablesPerSec = durationSec > 0.25 ? peaks / durationSec : 3.2;
  const estimatedWpm =
    peaks >= 2
      ? Math.round(Math.max(125, Math.min(225, syllablesPerSec * 42)))
      : fallback.speakingRateWpm;

  return {
    f0Hz,
    brightness,
    warmth,
    speakingRateWpm: estimatedWpm,
    energyRms: Number(energyRms.toFixed(4)),
    durationSec,
    analyzedFromSample: true,
  };
}

export async function analyzeVoiceSampleFile(params: {
  filePath?: string;
  buffer?: Buffer;
  fallbackTraits?: VoiceTraits;
}): Promise<VoiceAcousticSignature> {
  let rawBuf = params.buffer;
  if (!rawBuf && params.filePath) {
    rawBuf = await fs.readFile(params.filePath).catch(() => undefined);
  }
  if (!rawBuf || rawBuf.length === 0) {
    return deriveFallbackAcousticSignature(params.fallbackTraits);
  }

  const directWav = parsePcmWavMono(rawBuf);
  if (directWav) {
    return analyzePcmSamples(directWav.samples, directWav.sampleRate, params.fallbackTraits);
  }

  // Decode compressed formats (webm/mp3/m4a/ogg) via ffmpeg if available
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'calamari-analyze-'));
  try {
    const inputPath = params.filePath || path.join(tmpDir, 'sample.bin');
    if (!params.filePath) {
      await fs.writeFile(inputPath, rawBuf);
    }
    const { stdout } = await execFileAsync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-i', inputPath, '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 10000 }
    );
    const decodedWav = parsePcmWavMono(Buffer.from(stdout));
    if (decodedWav) {
      return analyzePcmSamples(decodedWav.samples, decodedWav.sampleRate, params.fallbackTraits);
    }
  } catch {
    // ffmpeg unavailable or unreadable test fixture — fall back gracefully
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }

  return deriveFallbackAcousticSignature(params.fallbackTraits);
}

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function designShelfBiquad(
  type: 'lowshelf' | 'highshelf',
  freqHz: number,
  sampleRate: number,
  gainDb: number
): BiquadCoeffs {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * Math.min(freqHz, sampleRate * 0.42)) / sampleRate;
  const cosW = Math.cos(w0);
  const sinW = Math.sin(w0);
  const alpha = (sinW / 2) * Math.sqrt((A + 1 / A) * (1 / 0.707 - 1) + 2);
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;

  if (type === 'lowshelf') {
    b0 = A * (A + 1 - (A - 1) * cosW + twoSqrtAAlpha);
    b1 = 2 * A * (A - 1 - (A + 1) * cosW);
    b2 = A * (A + 1 - (A - 1) * cosW - twoSqrtAAlpha);
    a0 = A + 1 + (A - 1) * cosW + twoSqrtAAlpha;
    a1 = -2 * (A - 1 + (A + 1) * cosW);
    a2 = A + 1 + (A - 1) * cosW - twoSqrtAAlpha;
  } else {
    b0 = A * (A + 1 + (A - 1) * cosW + twoSqrtAAlpha);
    b1 = -2 * A * (A - 1 + (A + 1) * cosW);
    b2 = A * (A + 1 + (A - 1) * cosW - twoSqrtAAlpha);
    a0 = A + 1 - (A - 1) * cosW + twoSqrtAAlpha;
    a1 = 2 * (A - 1 - (A + 1) * cosW);
    a2 = A + 1 - (A - 1) * cosW - twoSqrtAAlpha;
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function applyBiquad(samples: Float32Array, c: BiquadCoeffs): Float32Array {
  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    out[i] = y0;
  }
  return out;
}

/**
 * Overlap-Add time-domain pitch & rate shaper in pure TypeScript.
 * Shifts fundamental pitch by `pitchRatio` while scaling speaking speed by `rateRatio`.
 */
function resampleAndScaleOla(
  samples: Float32Array,
  sampleRate: number,
  pitchRatio: number,
  rateRatio: number
): Float32Array {
  if (
    samples.length < 256 ||
    (Math.abs(pitchRatio - 1) < 0.015 && Math.abs(rateRatio - 1) < 0.015)
  ) {
    return samples;
  }

  // Step 1: OLA time-stretch by (pitchRatio / rateRatio) so resampling by pitchRatio yields target rateRatio
  const stretchFactor = Math.max(0.6, Math.min(1.65, pitchRatio / rateRatio));
  const winSize = Math.min(samples.length, Math.max(256, Math.round(sampleRate * 0.032)));
  const synHop = Math.floor(winSize / 2);
  const anaHop = Math.max(16, Math.round(synHop / stretchFactor));
  const stretchedLen = Math.max(
    winSize,
    Math.ceil((samples.length / anaHop) * synHop + winSize)
  );
  const stretched = new Float32Array(stretchedLen);
  const weightSum = new Float32Array(stretchedLen);

  const hann = new Float32Array(winSize);
  for (let i = 0; i < winSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (winSize - 1)));
  }

  let anaPos = 0;
  let synPos = 0;
  while (anaPos + winSize <= samples.length && synPos + winSize <= stretchedLen) {
    for (let i = 0; i < winSize; i++) {
      const w = hann[i];
      stretched[synPos + i] += samples[anaPos + i] * w;
      weightSum[synPos + i] += w;
    }
    anaPos += anaHop;
    synPos += synHop;
  }

  const validStretchedLen = Math.min(stretchedLen, synPos + winSize);
  for (let i = 0; i < validStretchedLen; i++) {
    if (weightSum[i] > 1e-4) {
      stretched[i] /= weightSum[i];
    }
  }

  // Step 2: Linear interpolation resample at `pitchRatio`
  const outLen = Math.max(64, Math.floor(validStretchedLen / pitchRatio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * pitchRatio;
    const i0 = Math.floor(srcIdx);
    const frac = srcIdx - i0;
    const s0 = stretched[Math.min(validStretchedLen - 1, i0)];
    const s1 = stretched[Math.min(validStretchedLen - 1, i0 + 1)];
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

/**
 * Applies real PCM WAV DSP shaping (pitch/rate resampling + warmth/brightness biquad filters)
 * on top of spoken TTS output so cloned voices audibly match the user's acoustic signature.
 */
export function shapeVoiceWavBuffer(
  wavBuffer: Buffer,
  profile: {
    traits?: VoiceTraits;
    acousticSignature?: VoiceAcousticSignature;
  }
): Buffer {
  const parsed = parsePcmWavMono(wavBuffer);
  if (!parsed || parsed.samples.length < 64) {
    return wavBuffer;
  }

  const sig = profile.acousticSignature;
  const traits = profile.traits;

  const targetF0 = sig?.f0Hz ?? (traits?.pitch === 'low' ? 120 : traits?.pitch === 'high' ? 210 : 165);
  const pitchRatio = Math.max(0.78, Math.min(1.28, targetF0 / 165));

  const targetWpm =
    sig?.speakingRateWpm ??
    (traits?.cadence === 'brisk' ? 200 : traits?.cadence === 'measured' ? 152 : 174);
  const rateRatio = Math.max(0.84, Math.min(1.2, targetWpm / 174));

  const warmth = sig?.warmth ?? traits?.warmth ?? 65;
  const brightness = sig?.brightness ?? 52;

  let shaped = resampleAndScaleOla(parsed.samples, parsed.sampleRate, pitchRatio, rateRatio);

  const warmthGainDb = ((warmth - 55) / 45) * 4.8;
  if (Math.abs(warmthGainDb) > 0.25) {
    shaped = applyBiquad(
      shaped,
      designShelfBiquad('lowshelf', 220, parsed.sampleRate, warmthGainDb)
    );
  }

  const brightnessGainDb = ((brightness - 50) / 50) * 4.2;
  if (Math.abs(brightnessGainDb) > 0.25) {
    shaped = applyBiquad(
      shaped,
      designShelfBiquad('highshelf', 3200, parsed.sampleRate, brightnessGainDb)
    );
  }

  // Soft-clip limiter to prevent clipping after spectral boost
  for (let i = 0; i < shaped.length; i++) {
    const v = shaped[i];
    if (Math.abs(v) > 0.92) {
      shaped[i] = Math.tanh(v);
    }
  }

  return encodeMonoPcm16Wav(shaped, parsed.sampleRate);
}
