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

export async function exportCanvasWithAudioWebm(params: {
  canvas: HTMLCanvasElement;
  voiceBlob?: Blob;
  durationSec: number;
}): Promise<Blob> {
  if (typeof MediaRecorder === 'undefined' || typeof params.canvas.captureStream !== 'function') {
    throw new Error('Video export via MediaRecorder is not supported in this browser.');
  }

  const canvasStream = params.canvas.captureStream(30);
  const combinedTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

  let audioCtx: AudioContext | null = null;
  let audioSource: AudioBufferSourceNode | null = null;
  let renderDurationMs = Math.min(Math.max(2500, params.durationSec * 1000), 6000);

  if (params.voiceBlob) {
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
        audioSource.connect(dest);
        combinedTracks.push(...dest.stream.getAudioTracks());
        renderDurationMs = Math.min(Math.max(2000, Math.ceil(decoded.duration * 1000) + 250), 8000);
      } catch {
        // Fall back to video-only stream if audio decode fails
      }
    }
  }

  const stream = new MediaStream(combinedTracks);
  const mimeCandidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const selectedMime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));
  const recorder = selectedMime
    ? new MediaRecorder(stream, { mimeType: selectedMime })
    : new MediaRecorder(stream);

  const chunks: Blob[] = [];
  const resultPromise = new Promise<Blob>((resolve, reject) => {
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
        resolve(out);
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
