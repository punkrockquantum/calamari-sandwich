// Studio audio preview, timeline voiceover playback, browser SpeechSynthesis & ambient bed

import type { TtsSpeechConfig } from '@shared/types';

let activeAudioEl: HTMLAudioElement | null = null;
let activeBufferSource: AudioBufferSourceNode | null = null;
let activeBufferGain: GainNode | null = null;
let audioCtx: AudioContext | null = null;
let ambientStopFn: (() => void) | null = null;
let speechSessionId = 0;

function getAudioContext(): AudioContext | null {
  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioCtx) {
    audioCtx = new AudioContextCtor();
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => undefined);
  }
  return audioCtx;
}

function getOrCreateVoiceAudioEl(): HTMLAudioElement {
  if (!activeAudioEl) {
    activeAudioEl = new Audio();
    activeAudioEl.preload = 'auto';
  }
  return activeAudioEl;
}

/**
 * Call synchronously inside user click handlers (Play, Preview Voice) so
 * Web Audio & HTMLAudioElement remain unlocked across async TTS fetches and scene transitions.
 */
export function unlockAudio(): void {
  try {
    getAudioContext();
    getOrCreateVoiceAudioEl();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      // Prime available speech synthesis voices list early
      window.speechSynthesis.getVoices();
    }
  } catch {
    // Ignore environments without Web Audio / HTMLAudioElement / SpeechSynthesis
  }
}

export function stopBrowserSpeech(): void {
  speechSessionId += 1;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore cancel errors in restricted environments
    }
  }
}

export function stopVoiceAudio(): void {
  stopBrowserSpeech();
  if (activeAudioEl) {
    try {
      activeAudioEl.pause();
      activeAudioEl.removeAttribute('src');
      activeAudioEl.load();
    } catch {
      // Ignore media element reset errors
    }
  }
  if (activeBufferSource) {
    try {
      activeBufferSource.stop();
      activeBufferSource.disconnect();
    } catch {
      // Ignore already stopped buffer source
    }
    activeBufferSource = null;
  }
  if (activeBufferGain) {
    try {
      activeBufferGain.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    activeBufferGain = null;
  }
}

export function stopAllAudio(): void {
  stopVoiceAudio();
  if (ambientStopFn) {
    ambientStopFn();
    ambientStopFn = null;
  }
}

async function playViaAudioContext(
  url: string,
  volume: number,
  startOffsetSec: number,
  warmth?: number
): Promise<boolean> {
  const ctx = getAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    const resp = await fetch(url);
    const arrBuf = await resp.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrBuf);
    const source = ctx.createBufferSource();
    source.buffer = decoded;

    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));

    if (typeof warmth === 'number' && warmth !== 65) {
      const warmthFilter = ctx.createBiquadFilter();
      warmthFilter.type = 'lowshelf';
      warmthFilter.frequency.value = 220;
      warmthFilter.gain.value = ((warmth - 65) / 35) * 3.5;
      source.connect(warmthFilter);
      warmthFilter.connect(gain);
    } else {
      source.connect(gain);
    }

    gain.connect(ctx.destination);
    const offset =
      startOffsetSec > 0.25 && startOffsetSec < decoded.duration - 0.15
        ? startOffsetSec
        : 0;
    activeBufferSource = source;
    activeBufferGain = gain;
    source.onended = () => {
      if (activeBufferSource === source) {
        activeBufferSource = null;
      }
    };
    source.start(0, offset);
    return true;
  } catch {
    return false;
  }
}

export async function playVoiceBlobUrl(
  url: string,
  volume = 0.9,
  startOffsetSec = 0,
  traits?: { warmth?: number }
): Promise<{ ok: boolean; error?: string }> {
  stopVoiceAudio();

  // When a custom warmth trait is specified, prefer AudioContext EQ chain if available
  if (typeof traits?.warmth === 'number' && traits.warmth !== 65) {
    const eqOk = await playViaAudioContext(url, volume, startOffsetSec, traits.warmth);
    if (eqOk) return { ok: true };
  }

  const audio = getOrCreateVoiceAudioEl();
  audio.volume = Math.max(0, Math.min(1, volume));
  audio.src = url;

  if (startOffsetSec > 0.25) {
    audio.addEventListener(
      'loadedmetadata',
      () => {
        if (Number.isFinite(audio.duration) && startOffsetSec < audio.duration - 0.15) {
          try {
            audio.currentTime = startOffsetSec;
          } catch {
            // Ignore seek failure
          }
        }
      },
      { once: true }
    );
  }

  try {
    await audio.play();
    return { ok: true };
  } catch (err) {
    const fallbackOk = await playViaAudioContext(url, volume, startOffsetSec, traits?.warmth);
    if (fallbackOk) {
      return { ok: true };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Browser blocked audio playback.',
    };
  }
}

export async function playAudioUrl(
  url: string,
  volume = 0.9
): Promise<{ ok: boolean; error?: string }> {
  return playVoiceBlobUrl(url, volume, 0);
}

function splitIntoSpeechChunks(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [text.trim()].filter(Boolean);
}

function selectBrowserSpeechVoice(
  voices: SpeechSynthesisVoice[],
  config: TtsSpeechConfig
): SpeechSynthesisVoice | undefined {
  if (voices.length === 0) return undefined;
  const preferred = config.preferredVoices.map((p) => p.toLowerCase());
  for (const name of preferred) {
    const exact = voices.find((v) => v.name.toLowerCase().includes(name));
    if (exact) return exact;
  }
  const langPrefix = config.lang.split('-')[0].toLowerCase();
  const byExactLang = voices.find((v) => v.lang.toLowerCase() === config.lang.toLowerCase());
  if (byExactLang) return byExactLang;
  const byLangPrefix = voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
  return byLangPrefix || voices[0];
}

export async function speakWithBrowserSpeechSynthesis(params: {
  text: string;
  speechConfig: TtsSpeechConfig;
  startOffsetSec?: number;
  sceneDurationSec?: number;
  volume?: number;
}): Promise<{ ok: boolean; voiceUsed?: string; error?: string }> {
  stopVoiceAudio();

  if (
    typeof window === 'undefined' ||
    !('speechSynthesis' in window) ||
    typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    return { ok: false, error: 'Browser SpeechSynthesis is not supported in this environment.' };
  }

  const synth = window.speechSynthesis;
  const session = speechSessionId;
  const chunks = splitIntoSpeechChunks(params.text);
  if (chunks.length === 0) return { ok: true };

  // When seeking mid-scene, skip leading sentences proportional to playhead offset
  let startChunkIndex = 0;
  if (
    params.startOffsetSec &&
    params.startOffsetSec > 1.0 &&
    params.sceneDurationSec &&
    params.sceneDurationSec > 2
  ) {
    const ratio = Math.min(0.85, Math.max(0, params.startOffsetSec / params.sceneDurationSec));
    startChunkIndex = Math.min(chunks.length - 1, Math.floor(ratio * chunks.length));
  }

  const activeChunks = chunks.slice(startChunkIndex);
  let availableVoices = synth.getVoices();
  if (availableVoices.length === 0) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      const timer = window.setTimeout(done, 120);
      synth.addEventListener(
        'voiceschanged',
        () => {
          window.clearTimeout(timer);
          done();
        },
        { once: true }
      );
    });
    if (session !== speechSessionId) return { ok: true };
    availableVoices = synth.getVoices();
  }

  const chosenVoice = selectBrowserSpeechVoice(availableVoices, params.speechConfig);
  const clampedRate = Math.max(0.6, Math.min(1.8, params.speechConfig.rate || 1.0));
  const clampedPitch = Math.max(0.5, Math.min(1.8, params.speechConfig.pitch || 1.0));
  const volume = Math.max(0, Math.min(1, params.volume ?? 0.92));

  try {
    const speakChunkAt = (idx: number) => {
      if (session !== speechSessionId || idx >= activeChunks.length) return;
      const utterance = new SpeechSynthesisUtterance(activeChunks[idx]);
      if (chosenVoice) {
        utterance.voice = chosenVoice;
        utterance.lang = chosenVoice.lang;
      } else {
        utterance.lang = params.speechConfig.lang || 'en-US';
      }
      utterance.rate = clampedRate;
      utterance.pitch = clampedPitch;
      utterance.volume = volume;
      utterance.onend = () => {
        if (session === speechSessionId) {
          speakChunkAt(idx + 1);
        }
      };
      utterance.onerror = () => {
        // Ignore canceled/interrupted/unavailable speech errors cleanly in headless contexts
      };
      synth.speak(utterance);
    };

    speakChunkAt(0);
    return { ok: true, voiceUsed: chosenVoice?.name || 'System Default' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'SpeechSynthesis failed.',
    };
  }
}

export function startAmbientBed(bpm: number, volumeDb: number): () => void {
  if (ambientStopFn) {
    ambientStopFn();
    ambientStopFn = null;
  }

  const ctx = getAudioContext();
  if (!ctx) return () => undefined;

  try {
    const masterGain = ctx.createGain();
    // Subtle warm pad kept well underneath spoken voiceover
    const linearGain = Math.min(0.055, Math.max(0.006, Math.pow(10, volumeDb / 20) * 0.22));
    masterGain.gain.value = linearGain;
    masterGain.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;

    osc1.type = 'sine';
    osc1.frequency.value = 98;
    osc2.type = 'sine';
    osc2.frequency.value = 146.83;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(masterGain);

    osc1.start();
    osc2.start();

    const pulseMs = Math.max(400, Math.round((60 / Math.max(60, bpm)) * 1000));
    let step = 0;
    const notes = [98, 110, 130.81, 123.47];
    const timer = window.setInterval(() => {
      if (!audioCtx) return;
      step = (step + 1) % notes.length;
      osc1.frequency.setTargetAtTime(notes[step], audioCtx.currentTime, 0.35);
    }, pulseMs * 4);

    const stop = () => {
      window.clearInterval(timer);
      try {
        osc1.stop();
        osc2.stop();
        masterGain.disconnect();
      } catch {
        // Ignore already stopped oscillators
      }
    };
    ambientStopFn = stop;
    return stop;
  } catch {
    return () => undefined;
  }
}
