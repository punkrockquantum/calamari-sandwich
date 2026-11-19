// Lightweight studio audio preview, timeline voiceover playback & Web Audio ambient bed synthesizer

let activeAudioEl: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;
let ambientStopFn: (() => void) | null = null;

export function stopVoiceAudio() {
  if (activeAudioEl) {
    activeAudioEl.pause();
    activeAudioEl.src = '';
    activeAudioEl = null;
  }
}

export function stopAllAudio() {
  stopVoiceAudio();
  if (ambientStopFn) {
    ambientStopFn();
    ambientStopFn = null;
  }
}

export async function playVoiceBlobUrl(
  url: string,
  volume = 0.85,
  startOffsetSec = 0
): Promise<void> {
  stopVoiceAudio();
  const audio = new Audio(url);
  audio.volume = Math.max(0, Math.min(1, volume));
  activeAudioEl = audio;
  if (startOffsetSec > 0.25) {
    audio.addEventListener(
      'loadedmetadata',
      () => {
        if (Number.isFinite(audio.duration) && startOffsetSec < audio.duration - 0.15) {
          audio.currentTime = startOffsetSec;
        }
      },
      { once: true }
    );
  }
  await audio.play().catch(() => {
    // Ignore autoplay blocks when user hasn't interacted yet
  });
}

export function startAmbientBed(bpm: number, volumeDb: number): () => void {
  if (ambientStopFn) {
    ambientStopFn();
    ambientStopFn = null;
  }

  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return () => undefined;

  try {
    if (!audioCtx) {
      audioCtx = new AudioContextCtor();
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }

    const masterGain = audioCtx.createGain();
    const linearGain = Math.min(0.18, Math.max(0.01, Math.pow(10, volumeDb / 20) * 0.45));
    masterGain.gain.value = linearGain;
    masterGain.connect(audioCtx.destination);

    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
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
