export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function sanitizeFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'calamari-export'
  );
}

export function extensionForAudioMime(contentType: string): string {
  const lower = contentType.toLowerCase();
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  if (lower.includes('webm')) return 'webm';
  if (lower.includes('ogg') || lower.includes('opus')) return 'ogg';
  if (lower.includes('mp4') || lower.includes('m4a') || lower.includes('aac')) return 'm4a';
  return 'wav';
}

export async function exportCanvasWithAudioWebm(params: {
  canvas: HTMLCanvasElement;
  voiceBlob?: Blob;
  durationSec: number;
  voiceTraits?: { warmth?: number; brightness?: number; dspShaped?: boolean };
}): Promise<{ blob: Blob; hasAudioTrack: boolean }> {
  if (typeof MediaRecorder === 'undefined' || typeof params.canvas.captureStream !== 'function') {
    throw new Error('Video export via MediaRecorder is not supported in this browser.');
  }

  const canvasStream = params.canvas.captureStream(30);
  const combinedTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

  let audioCtx: AudioContext | null = null;
  let audioSource: AudioBufferSourceNode | null = null;
  let hasAudioTrack = false;
  // When no real audio blob is provided (browser SpeechSynthesis mode), export a crisp animated clip
  let renderDurationMs = Math.min(Math.max(3000, params.durationSec * 1000), 8000);

  if (params.voiceBlob && params.voiceBlob.size > 0) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      try {
        audioCtx = new AudioCtx();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        const arr = await params.voiceBlob.arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(arr);
        const dest = audioCtx.createMediaStreamDestination();
        audioSource = audioCtx.createBufferSource();
        audioSource.buffer = decoded;

        let tailNode: AudioNode = audioSource;
        const warmth = params.voiceTraits?.warmth;
        const brightness = params.voiceTraits?.brightness;
        if (!params.voiceTraits?.dspShaped && typeof warmth === 'number' && Math.abs(warmth - 55) > 5) {
          const lowShelf = audioCtx.createBiquadFilter();
          lowShelf.type = 'lowshelf';
          lowShelf.frequency.value = 220;
          lowShelf.gain.value = ((warmth - 55) / 45) * 4.2;
          tailNode.connect(lowShelf);
          tailNode = lowShelf;
        }
        if (!params.voiceTraits?.dspShaped && typeof brightness === 'number' && Math.abs(brightness - 50) > 5) {
          const highShelf = audioCtx.createBiquadFilter();
          highShelf.type = 'highshelf';
          highShelf.frequency.value = 3200;
          highShelf.gain.value = ((brightness - 50) / 50) * 3.8;
          tailNode.connect(highShelf);
          tailNode = highShelf;
        }
        tailNode.connect(dest);

        combinedTracks.push(...dest.stream.getAudioTracks());
        hasAudioTrack = dest.stream.getAudioTracks().length > 0;
        // Preserve full spoken audio up to 45s instead of truncating mid-sentence
        renderDurationMs = Math.min(Math.max(2500, Math.ceil(decoded.duration * 1000) + 350), 45000);
      } catch {
        // Export video cleanly without synthesizing robotic fallback audio
        hasAudioTrack = false;
      }
    }
  }

  const stream = new MediaStream(combinedTracks);
  const mimeCandidates = hasAudioTrack
    ? [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ]
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const selectedMime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));
  const recorder = selectedMime
    ? new MediaRecorder(stream, { mimeType: selectedMime })
    : new MediaRecorder(stream);

  const chunks: Blob[] = [];
  const resultPromise = new Promise<{ blob: Blob; hasAudioTrack: boolean }>((resolve, reject) => {
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };
    recorder.onerror = () => reject(new Error('MediaRecorder failed during video export.'));
    recorder.onstop = () => {
      if (audioSource) {
        try {
          audioSource.stop();
        } catch {
          // Ignore
        }
      }
      if (audioCtx) {
        void audioCtx.close().catch(() => undefined);
      }
      const out = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      if (out.size === 0) {
        reject(new Error('Exported video buffer was empty.'));
      } else {
        resolve({ blob: out, hasAudioTrack });
      }
    };
  });

  recorder.start(200);
  if (audioSource) {
    audioSource.start(0);
  }

  window.setTimeout(() => {
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
  }, renderDurationMs);

  return resultPromise;
}
