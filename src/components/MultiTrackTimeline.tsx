import { useMemo, useState } from 'react';
import { Film, Mic, Music, User, ZoomIn, ZoomOut } from 'lucide-react';
import type { ExplainerProject } from '@shared/types';

interface MultiTrackTimelineProps {
  project: ExplainerProject;
  currentTimeSec: number;
  activeSceneId: string;
  onSelectScene: (sceneId: string, startSec: number) => void;
  onSeek: (sec: number) => void;
}

export function MultiTrackTimeline({
  project,
  currentTimeSec,
  activeSceneId,
  onSelectScene,
  onSeek,
}: MultiTrackTimelineProps) {
  const [pxPerSec, setPxPerSec] = useState<number>(4.5);

  const sceneEntries = useMemo(() => {
    let cursor = 0;
    return project.scenes.map((sc) => {
      const start = cursor;
      cursor += sc.durationSec;
      return { scene: sc, startSec: start, endSec: cursor };
    });
  }, [project.scenes]);

  const totalSec = Math.max(
    60,
    sceneEntries.length > 0 ? sceneEntries[sceneEntries.length - 1].endSec : 120
  );
  const trackWidthPx = Math.max(720, Math.round(totalSec * pxPerSec));

  const tickInterval = totalSec > 900 ? 120 : totalSec > 360 ? 60 : 30;
  const ticks: number[] = [];
  for (let s = 0; s <= totalSec; s += tickInterval) {
    ticks.push(s);
  }

  const formatShort = (s: number) => {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem.toString().padStart(2, '0')}`;
  };

  return (
    <section className="bg-[#0d0d14] border border-zinc-800/90 rounded-xl overflow-hidden flex flex-col shrink-0">
      {/* Timeline Header */}
      <div className="px-3.5 py-2 border-b border-zinc-800/80 bg-zinc-950/70 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Multi-Track Timeline
          </span>
          <span className="text-[11px] text-zinc-500">
            4 Tracks • {project.scenes.length} Scenes • {project.musicTracks.length} Audio Beds
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPxPerSec((z) => Math.max(1.5, z - 1))}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <input
            aria-label="Timeline zoom"
            type="range"
            min={1.5}
            max={12}
            step={0.5}
            value={pxPerSec}
            onChange={(e) => setPxPerSec(Number(e.target.value))}
            className="w-20 accent-indigo-500"
          />
          <button
            type="button"
            onClick={() => setPxPerSec((z) => Math.min(12, z + 1))}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable Tracks */}
      <div className="flex overflow-x-auto">
        {/* Track Labels */}
        <div className="w-32 shrink-0 border-r border-zinc-800/80 bg-zinc-950/90 z-10">
          <div className="h-7 border-b border-zinc-800/80 px-3 flex items-center text-[10px] font-mono text-zinc-500">
            TIMECODE
          </div>
          <div className="h-12 border-b border-zinc-800/60 px-3 flex items-center gap-2 text-xs font-medium text-indigo-300">
            <Film className="w-3.5 h-3.5 shrink-0" /> Scenes
          </div>
          <div className="h-10 border-b border-zinc-800/60 px-3 flex items-center gap-2 text-xs font-medium text-cyan-300">
            <User className="w-3.5 h-3.5 shrink-0" /> Characters
          </div>
          <div className="h-10 border-b border-zinc-800/60 px-3 flex items-center gap-2 text-xs font-medium text-amber-300">
            <Mic className="w-3.5 h-3.5 shrink-0" /> Voiceover
          </div>
          <div className="h-10 px-3 flex items-center gap-2 text-xs font-medium text-emerald-300">
            <Music className="w-3.5 h-3.5 shrink-0" /> Music
          </div>
        </div>

        {/* Track Lanes */}
        <div className="relative flex-1 min-w-0" style={{ width: `${trackWidthPx}px` }}>
          {/* Ruler */}
          <div
            className="h-7 border-b border-zinc-800/80 bg-zinc-950/50 relative cursor-pointer"
            style={{ width: `${trackWidthPx}px` }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const sec = Math.max(0, Math.min(totalSec, (e.clientX - rect.left) / pxPerSec));
              onSeek(sec);
            }}
          >
            {ticks.map((s) => (
              <div
                key={s}
                className="absolute top-0 bottom-0 border-l border-zinc-800 pl-1 text-[10px] font-mono text-zinc-500 flex items-center"
                style={{ left: `${s * pxPerSec}px` }}
              >
                {formatShort(s)}
              </div>
            ))}
          </div>

          {/* Track 1: Scenes */}
          <div
            className="h-12 border-b border-zinc-800/60 relative flex items-center px-0.5"
            style={{ width: `${trackWidthPx}px` }}
          >
            {sceneEntries.map(({ scene, startSec }) => {
              const isSelected = scene.id === activeSceneId;
              const width = Math.max(46, scene.durationSec * pxPerSec - 2);
              return (
                <button
                  key={scene.id}
                  type="button"
                  onClick={() => onSelectScene(scene.id, startSec)}
                  style={{ left: `${startSec * pxPerSec}px`, width: `${width}px` }}
                  className={`absolute h-9 rounded-md px-2 text-left transition overflow-hidden border ${
                    isSelected
                      ? 'bg-indigo-600/35 border-indigo-400 text-white shadow-sm shadow-indigo-500/20'
                      : 'bg-indigo-950/50 border-indigo-800/60 text-zinc-200 hover:border-indigo-500/70'
                  }`}
                >
                  <div className="text-[11px] font-medium truncate">{scene.title}</div>
                  <div className="text-[9px] text-indigo-300/80 truncate">
                    {scene.cameraMotion} • {scene.durationSec}s
                  </div>
                </button>
              );
            })}
          </div>

          {/* Track 2: Characters */}
          <div
            className="h-10 border-b border-zinc-800/60 relative flex items-center"
            style={{ width: `${trackWidthPx}px` }}
          >
            {sceneEntries.map(({ scene, startSec }) => {
              const char = project.characters.find((c) => c.id === scene.characterId);
              if (!char || scene.characterPlacement === 'offscreen') return null;
              const width = Math.max(40, scene.durationSec * pxPerSec - 2);
              return (
                <button
                  key={`char-${scene.id}`}
                  type="button"
                  onClick={() => onSelectScene(scene.id, startSec)}
                  style={{
                    left: `${startSec * pxPerSec}px`,
                    width: `${width}px`,
                    borderColor: `${char.previewColor}66`,
                    backgroundColor: `${char.previewColor}22`,
                  }}
                  className="absolute h-7 rounded-md border px-2 text-left truncate"
                >
                  <span className="text-[10px] font-medium text-zinc-100">
                    {char.name} ({scene.characterPlacement})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Track 3: Voiceover */}
          <div
            className="h-10 border-b border-zinc-800/60 relative flex items-center"
            style={{ width: `${trackWidthPx}px` }}
          >
            {sceneEntries.map(({ scene, startSec }, idx) => {
              const width = Math.max(40, scene.durationSec * pxPerSec - 2);
              return (
                <button
                  key={`vo-${scene.id}`}
                  type="button"
                  onClick={() => onSelectScene(scene.id, startSec)}
                  style={{ left: `${startSec * pxPerSec}px`, width: `${width}px` }}
                  className="absolute h-7 rounded-md border border-amber-600/40 bg-amber-500/15 px-2 flex items-center justify-between gap-1 overflow-hidden"
                >
                  <span className="text-[10px] text-amber-200 truncate">
                    VO #{idx + 1}
                  </span>
                  <span className="flex items-end gap-0.5 h-3 shrink-0 opacity-70">
                    {[4, 9, 6, 11, 5, 8].map((bar, bi) => (
                      <span
                        key={bi}
                        className="w-0.5 bg-amber-400 rounded-full"
                        style={{ height: `${bar}px` }}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Track 4: Music */}
          <div
            className="h-10 relative flex items-center"
            style={{ width: `${trackWidthPx}px` }}
          >
            {project.musicTracks.map((track) => {
              const width = Math.max(56, track.durationSec * pxPerSec - 2);
              return (
                <div
                  key={track.id}
                  style={{
                    left: `${track.startTimeSec * pxPerSec}px`,
                    width: `${width}px`,
                    borderColor: `${track.accentColor}66`,
                    backgroundColor: `${track.accentColor}20`,
                  }}
                  className="absolute h-7 rounded-md border px-2 flex items-center justify-between gap-2 overflow-hidden"
                >
                  <span className="text-[10px] font-medium text-emerald-100 truncate">
                    {track.title}
                  </span>
                  <span className="text-[9px] font-mono text-emerald-300/80 shrink-0">
                    {track.bpm} BPM • {track.volumeDb}dB
                  </span>
                </div>
              );
            })}
          </div>

          {/* Global Playhead */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-rose-500 pointer-events-none z-20 shadow-[0_0_8px_rgba(244,63,94,0.8)]"
            style={{ left: `${currentTimeSec * pxPerSec}px` }}
          >
            <div className="w-2.5 h-2.5 -ml-1 bg-rose-500 rotate-45 rounded-[1px]" />
          </div>
        </div>
      </div>
    </section>
  );
}
