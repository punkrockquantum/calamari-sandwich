import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  ChapterItem,
  CharacterProfile,
  CinematicStyle,
  ExplainerProject,
  HiggsfieldJobState,
  SceneItem,
  TechAsset,
} from '@shared/types';
import { studioApi } from '@/lib/api';

interface PreviewPlayerProps {
  project: ExplainerProject;
  assets: TechAsset[];
  currentTimeSec: number;
  seekEpoch?: number;
  isPlaying: boolean;
  isMuted: boolean;
  activeSceneId: string;
  activeVoiceSource?: 'elevenlabs' | 'native' | 'mock' | null;
  activeVoiceMode?: 'elevenlabs' | 'direct-sample' | 'system-speech' | null;
  exportingVideo?: boolean;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onSeek: (sec: number) => void;
  onSelectScene: (sceneId: string) => void;
  onSpeakActiveScene: () => void;
  onDownloadSceneAudio?: (scene: SceneItem) => void;
  onExportSceneVideo?: (params: {
    canvas: HTMLCanvasElement | null;
    scene: SceneItem;
    stageVideoUrl: string | null;
  }) => void;
}

interface StylePalette {
  bgTop: string;
  bgBottom: string;
  accent: string;
  secondary: string;
  grid: string;
}

const STYLE_PALETTES: Record<CinematicStyle, StylePalette> = {
  'Neon Lab': {
    bgTop: '#071024',
    bgBottom: '#130b29',
    accent: '#22d3ee',
    secondary: '#a855f7',
    grid: 'rgba(34, 211, 238, 0.10)',
  },
  'Anamorphic Studio': {
    bgTop: '#0d101b',
    bgBottom: '#181424',
    accent: '#6366f1',
    secondary: '#38bdf8',
    grid: 'rgba(99, 102, 241, 0.10)',
  },
  'Blueprint Isometric': {
    bgTop: '#061a2e',
    bgBottom: '#082542',
    accent: '#38bdf8',
    secondary: '#34d399',
    grid: 'rgba(56, 189, 248, 0.15)',
  },
  'Editorial Documentary': {
    bgTop: '#141210',
    bgBottom: '#221c18',
    accent: '#f59e0b',
    secondary: '#fb7185',
    grid: 'rgba(245, 158, 11, 0.09)',
  },
  'Quantum Noir': {
    bgTop: '#09090d',
    bgBottom: '#180d1e',
    accent: '#ec4899',
    secondary: '#818cf8',
    grid: 'rgba(236, 72, 153, 0.10)',
  },
};

function formatTimecode(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
}

function pickActiveExternalJob(scene?: SceneItem): HiggsfieldJobState | undefined {
  if (!scene) return undefined;
  if (scene.activeVideoProvider === 'gemini_veo' && scene.veo) return scene.veo;
  if (scene.activeVideoProvider === 'higgsfield') return scene.higgsfield;
  if (scene.veo?.status === 'ready' && scene.veo.videoUrl) return scene.veo;
  if (scene.higgsfield.status === 'ready' && scene.higgsfield.videoUrl) return scene.higgsfield;
  if (scene.veo && (scene.veo.status === 'queued' || scene.veo.status === 'generating')) {
    return scene.veo;
  }
  return scene.higgsfield;
}

function splitSubtitleSegments(narration: string): string[] {
  const sentences = narration
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const segments: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= 125) {
      segments.push(sentence);
      continue;
    }
    const words = sentence.split(' ');
    let current = '';
    for (const word of words) {
      if ((current ? `${current} ${word}` : word).length > 110) {
        if (current) segments.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) segments.push(current);
  }
  return segments.length > 0 ? segments : [narration];
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 2
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = w;
      if (lines.length >= maxLines) break;
    } else {
      current = test;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

export function PreviewPlayer({
  project,
  assets,
  currentTimeSec,
  seekEpoch = 0,
  isPlaying,
  isMuted,
  activeSceneId,
  activeVoiceSource,
  activeVoiceMode,
  exportingVideo = false,
  onTogglePlay,
  onToggleMute,
  onSeek,
  onSelectScene,
  onSpeakActiveScene,
  onDownloadSceneAudio,
  onExportSceneVideo,
}: PreviewPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const animTimeRef = useRef<number>(0);
  const exportStartedAtRef = useRef<number | null>(null);
  const currentTimeSecRef = useRef<number>(currentTimeSec);
  currentTimeSecRef.current = currentTimeSec;
  const [failedVideoUrls, setFailedVideoUrls] = useState<string[]>([]);
  const [proxiedVideoKeys, setProxiedVideoKeys] = useState<string[]>([]);

  useEffect(() => {
    exportStartedAtRef.current = exportingVideo ? performance.now() : null;
  }, [exportingVideo]);

  const sceneOffsets = useMemo(() => {
    let acc = 0;
    return project.scenes.map((sc) => {
      const start = acc;
      acc += sc.durationSec;
      return { scene: sc, startSec: start, endSec: acc };
    });
  }, [project.scenes]);

  const totalDurationSec = sceneOffsets.length > 0 ? sceneOffsets[sceneOffsets.length - 1].endSec : 0;

  const activeEntry =
    sceneOffsets.find(
      (entry) => currentTimeSec >= entry.startSec && currentTimeSec < entry.endSec
    ) ||
    sceneOffsets.find((entry) => entry.scene.id === activeSceneId) ||
    sceneOffsets[0];

  const activeScene: SceneItem | undefined = activeEntry?.scene;
  const activeChapter: ChapterItem | undefined = project.chapters.find(
    (c) => c.id === activeScene?.chapterId
  );
  const activeCharacter: CharacterProfile | undefined = project.characters.find(
    (c) => c.id === activeScene?.characterId
  );

  const sceneAssets = useMemo(() => {
    if (!activeScene) return [];
    const ids = new Set([
      ...(activeScene.assetIds || []),
      ...(activeScene.ragContext || [])
        .filter((r) => r.sourceType === 'asset')
        .map((r) => r.id),
    ]);
    return assets.filter((a) => ids.has(a.id));
  }, [activeScene, assets]);

  const activeExternalJob = pickActiveExternalJob(activeScene);
  const rawExternalVideoUrl =
    activeExternalJob &&
    activeExternalJob.provider !== 'canvas-fallback' &&
    activeExternalJob.status === 'ready' &&
    activeExternalJob.videoUrl
      ? activeExternalJob.videoUrl
      : null;

  const externalJobKey =
    activeScene && activeExternalJob
      ? `${activeScene.id}:${activeExternalJob.provider}:${activeExternalJob.updatedAt}`
      : '';

  const needsProxy =
    Boolean(rawExternalVideoUrl) &&
    (rawExternalVideoUrl!.includes('googleapis.com') ||
      proxiedVideoKeys.includes(externalJobKey));

  const resolvedExternalVideoUrl =
    rawExternalVideoUrl && activeScene && activeExternalJob && activeExternalJob.provider !== 'canvas-fallback'
      ? needsProxy
        ? studioApi.getProviderVideoProxyUrl(
            project.id,
            activeScene.id,
            activeExternalJob.provider
          )
        : rawExternalVideoUrl
      : null;

  const externalVideoUrl =
    resolvedExternalVideoUrl && !failedVideoUrls.includes(resolvedExternalVideoUrl)
      ? resolvedExternalVideoUrl
      : null;

  const ragVideoAsset = sceneAssets.find(
    (a) => a.sourceType === 'video' && a.mediaUrls[0] && !failedVideoUrls.includes(a.mediaUrls[0])
  );
  const ragPhotoAsset = sceneAssets.find((a) => a.sourceType === 'photos' && a.mediaUrls[0]);

  const stageVideoUrl = externalVideoUrl || ragVideoAsset?.mediaUrls[0] || null;
  const stageVideoFailed =
    Boolean(resolvedExternalVideoUrl && failedVideoUrls.includes(resolvedExternalVideoUrl)) ||
    Boolean(
      !resolvedExternalVideoUrl &&
        sceneAssets.some(
          (a) => a.sourceType === 'video' && a.mediaUrls[0] && failedVideoUrls.includes(a.mediaUrls[0])
        )
    );
  const stageVideoLabel = externalVideoUrl
    ? activeExternalJob?.provider === 'gemini_veo'
      ? 'Gemini Veo Video'
      : 'Higgsfield Video'
    : ragVideoAsset
      ? `RAG Clip: ${ragVideoAsset.name}`
      : null;

  useEffect(() => {
    if (!externalJobKey) return;
    setFailedVideoUrls([]);
  }, [externalJobKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stageVideoUrl) return;
    video.muted = isMuted;
    if (isPlaying) {
      void video.play().catch(() => {
        // Ignore browser autoplay restrictions
      });
    } else {
      video.pause();
    }
  }, [stageVideoUrl, isPlaying, isMuted, activeScene?.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stageVideoUrl || !activeEntry) return;
    const localTime = Math.max(0, currentTimeSecRef.current - activeEntry.startSec);
    if (Number.isFinite(video.duration) && video.duration > 0) {
      try {
        video.currentTime = localTime % video.duration;
      } catch {
        // Ignore seek errors before metadata loads
      }
    }
  }, [stageVideoUrl, activeEntry?.scene.id, seekEpoch]);

  useEffect(() => {
    const urlsToPreload = [
      ...project.characters.flatMap((c) => (c.sourceType === 'photos' ? c.mediaUrls : [])),
      ...assets.flatMap((a) => (a.sourceType === 'photos' ? a.mediaUrls : [])),
    ];
    for (const url of urlsToPreload) {
      if (url && !imageCacheRef.current.has(url)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;
        imageCacheRef.current.set(url, img);
      }
    }
  }, [project.characters, assets]);

  // Continuous 60fps Canvas stage rendering with chapter cards, bullet reveals, diagrams, character/asset overlays & subtitles
  useEffect(() => {
    let rafId = 0;
    let lastTs = performance.now();

    const renderFrame = (now: number) => {
      const dt = (now - lastTs) / 1000;
      lastTs = now;
      animTimeRef.current += isPlaying || exportingVideo ? dt : dt * 0.35;

      const canvas = canvasRef.current;
      if (canvas && activeScene && activeEntry) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          const exportElapsed =
            exportingVideo && exportStartedAtRef.current !== null
              ? (now - exportStartedAtRef.current) / 1000
              : null;
          const localElapsed =
            exportElapsed !== null
              ? exportElapsed
              : Math.max(0, currentTimeSecRef.current - activeEntry.startSec);
          const progress = Math.min(1, localElapsed / Math.max(1, activeScene.durationSec));
          const t = animTimeRef.current;
          const palette = STYLE_PALETTES[activeScene.cinematicStyle] || STYLE_PALETTES['Neon Lab'];

          ctx.save();
          ctx.clearRect(0, 0, w, h);

          // Camera motion transform
          let zoom = 1;
          let panX = 0;
          let panY = 0;
          switch (activeScene.cameraMotion) {
            case 'Slow Dolly In':
              zoom = 1 + progress * 0.08;
              break;
            case 'Orbital Pan':
              zoom = 1.04;
              panX = Math.sin(t * 0.65) * 18;
              panY = Math.cos(t * 0.45) * 8;
              break;
            case 'Crane Pullback':
              zoom = 1.1 - progress * 0.09;
              panY = (1 - progress) * 12;
              break;
            case 'Handheld Micro':
              zoom = 1.03;
              panX = Math.sin(t * 3.1) * 3.5;
              panY = Math.cos(t * 2.7) * 2.5;
              break;
            case 'Rack Focus':
              zoom = 1.02 + Math.sin(progress * Math.PI) * 0.05;
              break;
            default:
              zoom = 1;
          }

          ctx.translate(w / 2 + panX, h / 2 + panY);
          ctx.scale(zoom, zoom);
          ctx.translate(-w / 2, -h / 2);

          // Background gradient
          const grad = ctx.createLinearGradient(0, 0, w, h);
          grad.addColorStop(0, palette.bgTop);
          grad.addColorStop(1, palette.bgBottom);
          ctx.fillStyle = grad;
          ctx.fillRect(-40, -40, w + 80, h + 80);

          // Studio grid
          ctx.strokeStyle = palette.grid;
          ctx.lineWidth = 1;
          const step = 48;
          for (let x = 0; x < w; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
          }
          for (let y = 0; y < h; y += step) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }

          // Ambient bokeh glow
          const glow = ctx.createRadialGradient(w * 0.38, h * 0.42, 20, w * 0.38, h * 0.42, 340);
          glow.addColorStop(0, `${palette.accent}33`);
          glow.addColorStop(1, 'transparent');
          ctx.fillStyle = glow;
          ctx.fillRect(0, 0, w, h);

          // Visual tech diagram / asset region
          const charLeft = activeScene.characterPlacement === 'left';
          const charOff = !activeCharacter || activeScene.characterPlacement === 'offscreen';
          const diagCenterX =
            activeScene.characterPlacement === 'center'
              ? w * 0.5
              : charOff
                ? w * 0.34
                : charLeft
                  ? w * 0.64
                  : w * 0.36;
          const diagCenterY = h * 0.44;

          const ragPhotoUrl = ragPhotoAsset?.mediaUrls[0];
          const ragPhotoImg = ragPhotoUrl ? imageCacheRef.current.get(ragPhotoUrl) : undefined;

          ctx.save();
          if (ragPhotoAsset && ragPhotoImg && ragPhotoImg.complete && ragPhotoImg.naturalWidth > 0) {
            const boxW = 410;
            const boxH = 228;
            const bx = diagCenterX - boxW / 2;
            const by = diagCenterY - boxH / 2 - 10;

            ctx.fillStyle = 'rgba(9, 12, 20, 0.92)';
            ctx.strokeStyle = `${palette.accent}99`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(bx - 4, by - 4, boxW + 8, boxH + 8, 14);
            ctx.fill();
            ctx.stroke();

            ctx.save();
            ctx.beginPath();
            ctx.roundRect(bx, by, boxW, boxH, 10);
            ctx.clip();
            const scale = Math.max(boxW / ragPhotoImg.width, boxH / ragPhotoImg.height);
            const dw = ragPhotoImg.width * scale;
            const dh = ragPhotoImg.height * scale;
            ctx.drawImage(ragPhotoImg, bx + (boxW - dw) / 2, by + (boxH - dh) / 2, dw, dh);
            ctx.restore();

            ctx.fillStyle = 'rgba(9, 9, 14, 0.88)';
            ctx.strokeStyle = `${palette.secondary}88`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(bx, by + boxH + 10, boxW, 38, 8);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = palette.accent;
            ctx.font = '600 11px Inter, system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`RAG ASSET • ${ragPhotoAsset.name}`, bx + 12, by + boxH + 25);

            ctx.fillStyle = '#cbd5e1';
            ctx.font = '10px ui-monospace, SFMono-Regular, monospace';
            const specLine = (ragPhotoAsset.technicalSpecs || ragPhotoAsset.description).slice(0, 60);
            ctx.fillText(specLine, bx + 12, by + boxH + 39);
          } else if (
            activeScene.visualOverlay === 'neural-graph' ||
            activeScene.visualOverlay === 'architecture-flow'
          ) {
            const nodes = [
              { x: diagCenterX - 170, y: diagCenterY - 68, label: 'Input' },
              { x: diagCenterX - 50, y: diagCenterY - 105, label: 'Encode' },
              { x: diagCenterX - 50, y: diagCenterY + 25, label: 'Route' },
              { x: diagCenterX + 75, y: diagCenterY - 40, label: 'Kernel' },
              { x: diagCenterX + 190, y: diagCenterY - 40, label: 'Output' },
            ];
            const edges = [
              [0, 1],
              [0, 2],
              [1, 3],
              [2, 3],
              [3, 4],
            ];

            edges.forEach(([a, b], idx) => {
              const na = nodes[a];
              const nb = nodes[b];
              ctx.strokeStyle = `${palette.accent}66`;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(na.x, na.y);
              ctx.lineTo(nb.x, nb.y);
              ctx.stroke();

              const p = (t * 0.65 + idx * 0.23) % 1;
              const px = na.x + (nb.x - na.x) * p;
              const py = na.y + (nb.y - na.y) * p;
              ctx.fillStyle = palette.secondary;
              ctx.beginPath();
              ctx.arc(px, py, 4.5, 0, Math.PI * 2);
              ctx.fill();
            });

            nodes.forEach((n, idx) => {
              const pulse = 1 + Math.sin(t * 2.4 + idx) * 0.07;
              ctx.fillStyle = '#0f172a';
              ctx.strokeStyle = idx === 3 ? palette.secondary : palette.accent;
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.roundRect(n.x - 38 * pulse, n.y - 19 * pulse, 76 * pulse, 38 * pulse, 10);
              ctx.fill();
              ctx.stroke();

              ctx.fillStyle = '#e2e8f0';
              ctx.font = '600 12px Inter, system-ui, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(n.label, n.x, n.y);
            });
          } else if (activeScene.visualOverlay === 'code-terminal') {
            const bx = diagCenterX - 195;
            const by = diagCenterY - 110;
            ctx.fillStyle = 'rgba(9, 12, 20, 0.88)';
            ctx.strokeStyle = `${palette.accent}88`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(bx, by, 390, 200, 12);
            ctx.fill();
            ctx.stroke();

            const lines = [
              `// ${activeScene.title}`,
              `const pipeline = createExplainerKernel({`,
              `  style: "${activeScene.cinematicStyle}",`,
              `  motion: "${activeScene.cameraMotion}",`,
              `  latencyBudgetMs: 14.2,`,
              `});`,
              `await pipeline.step(activeTensor);`,
            ];
            ctx.font = '12.5px ui-monospace, SFMono-Regular, monospace';
            ctx.textAlign = 'left';
            lines.forEach((line, i) => {
              const reveal = Math.min(1, Math.max(0.15, progress * 3.5 - i * 0.2));
              ctx.fillStyle = i === 0 ? palette.accent : i === 6 ? palette.secondary : '#cbd5e1';
              ctx.fillText(line.slice(0, Math.ceil(line.length * reveal)), bx + 16, by + 32 + i * 24);
            });
          } else if (activeScene.visualOverlay === 'packet-stream') {
            const bx = diagCenterX - 195;
            const by = diagCenterY - 102;
            ctx.fillStyle = 'rgba(9, 12, 20, 0.78)';
            ctx.strokeStyle = `${palette.accent}55`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(bx, by, 390, 188, 12);
            ctx.fill();
            ctx.stroke();

            for (let lane = 0; lane < 4; lane++) {
              const ly = by + 34 + lane * 40;
              ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(bx + 24, ly);
              ctx.lineTo(bx + 366, ly);
              ctx.stroke();

              for (let pkt = 0; pkt < 3; pkt++) {
                const pos = ((t * (0.45 + lane * 0.08) + pkt * 0.34) % 1);
                const px = bx + 26 + pos * 320;
                ctx.fillStyle = lane % 2 === 0 ? palette.accent : palette.secondary;
                ctx.beginPath();
                ctx.roundRect(px, ly - 8, 22, 16, 4);
                ctx.fill();
              }
            }
          } else {
            const barCount = 24;
            const totalW = 360;
            const startX = diagCenterX - totalW / 2;
            for (let i = 0; i < barCount; i++) {
              const amp = 0.25 + 0.75 * Math.abs(Math.sin(t * 2.8 + i * 0.42));
              const bh = amp * 124;
              ctx.fillStyle = i % 2 === 0 ? palette.accent : palette.secondary;
              ctx.globalAlpha = 0.8;
              ctx.beginPath();
              ctx.roundRect(startX + i * 15, diagCenterY + 50 - bh, 9, bh, 4);
              ctx.fill();
            }
            ctx.globalAlpha = 1;
          }
          ctx.restore();

          // Animated Bullet Reveals card (keyPoints) placed neatly above character or opposite side
          if (activeScene.keyPoints && activeScene.keyPoints.length > 0 && activeScene.characterPlacement !== 'center') {
            const bullets = activeScene.keyPoints.slice(0, 3);
            const cardW = 350;
            const cardH = 34 + bullets.length * 28;
            const cardX = charOff ? w - cardW - 24 : charLeft ? 24 : w - cardW - 24;
            const cardY = charOff ? h * 0.24 : 58;

            ctx.save();
            ctx.fillStyle = 'rgba(9, 12, 22, 0.84)';
            ctx.strokeStyle = `${palette.accent}66`;
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.roundRect(cardX, cardY, cardW, cardH, 10);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = palette.accent;
            ctx.font = '700 11.5px Inter, system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('KEY TAKEAWAYS', cardX + 14, cardY + 20);

            bullets.forEach((pt, idx) => {
              const revealAt = idx * 0.16;
              const alpha = Math.min(1, Math.max(0.32, (progress + 0.18 - revealAt) * 4));
              const slideX = (1 - alpha) * 12;
              ctx.globalAlpha = alpha;
              ctx.fillStyle = palette.secondary;
              ctx.beginPath();
              ctx.arc(cardX + 18 + slideX, cardY + 42 + idx * 27, 3.5, 0, Math.PI * 2);
              ctx.fill();

              ctx.fillStyle = '#f1f5f9';
              ctx.font = '500 13px Inter, system-ui, sans-serif';
              const trimmed = pt.length > 42 ? `${pt.slice(0, 39)}...` : pt;
              ctx.fillText(trimmed, cardX + 29 + slideX, cardY + 46 + idx * 27);
            });
            ctx.restore();
          }

          // Render cloned character on stage if not offscreen
          if (activeCharacter && activeScene.characterPlacement !== 'offscreen') {
            const cx =
              activeScene.characterPlacement === 'left'
                ? w * 0.19
                : activeScene.characterPlacement === 'center'
                  ? w * 0.5
                  : activeScene.characterPlacement === 'split'
                    ? w * 0.8
                    : w * 0.81;
            const cy = activeScene.characterPlacement === 'center' ? h * 0.5 : h * 0.57;
            const radius = activeScene.characterPlacement === 'center' ? 72 : 58;

            const speakAmp = isPlaying ? 1 + Math.abs(Math.sin(t * 7.5)) * 0.14 : 1.03;
            ctx.strokeStyle = activeCharacter.previewColor;
            ctx.lineWidth = 3;
            ctx.globalAlpha = isPlaying ? 0.55 : 0.25;
            ctx.beginPath();
            ctx.arc(cx, cy, (radius + 12) * speakAmp, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;

            const photoUrl = activeCharacter.mediaUrls[0];
            const cachedImg = photoUrl ? imageCacheRef.current.get(photoUrl) : undefined;

            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.clip();

            if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
              const scale = Math.max((radius * 2) / cachedImg.width, (radius * 2) / cachedImg.height);
              const dw = cachedImg.width * scale;
              const dh = cachedImg.height * scale;
              ctx.drawImage(cachedImg, cx - dw / 2, cy - dh / 2, dw, dh);
            } else {
              const avatarGrad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
              avatarGrad.addColorStop(0, activeCharacter.previewColor);
              avatarGrad.addColorStop(1, '#1e1b4b');
              ctx.fillStyle = avatarGrad;
              ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

              ctx.fillStyle = 'rgba(255,255,255,0.92)';
              ctx.beginPath();
              ctx.arc(cx, cy - 12, 21, 0, Math.PI * 2);
              ctx.fill();
              ctx.beginPath();
              ctx.arc(cx, cy + 50, 42, Math.PI, 0);
              ctx.fill();
            }
            ctx.restore();

            ctx.strokeStyle = activeCharacter.traits.accentColor || palette.accent;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = 'rgba(9, 9, 13, 0.85)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(cx - 84, cy + radius + 12, 168, 36, 8);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#f8fafc';
            ctx.font = '600 11.5px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(activeCharacter.name, cx, cy + radius + 27);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '9.5px Inter, system-ui, sans-serif';
            ctx.fillText(activeCharacter.stylePreset, cx, cy + radius + 40);
          }

          ctx.restore();

          // Scene Transitions (0..0.7s)
          if (localElapsed < 0.7) {
            const p = localElapsed / 0.7;
            const alpha = 1 - p;
            if (activeScene.transitionIn === 'Glitch Cut') {
              ctx.fillStyle = palette.accent;
              ctx.globalAlpha = alpha * 0.35;
              ctx.fillRect(0, (t * 900) % h, w, 18);
              ctx.globalAlpha = 1;
            } else if (activeScene.transitionIn === 'Iris Wipe') {
              ctx.save();
              ctx.fillStyle = '#050509';
              ctx.beginPath();
              ctx.rect(0, 0, w, h);
              ctx.arc(w / 2, h / 2, Math.max(20, p * w * 0.72), 0, Math.PI * 2, true);
              ctx.fill();
              ctx.restore();
            } else if (activeScene.transitionIn === 'Whip Pan') {
              ctx.fillStyle = 'rgba(9, 12, 24, 0.72)';
              ctx.globalAlpha = alpha * 0.75;
              ctx.fillRect(0, 0, w * alpha, h);
              ctx.globalAlpha = 1;
            } else {
              ctx.fillStyle = activeScene.transitionIn === 'Match Cut' ? palette.accent : '#050509';
              ctx.globalAlpha = alpha * (activeScene.transitionIn === 'Match Cut' ? 0.25 : 0.65);
              ctx.fillRect(0, 0, w, h);
              ctx.globalAlpha = 1;
            }
          }

          // Top Chapter Card Badge
          ctx.fillStyle = 'rgba(9, 9, 13, 0.82)';
          ctx.beginPath();
          ctx.roundRect(18, 14, 460, 34, 8);
          ctx.fill();
          ctx.fillStyle = palette.accent;
          ctx.font = '600 13px Inter, system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(
            `${activeChapter?.title || 'Chapter'}  •  ${activeScene.title}`,
            30,
            36
          );

          // Live Timed Narration Subtitles (2-line wrapped)
          const segments = splitSubtitleSegments(activeScene.narration);
          const segIndex = Math.min(
            segments.length - 1,
            Math.floor(progress * segments.length)
          );
          const activeSubtitle = segments[segIndex] || activeScene.narration;

          ctx.fillStyle = 'rgba(9, 9, 13, 0.86)';
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(36, h - 84, w - 72, 64, 10);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#f4f4f5';
          ctx.font = '500 16px Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          const lines = wrapCanvasText(ctx, activeSubtitle, w - 120, 2);
          if (lines.length === 1) {
            ctx.fillText(lines[0], w / 2, h - 46);
          } else {
            ctx.fillText(lines[0], w / 2, h - 56);
            ctx.fillText(lines[1], w / 2, h - 34);
          }
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [activeScene, activeEntry, activeChapter, activeCharacter, ragPhotoAsset, isPlaying, exportingVideo]);

  const activeIndex = sceneOffsets.findIndex((e) => e.scene.id === activeScene?.id);

  const jumpToSceneOffset = (delta: number) => {
    const nextIdx = Math.max(0, Math.min(sceneOffsets.length - 1, activeIndex + delta));
    const target = sceneOffsets[nextIdx];
    if (target) {
      onSeek(target.startSec);
      onSelectScene(target.scene.id);
    }
  };

  const isExternalPolling =
    activeExternalJob?.status === 'queued' || activeExternalJob?.status === 'generating';

  const voiceBadgeLabel =
    activeVoiceMode === 'direct-sample'
      ? 'Direct Clip VO'
      : activeVoiceSource === 'elevenlabs'
        ? 'ElevenLabs VO'
        : activeVoiceSource === 'native'
          ? 'System Speech (Native)'
          : 'System Speech VO';

  return (
    <div className="shrink-0 flex flex-col bg-[#0d0d14] border border-zinc-800/90 rounded-xl overflow-hidden shadow-2xl">
      {/* Stage Header */}
      <div className="px-3.5 py-2 border-b border-zinc-800/80 flex items-center justify-between gap-2 bg-zinc-950/60">
        <div className="flex items-center gap-2 min-w-0">
          <Film className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="text-xs font-medium text-zinc-200 truncate">
            {activeScene?.title || 'Studio Preview'}
          </span>
          {activeScene && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-zinc-900 border border-zinc-800 px-2 py-0.5 text-[10px] text-cyan-300">
              <Camera className="w-2.5 h-2.5" />
              {activeScene.cameraMotion}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {activeVoiceSource && (
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full border ${
                activeVoiceSource === 'elevenlabs'
                  ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                  : activeVoiceMode === 'direct-sample'
                    ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                    : 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
              }`}
            >
              {voiceBadgeLabel}
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${
              stageVideoUrl
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : isExternalPolling
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
            }`}
          >
            {isExternalPolling && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
            {stageVideoLabel ||
              (isExternalPolling
                ? `${activeExternalJob?.provider === 'gemini_veo' ? 'Gemini Veo' : 'Higgsfield'} ${activeExternalJob?.status}...`
                : 'Canvas Stage Native')}
          </span>
          <button
            type="button"
            onClick={onSpeakActiveScene}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 px-2 py-1 text-[11px] text-zinc-200 transition"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            Preview Voice
          </button>
        </div>
      </div>

      {/* 16:9 Stage */}
      <div className="relative bg-[#06060a] py-2 px-3 flex items-center justify-center">
        <div className="relative w-full max-w-[460px] aspect-video rounded-lg overflow-hidden border border-zinc-800/70 shadow-lg bg-black">
          <canvas
            ref={canvasRef}
            width={960}
            height={540}
            className={`w-full h-full block ${stageVideoUrl ? 'hidden' : ''}`}
          />
          {stageVideoUrl && (
            <>
              <video
                ref={videoRef}
                key={stageVideoUrl}
                src={stageVideoUrl}
                playsInline
                loop
                controls
                muted={isMuted}
                onError={() => {
                  if (
                    rawExternalVideoUrl &&
                    !needsProxy &&
                    externalJobKey &&
                    !proxiedVideoKeys.includes(externalJobKey)
                  ) {
                    setProxiedVideoKeys((prev) => [...prev, externalJobKey]);
                  } else {
                    setFailedVideoUrls((prev) =>
                      prev.includes(stageVideoUrl) ? prev : [...prev, stageVideoUrl]
                    );
                  }
                }}
                className="w-full h-full object-cover block"
              />
              <div className="pointer-events-none absolute top-2.5 left-2.5 rounded-md bg-black/70 border border-white/10 px-2 py-1 text-[10px] font-medium text-cyan-300">
                {activeChapter?.title || 'Chapter'} • {ragVideoAsset ? ragVideoAsset.technicalSpecs || ragVideoAsset.name : activeScene?.cameraMotion}
              </div>
              {activeScene?.narration && (
                <div className="pointer-events-none absolute bottom-2.5 left-4 right-4 rounded-lg bg-black/75 border border-white/10 px-3 py-1.5 text-center text-[11px] text-zinc-100 line-clamp-2">
                  {activeScene.narration}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Transport & Scrubber */}
      <div className="px-3.5 py-2.5 bg-zinc-950/90 border-t border-zinc-800/80 flex flex-col gap-2">
        <div
          className="relative h-2 bg-zinc-800 rounded-full cursor-pointer group"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            onSeek(ratio * totalDurationSec);
          }}
        >
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-500 to-cyan-400 rounded-full"
            style={{
              width: `${totalDurationSec > 0 ? (currentTimeSec / totalDurationSec) * 100 : 0}%`,
            }}
          />
          {sceneOffsets.slice(1).map((entry) => (
            <div
              key={entry.scene.id}
              title={entry.scene.title}
              className="absolute top-0 bottom-0 w-px bg-zinc-950/80"
              style={{
                left: `${totalDurationSec > 0 ? (entry.startSec / totalDurationSec) * 100 : 0}%`,
              }}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => jumpToSceneOffset(-1)}
              disabled={activeIndex <= 0}
              className="p-1.5 rounded-lg text-zinc-300 hover:bg-zinc-800 disabled:opacity-30 transition"
              title="Previous Scene"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onTogglePlay}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white transition"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              onClick={() => jumpToSceneOffset(1)}
              disabled={activeIndex >= sceneOffsets.length - 1}
              className="p-1.5 rounded-lg text-zinc-300 hover:bg-zinc-800 disabled:opacity-30 transition"
              title="Next Scene"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <span className="ml-2 font-mono text-xs text-zinc-300">
              {formatTimecode(currentTimeSec)}{' '}
              <span className="text-zinc-600">/ {formatTimecode(totalDurationSec)}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {stageVideoFailed && (
              <button
                type="button"
                onClick={() => {
                  setFailedVideoUrls([]);
                  setProxiedVideoKeys([]);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200 hover:bg-amber-500/20"
                title="External video failed to load; fell back to Canvas Stage. Click to retry."
              >
                <AlertCircle className="w-3 h-3" />
                Retry Video
                <RotateCcw className="w-2.5 h-2.5" />
              </button>
            )}
            {activeScene && onDownloadSceneAudio && (
              <button
                type="button"
                onClick={() => onDownloadSceneAudio(activeScene)}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-700/80 bg-zinc-900 hover:bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 transition"
                title="Download scene voiceover audio (when server WAV/ElevenLabs/clip is available)"
              >
                <Download className="w-3 h-3 text-amber-400" />
                <span className="hidden sm:inline">Audio</span>
              </button>
            )}
            {activeScene && onExportSceneVideo && (
              <button
                type="button"
                disabled={exportingVideo}
                onClick={() =>
                  onExportSceneVideo({
                    canvas: canvasRef.current,
                    scene: activeScene,
                    stageVideoUrl,
                  })
                }
                className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-50 px-2 py-1 text-[11px] text-cyan-200 transition"
                title="Export rendered scene video (.webm)"
              >
                {exportingVideo ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Download className="w-3 h-3" />
                )}
                <span className="hidden sm:inline">
                  {exportingVideo ? 'Exporting...' : 'Export Video'}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={onToggleMute}
              className="p-1.5 rounded-lg text-zinc-300 hover:bg-zinc-800 transition"
              title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
