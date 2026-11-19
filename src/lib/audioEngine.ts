// Studio audio preview, timeline voiceover playback, Web Audio ambient bed & unlocked fallback

let activeAudioEl: HTMLAudioElement | null = null;
let activeBufferSource: AudioBufferSourceNode | null = null;
let activeBufferGain: GainNode | null = null;
let audioCtx: AudioContext | null = null;
let ambientStopFn: (() => void) | null = null;

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
  } catch {
    // Ignore environments without Web Audio / HTMLAudioElement
  }
}

export function stopVoiceAudio(): void {
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
  startOffsetSec: number
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
    source.connect(gain);
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
  volume = 0.85,
  startOffsetSec = 0
): Promise<{ ok: boolean; error?: string }> {
  stopVoiceAudio();
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
    const fallbackOk = await playViaAudioContext(url, volume, startOffsetSec);
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

export function startAmbientBed(bpm: number, volumeDb: number): () => void {
  if (ambientStopFn) {
    ambientStopFn();
    ambientStopFn = null;
  }

  const ctx = getAudioContext();
  if (!ctx) return () => undefined;

  try {
    const masterGain = ctx.createGain();
    const linearGain = Math.min(0.18, Math.max(0.01, Math.pow(10, volumeDb / 20) * 0.45));
    masterGain.gain.value = linearGain;
    masterGain.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;

    osc1.type = 'sine';
    osc1.frequency.value = 110;
    osc2.type = 'triangle';
    osc2.frequency.value = 164.81;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(masterGain);

    osc1.start();
    osc2.start();

    const pulseMs = Math.max(250, Math.round((60 / Math.max(60, bpm)) * 1000));
    let step = 0;
    const notes = [110, 130.81, 146.83, 164.81];
    const timer = window.setInterval(() => {
      if (!audioCtx) return;
      step = (step + 1) % notes.length;
      osc1.frequency.setTargetAtTime(notes[step], audioCtx.currentTime, 0.12);
    }, pulseMs * 2);

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
