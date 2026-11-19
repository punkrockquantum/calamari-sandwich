import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Film,
  GripVertical,
  Mic,
  Music,
  Play,
  Trash2,
  User,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  CharacterPlacement,
  CharacterProfile,
  ExplainerProject,
  MusicTrack,
  SceneAnimationPreset,
  TimelineDragPayload,
  TimelineDropRequest,
  TimelineTrackKind,
  VoicePlaybackMode,
  VoiceProfile,
} from '@shared/types';

export interface SelectedTimelineBlock {
  track: TimelineTrackKind;
  id: string;
}

interface TimelineProps {
  project: ExplainerProject;
  voices: VoiceProfile[];
  allCharacters: CharacterProfile[];
  currentTimeSec: number;
  activeSceneId: string;
  selectedBlock: SelectedTimelineBlock | null;
  draggingPayload: TimelineDragPayload | null;
  onSelectBlock: (block: SelectedTimelineBlock | null, startSec?: number) => void;
  onSeek: (sec: number) => void;
  onUpdateScene: (sceneId: string, patch: Record<string, unknown>) => Promise<void>;
  onReorderScenes: (sceneIds: string[]) => Promise<void>;
  onDeleteScene: (sceneId: string) => Promise<void>;
  onUpdateMusicTrack: (trackId: string, patch: Partial<MusicTrack>) => Promise<void>;
  onDeleteMusicTrack: (trackId: string) => Promise<void>;
  onDropItem: (req: TimelineDropRequest) => Promise<void>;
  onPreviewVoice?: (voiceId: string, sampleText?: string, sceneId?: string) => Promise<void>;
}

const ANIMATION_PRESET_OPTIONS: { value: SceneAnimationPreset; label: string }[] = [
  { value: 'diagram-flow', label: 'Diagram Flow' },
  { value: 'kinetic-cards', label: 'Kinetic Cards' },
  { value: 'slide-deck-reveal', label: 'Slide Deck Reveal' },
  { value: 'data-pulse', label: 'Data Pulse' },
  { value: 'split-comparison', label: 'Split Comparison' },
  { value: 'timeline-walkthrough', label: 'Timeline Walkthrough' },
  { value: 'particle-network', label: 'Particle Network' },
];

const PLACEMENT_OPTIONS: { value: CharacterPlacement; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
  { value: 'split', label: 'Split' },
  { value: 'offscreen', label: 'Offscreen' },
];

interface NumericFieldProps {
  label: string;
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onCommit: (nextValue: number) => void;
}

function NumericField({
  label,
  ariaLabel,
  value,
  min,
  max,
  step = 1,
  unit = 's',
  onCommit,
}: NumericFieldProps) {
  const [draft, setDraft] = useState(String(Math.round(value)));

  useEffect(() => {
    setDraft(String(Math.round(value)));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(Math.round(value)));
      return;
    }
    const clamped = Math.max(min, Math.min(max, Math.round(parsed)));
    setDraft(String(clamped));
    if (clamped !== Math.round(value)) {
      onCommit(clamped);
    }
  };

  return (
    <label className="flex items-center gap-1 text-[10px] text-zinc-400">
      <span>{label}</span>
      <input
        type="number"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        className="w-14 rounded bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-[11px] font-mono text-zinc-100 focus:border-indigo-400 focus:outline-none"
      />
      {unit && <span className="text-zinc-500">{unit}</span>}
    </label>
  );
}

type PointerDragOp =
  | {
      kind: 'trim-left' | 'trim-right' | 'move';
      track: TimelineTrackKind;
      id: string;
      startClientX: number;
      origStartSec: number;
      origDurationSec: number;
      origTrimStartSec: number;
      moved: boolean;
    };

function isPayloadCompatible(track: TimelineTrackKind, payload: TimelineDragPayload | null): boolean {
  if (!payload) return true;
  switch (payload.kind) {
    case 'asset':
      return track === 'scene';
    case 'source':
      if (payload.sourceType === 'notebooklm-audio') {
        return track === 'scene' || track === 'voiceover' || track === 'music';
      }
      return track === 'scene';
    case 'source-slide':
      return track === 'scene';
    case 'character':
      return track === 'character' || track === 'scene';
    case 'voice':
      return track === 'voiceover' || track === 'scene';
    case 'music-preset':
      return track === 'music';
    default:
      return false;
  }
}

export function Timeline({
  project,
  voices,
  allCharacters,
  currentTimeSec,
  activeSceneId,
  selectedBlock,
  draggingPayload,
  onSelectBlock,
  onSeek,
  onUpdateScene,
  onReorderScenes,
  onDeleteScene,
  onUpdateMusicTrack,
  onDeleteMusicTrack,
  onDropItem,
  onPreviewVoice,
}: TimelineProps) {
  const [pxPerSec, setPxPerSec] = useState<number>(4.5);
  const [showQuickEdit, setShowQuickEdit] = useState<boolean>(true);
  const [titleDraft, setTitleDraft] = useState<string>('');

  // Live pointer drag / trim preview state
  const [pointerOp, setPointerOp] = useState<PointerDragOp | null>(null);
  const [previewPatch, setPreviewPatch] = useState<{
    track: TimelineTrackKind;
    id: string;
    startSec: number;
    durationSec: number;
    trimStartSec: number;
    targetSceneInsertIdx?: number;
  } | null>(null);
  const previewPatchRef = useRef(previewPatch);
  previewPatchRef.current = previewPatch;

  // HTML5 drop zone hover state
  const [dropHover, setDropHover] = useState<{
    track: TimelineTrackKind;
    dropSec: number;
    targetSceneId?: string;
    compatible: boolean;
  } | null>(null);

  const containerRef = useRef<HTMLElement | null>(null);
  const suppressNextClickRef = useRef(false);

  const sceneEntries = useMemo(() => {
    let cursor = 0;
    return project.scenes.map((sc, idx) => {
      const start = cursor;
      cursor += sc.durationSec;
      return { scene: sc, index: idx, startSec: start, endSec: cursor };
    });
  }, [project.scenes]);

  const maxBlockEndSec = useMemo(() => {
    let maxEnd = sceneEntries.length > 0 ? sceneEntries[sceneEntries.length - 1].endSec : 60;
    for (const entry of sceneEntries) {
      const cEnd =
        (entry.scene.characterStartSec ?? entry.startSec) +
        (entry.scene.characterDurationSec ?? entry.scene.durationSec);
      const vEnd =
        (entry.scene.voiceStartSec ?? entry.startSec) +
        (entry.scene.voiceDurationSec ?? entry.scene.durationSec);
      maxEnd = Math.max(maxEnd, cEnd, vEnd);
    }
    for (const m of project.musicTracks) {
      maxEnd = Math.max(maxEnd, m.startTimeSec + m.durationSec);
    }
    return maxEnd;
  }, [sceneEntries, project.musicTracks]);

  const totalSec = Math.max(60, maxBlockEndSec + 10);
  const trackWidthPx = Math.max(720, Math.round(totalSec * pxPerSec));

  const tickInterval = totalSec > 900 ? 120 : totalSec > 360 ? 60 : 30;
  const ticks: number[] = [];
  for (let s = 0; s <= totalSec; s += tickInterval) {
    ticks.push(s);
  }

  const formatShort = (s: number) => {
    const rounded = Math.max(0, Math.round(s));
    const m = Math.floor(rounded / 60);
    const rem = rounded % 60;
    return `${m}:${rem.toString().padStart(2, '0')}`;
  };

  const combinedCharacters = useMemo(
    () => [
      ...project.characters,
      ...allCharacters.filter((c) => !project.characters.some((pc) => pc.id === c.id)),
    ],
    [project.characters, allCharacters]
  );

  // Sync draft title when selection changes
  const selectedSceneEntry = useMemo(() => {
    if (!selectedBlock || selectedBlock.track === 'music') return undefined;
    return sceneEntries.find((e) => e.scene.id === selectedBlock.id);
  }, [selectedBlock, sceneEntries]);

  const selectedMusicTrack = useMemo(() => {
    if (!selectedBlock || selectedBlock.track !== 'music') return undefined;
    return project.musicTracks.find((m) => m.id === selectedBlock.id);
  }, [selectedBlock, project.musicTracks]);

  useEffect(() => {
    if (selectedBlock?.track === 'scene' && selectedSceneEntry) {
      setTitleDraft(selectedSceneEntry.scene.title);
    } else if (selectedBlock?.track === 'music' && selectedMusicTrack) {
      setTitleDraft(selectedMusicTrack.title);
    }
  }, [selectedBlock, selectedSceneEntry, selectedMusicTrack]);

  // Delete currently selected or specific block
  const handleDeleteBlock = useCallback(
    async (track: TimelineTrackKind, id: string) => {
      if (track === 'scene') {
        if (project.scenes.length <= 1) return;
        await onDeleteScene(id);
        if (selectedBlock?.track === 'scene' && selectedBlock.id === id) {
          onSelectBlock(null);
        }
      } else if (track === 'character') {
        await onUpdateScene(id, {
          characterId: null,
          characterPlacement: 'offscreen',
          characterStartSec: null,
          characterDurationSec: null,
        });
        if (selectedBlock?.track === 'character' && selectedBlock.id === id) {
          onSelectBlock(null);
        }
      } else if (track === 'voiceover') {
        await onUpdateScene(id, {
          voiceEnabled: false,
        });
        if (selectedBlock?.track === 'voiceover' && selectedBlock.id === id) {
          onSelectBlock(null);
        }
      } else if (track === 'music') {
        await onDeleteMusicTrack(id);
        if (selectedBlock?.track === 'music' && selectedBlock.id === id) {
          onSelectBlock(null);
        }
      }
    },
    [
      project.scenes.length,
      onDeleteScene,
      onUpdateScene,
      onDeleteMusicTrack,
      selectedBlock,
      onSelectBlock,
    ]
  );

  // Pointer drag / trim window listeners
  useEffect(() => {
    if (!pointerOp) return;

    const handleMove = (ev: PointerEvent) => {
      const dx = ev.clientX - pointerOp.startClientX;
      if (!pointerOp.moved && Math.abs(dx) < 4) return;
      if (!pointerOp.moved) {
        pointerOp.moved = true;
      }

      const deltaSec = Math.round(dx / pxPerSec);
      const minDur = pointerOp.track === 'scene' || pointerOp.track === 'music' ? 5 : 2;
      const maxDur = pointerOp.track === 'music' ? 1800 : 300;

      const nextPatch = (() => {
        if (pointerOp.kind === 'trim-right') {
          const nextDur = Math.max(minDur, Math.min(maxDur, pointerOp.origDurationSec + deltaSec));
          return {
            track: pointerOp.track,
            id: pointerOp.id,
            startSec: pointerOp.origStartSec,
            durationSec: nextDur,
            trimStartSec: pointerOp.origTrimStartSec,
          };
        }
        if (pointerOp.kind === 'trim-left') {
          if (pointerOp.track === 'scene') {
            const maxShrink = pointerOp.origDurationSec - minDur;
            const clampedDelta = Math.max(-pointerOp.origTrimStartSec, Math.min(maxShrink, deltaSec));
            const nextDur = Math.max(minDur, Math.min(maxDur, pointerOp.origDurationSec - deltaSec));
            const nextTrim = Math.max(0, pointerOp.origTrimStartSec + clampedDelta);
            return {
              track: 'scene' as const,
              id: pointerOp.id,
              startSec: pointerOp.origStartSec,
              durationSec: nextDur,
              trimStartSec: nextTrim,
            };
          }
          const origEnd = pointerOp.origStartSec + pointerOp.origDurationSec;
          const nextStart = Math.max(
            0,
            Math.min(origEnd - minDur, pointerOp.origStartSec + deltaSec)
          );
          const nextDur = Math.max(minDur, origEnd - nextStart);
          const trimDelta = nextStart - pointerOp.origStartSec;
          return {
            track: pointerOp.track,
            id: pointerOp.id,
            startSec: nextStart,
            durationSec: nextDur,
            trimStartSec: Math.max(0, pointerOp.origTrimStartSec + trimDelta),
          };
        }
        if (pointerOp.track === 'scene') {
          const cursorSec = Math.max(0, pointerOp.origStartSec + pointerOp.origDurationSec / 2 + deltaSec);
          let targetIdx = sceneEntries.length - 1;
          for (let i = 0; i < sceneEntries.length; i++) {
            const mid = sceneEntries[i].startSec + sceneEntries[i].scene.durationSec / 2;
            if (cursorSec < mid) {
              targetIdx = i;
              break;
            }
          }
          return {
            track: 'scene' as const,
            id: pointerOp.id,
            startSec: Math.max(0, pointerOp.origStartSec + deltaSec),
            durationSec: pointerOp.origDurationSec,
            trimStartSec: pointerOp.origTrimStartSec,
            targetSceneInsertIdx: targetIdx,
          };
        }
        const nextStart = Math.max(0, pointerOp.origStartSec + deltaSec);
        return {
          track: pointerOp.track,
          id: pointerOp.id,
          startSec: nextStart,
          durationSec: pointerOp.origDurationSec,
          trimStartSec: pointerOp.origTrimStartSec,
        };
      })();

      previewPatchRef.current = nextPatch;
      setPreviewPatch(nextPatch);
    };

    const handleUp = () => {
      const currentOp = pointerOp;
      const latestPreview = previewPatchRef.current;
      previewPatchRef.current = null;
      setPointerOp(null);
      setPreviewPatch(null);

      if (!currentOp.moved || !latestPreview) {
        return;
      }

      suppressNextClickRef.current = true;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 60);

      if (currentOp.track === 'scene') {
        if (currentOp.kind === 'move' && latestPreview.targetSceneInsertIdx !== undefined) {
          const fromIdx = project.scenes.findIndex((s) => s.id === currentOp.id);
          const toIdx = latestPreview.targetSceneInsertIdx;
          if (fromIdx !== -1 && toIdx !== fromIdx) {
            const ids = project.scenes.map((s) => s.id);
            const [movedId] = ids.splice(fromIdx, 1);
            ids.splice(toIdx, 0, movedId);
            void onReorderScenes(ids);
          }
        } else if (
          latestPreview.durationSec !== currentOp.origDurationSec ||
          latestPreview.trimStartSec !== currentOp.origTrimStartSec
        ) {
          void onUpdateScene(currentOp.id, {
            durationSec: latestPreview.durationSec,
            trimStartSec: latestPreview.trimStartSec,
          });
        }
      } else if (currentOp.track === 'character') {
        if (
          latestPreview.startSec !== currentOp.origStartSec ||
          latestPreview.durationSec !== currentOp.origDurationSec
        ) {
          void onUpdateScene(currentOp.id, {
            characterStartSec: latestPreview.startSec,
            characterDurationSec: latestPreview.durationSec,
          });
        }
      } else if (currentOp.track === 'voiceover') {
        if (
          latestPreview.startSec !== currentOp.origStartSec ||
          latestPreview.durationSec !== currentOp.origDurationSec ||
          latestPreview.trimStartSec !== currentOp.origTrimStartSec
        ) {
          void onUpdateScene(currentOp.id, {
            voiceStartSec: latestPreview.startSec,
            voiceDurationSec: latestPreview.durationSec,
            voiceTrimStartSec: latestPreview.trimStartSec,
          });
        }
      } else if (currentOp.track === 'music') {
        if (
          latestPreview.startSec !== currentOp.origStartSec ||
          latestPreview.durationSec !== currentOp.origDurationSec
        ) {
          void onUpdateMusicTrack(currentOp.id, {
            startTimeSec: latestPreview.startSec,
            durationSec: latestPreview.durationSec,
          });
        }
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [
    pointerOp,
    pxPerSec,
    sceneEntries,
    project.scenes,
    onReorderScenes,
    onUpdateScene,
    onUpdateMusicTrack,
  ]);

  const startPointerOp = (
    e: React.PointerEvent,
    op: Omit<PointerDragOp, 'startClientX' | 'moved'>
  ) => {
    if (e.button !== 0) return;
    if (op.kind !== 'move') {
      e.stopPropagation();
    }
    setPointerOp({
      ...op,
      startClientX: e.clientX,
      moved: false,
    });
  };

  // HTML5 Drag & Drop handlers from right-hand panels
  const computeDropInfo = (e: React.DragEvent<HTMLDivElement>, track: TimelineTrackKind) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rawSec = Math.max(0, (e.clientX - rect.left) / pxPerSec);
    const dropSec = Math.round(rawSec);
    const matchingScene = sceneEntries.find(
      (se) => rawSec >= se.startSec && rawSec < se.endSec
    );
    return {
      dropSec,
      targetSceneId: matchingScene?.scene.id,
      compatible: isPayloadCompatible(track, draggingPayload),
    };
  };

  const handleTrackDragOver = (e: React.DragEvent<HTMLDivElement>, track: TimelineTrackKind) => {
    const info = computeDropInfo(e, track);
    if (!info.compatible) {
      setDropHover({ track, ...info });
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropHover({ track, ...info });
  };

  const handleTrackDrop = async (e: React.DragEvent<HTMLDivElement>, track: TimelineTrackKind) => {
    e.preventDefault();
    const info = computeDropInfo(e, track);
    setDropHover(null);

    let payload: TimelineDragPayload | null = draggingPayload;
    const raw =
      e.dataTransfer.getData('application/x-calamari-drag') ||
      e.dataTransfer.getData('text/plain');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as TimelineDragPayload;
        if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
          payload = parsed;
        }
      } catch {
        // Fallback to draggingPayload state
      }
    }

    if (!payload || !isPayloadCompatible(track, payload)) return;
    await onDropItem({
      track,
      dropSec: info.dropSec,
      targetSceneId: info.targetSceneId,
      payload,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const tag = (document.activeElement?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!selectedBlock) return;
    e.preventDefault();
    void handleDeleteBlock(selectedBlock.track, selectedBlock.id);
  };

  const selectAndEdit = (track: TimelineTrackKind, id: string, startSec: number) => {
    if (suppressNextClickRef.current) return;
    setShowQuickEdit(true);
    onSelectBlock({ track, id }, startSec);
  };

  const moveSceneByDelta = (sceneId: string, delta: -1 | 1) => {
    const idx = project.scenes.findIndex((s) => s.id === sceneId);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= project.scenes.length) return;
    const ids = project.scenes.map((s) => s.id);
    const [item] = ids.splice(idx, 1);
    ids.splice(nextIdx, 0, item);
    void onReorderScenes(ids);
  };

  const renderQuickEditBar = () => {
    if (!selectedBlock || !showQuickEdit) return null;

    if (selectedBlock.track === 'scene' && selectedSceneEntry) {
      const sc = selectedSceneEntry.scene;
      return (
        <div
          data-testid="timeline-quick-edit"
          className="px-3.5 py-2 border-b border-indigo-500/30 bg-indigo-950/25 flex flex-wrap items-center gap-3 text-xs"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
            Scene #{selectedSceneEntry.index + 1}
          </span>
          <input
            type="text"
            aria-label="Edit scene title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              if (titleDraft.trim() && titleDraft.trim() !== sc.title) {
                void onUpdateScene(sc.id, { title: titleDraft.trim() });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && titleDraft.trim()) {
                void onUpdateScene(sc.id, { title: titleDraft.trim() });
                e.currentTarget.blur();
              }
            }}
            className="w-44 rounded bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-100 focus:border-indigo-400 focus:outline-none"
          />
          <span className="text-[10px] font-mono text-zinc-400">
            Start {formatShort(selectedSceneEntry.startSec)}
          </span>
          <NumericField
            label="Duration"
            ariaLabel="Edit scene duration"
            value={sc.durationSec}
            min={5}
            max={300}
            onCommit={(val) => void onUpdateScene(sc.id, { durationSec: val })}
          />
          <NumericField
            label="Trim In"
            ariaLabel="Edit scene trim start"
            value={sc.trimStartSec ?? 0}
            min={0}
            max={295}
            onCommit={(val) => void onUpdateScene(sc.id, { trimStartSec: val })}
          />
          <label className="flex items-center gap-1 text-[10px] text-zinc-400">
            <span>Anim</span>
            <select
              aria-label="Edit scene animation preset"
              value={sc.animationPreset || 'diagram-flow'}
              onChange={(e) =>
                void onUpdateScene(sc.id, {
                  animationPreset: e.target.value as SceneAnimationPreset,
                })
              }
              className="rounded bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-100"
            >
              {ANIMATION_PRESET_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={selectedSceneEntry.index === 0}
              onClick={() => moveSceneByDelta(sc.id, -1)}
              title="Move scene earlier"
              className="p-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-35"
            >
              <ArrowLeft className="w-3 h-3" />
            </button>
            <button
              type="button"
              disabled={selectedSceneEntry.index >= project.scenes.length - 1}
              onClick={() => moveSceneByDelta(sc.id, 1)}
              title="Move scene later"
              className="p-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-35"
            >
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              disabled={project.scenes.length <= 1}
              onClick={() => void handleDeleteBlock('scene', sc.id)}
              title={
                project.scenes.length <= 1
                  ? 'Cannot delete the only remaining scene'
                  : 'Delete scene'
              }
              className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 px-2 py-0.5 text-[10px] font-medium text-rose-200 disabled:opacity-35"
            >
              <Trash2 className="w-3 h-3" /> Delete Scene
            </button>
            <button
              type="button"
              onClick={() => setShowQuickEdit(false)}
              className="p-1 rounded text-zinc-400 hover:text-zinc-200"
              title="Hide quick edit"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    }

    if (selectedBlock.track === 'character' && selectedSceneEntry) {
      const sc = selectedSceneEntry.scene;
      const charStart = sc.characterStartSec ?? selectedSceneEntry.startSec;
      const charDur = sc.characterDurationSec ?? sc.durationSec;
      return (
        <div
          data-testid="timeline-quick-edit"
          className="px-3.5 py-2 border-b border-cyan-500/30 bg-cyan-950/20 flex flex-wrap items-center gap-3 text-xs"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
            Character Block
          </span>
          <select
            aria-label="Edit character assignment"
            value={sc.characterId || ''}
            onChange={(e) =>
              void onUpdateScene(sc.id, {
                characterId: e.target.value || null,
                ...(e.target.value && sc.characterPlacement === 'offscreen'
                  ? { characterPlacement: 'left' }
                  : {}),
              })
            }
            className="rounded bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-100"
          >
            <option value="">None</option>
            {combinedCharacters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Edit character placement"
            value={sc.characterPlacement}
            onChange={(e) =>
              void onUpdateScene(sc.id, {
                characterPlacement: e.target.value as CharacterPlacement,
              })
            }
            className="rounded bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-100"
          >
            {PLACEMENT_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <NumericField
            label="Start"
            ariaLabel="Edit character start"
            value={charStart}
            min={0}
            max={3600}
            onCommit={(val) => void onUpdateScene(sc.id, { characterStartSec: val })}
          />
          <NumericField
            label="Duration"
            ariaLabel="Edit character duration"
            value={charDur}
            min={2}
            max={600}
            onCommit={(val) => void onUpdateScene(sc.id, { characterDurationSec: val })}
          />
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleDeleteBlock('character', sc.id)}
              className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 px-2 py-0.5 text-[10px] font-medium text-rose-200"
            >
              <Trash2 className="w-3 h-3" /> Delete Character
            </button>
            <button
              type="button"
              onClick={() => setShowQuickEdit(false)}
              className="p-1 rounded text-zinc-400 hover:text-zinc-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    }

    if (selectedBlock.track === 'voiceover' && selectedSceneEntry) {
      const sc = selectedSceneEntry.scene;
      const voStart = sc.voiceStartSec ?? selectedSceneEntry.startSec;
      const voDur = sc.voiceDurationSec ?? sc.durationSec;
      const selectedVoice = voices.find((v) => v.voice_id === sc.voiceId);
      return (
        <div
          data-testid="timeline-quick-edit"
          className="px-3.5 py-2 border-b border-amber-500/30 bg-amber-950/20 flex flex-wrap items-center gap-3 text-xs"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
            Voiceover #{selectedSceneEntry.index + 1}
          </span>
          <select
            aria-label="Edit voiceover voice"
            value={sc.voiceId}
            onChange={(e) => void onUpdateScene(sc.id, { voiceId: e.target.value })}
            className="rounded bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-100 max-w-[180px]"
          >
            {voices.map((v) => (
              <option key={v.voice_id} value={v.voice_id}>
                {v.name}
              </option>
            ))}
          </select>
          {selectedVoice?.sampleUrl && (
            <select
              aria-label="Edit voiceover playback mode"
              value={sc.voicePlaybackMode || 'auto'}
              onChange={(e) =>
                void onUpdateScene(sc.id, {
                  voicePlaybackMode: e.target.value as 'auto' | VoicePlaybackMode,
                })
              }
              className="rounded bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-100"
            >
              <option value="auto">Auto Mode</option>
              <option value="speak-script">Speak Script</option>
              <option value="direct-sample">Direct Clip</option>
            </select>
          )}
          <NumericField
            label="Start"
            ariaLabel="Edit voiceover start"
            value={voStart}
            min={0}
            max={3600}
            onCommit={(val) => void onUpdateScene(sc.id, { voiceStartSec: val })}
          />
          <NumericField
            label="Duration"
            ariaLabel="Edit voiceover duration"
            value={voDur}
            min={2}
            max={600}
            onCommit={(val) => void onUpdateScene(sc.id, { voiceDurationSec: val })}
          />
          {onPreviewVoice && (
            <button
              type="button"
              onClick={() => void onPreviewVoice(sc.voiceId, sc.narration, sc.id)}
              className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 px-2 py-0.5 text-[10px] font-medium text-amber-200"
            >
              <Play className="w-2.5 h-2.5" /> Play
            </button>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleDeleteBlock('voiceover', sc.id)}
              className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 px-2 py-0.5 text-[10px] font-medium text-rose-200"
            >
              <Trash2 className="w-3 h-3" /> Delete VO
            </button>
            <button
              type="button"
              onClick={() => setShowQuickEdit(false)}
              className="p-1 rounded text-zinc-400 hover:text-zinc-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    }

    if (selectedBlock.track === 'music' && selectedMusicTrack) {
      const m = selectedMusicTrack;
      return (
        <div
          data-testid="timeline-quick-edit"
          className="px-3.5 py-2 border-b border-emerald-500/30 bg-emerald-950/20 flex flex-wrap items-center gap-3 text-xs"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
            Music Bed
          </span>
          <input
            type="text"
            aria-label="Edit music title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              if (titleDraft.trim() && titleDraft.trim() !== m.title) {
                void onUpdateMusicTrack(m.id, { title: titleDraft.trim() });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && titleDraft.trim()) {
                void onUpdateMusicTrack(m.id, { title: titleDraft.trim() });
                e.currentTarget.blur();
              }
            }}
            className="w-40 rounded bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-100 focus:border-emerald-400 focus:outline-none"
          />
          <NumericField
            label="Start"
            ariaLabel="Edit music start"
            value={m.startTimeSec}
            min={0}
            max={3600}
            onCommit={(val) => void onUpdateMusicTrack(m.id, { startTimeSec: val })}
          />
          <NumericField
            label="Duration"
            ariaLabel="Edit music duration"
            value={m.durationSec}
            min={5}
            max={1800}
            onCommit={(val) => void onUpdateMusicTrack(m.id, { durationSec: val })}
          />
          <NumericField
            label="BPM"
            ariaLabel="Edit music bpm"
            value={m.bpm}
            min={50}
            max={200}
            unit=""
            onCommit={(val) => void onUpdateMusicTrack(m.id, { bpm: val })}
          />
          <NumericField
            label="Vol"
            ariaLabel="Edit music volume"
            value={m.volumeDb}
            min={-40}
            max={0}
            unit="dB"
            onCommit={(val) => void onUpdateMusicTrack(m.id, { volumeDb: val })}
          />
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleDeleteBlock('music', m.id)}
              className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 px-2 py-0.5 text-[10px] font-medium text-rose-200"
            >
              <Trash2 className="w-3 h-3" /> Delete Music
            </button>
            <button
              type="button"
              onClick={() => setShowQuickEdit(false)}
              className="p-1 rounded text-zinc-400 hover:text-zinc-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <section
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      data-testid="multi-track-timeline"
      className="bg-[#0d0d14] border border-zinc-800/90 rounded-xl overflow-hidden flex flex-col shrink-0 focus:outline-none focus:border-indigo-500/50"
    >
      {/* Timeline Header */}
      <div className="px-3.5 py-2 border-b border-zinc-800/80 bg-zinc-950/70 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Multi-Track Timeline
          </span>
          <span className="text-[11px] text-zinc-500">
            4 Tracks • {project.scenes.length} Scenes • {project.musicTracks.length} Audio Beds
          </span>
          <span className="hidden xl:inline text-[10px] text-zinc-500">
            Click to edit • Drag edges to trim • Drag blocks to move/reorder • Drop assets/cast/voices/music • Del to remove
          </span>
        </div>

        <div className="flex items-center gap-2">
          {selectedBlock && !showQuickEdit && (
            <button
              type="button"
              onClick={() => setShowQuickEdit(true)}
              className="px-2 py-0.5 rounded border border-indigo-500/40 bg-indigo-500/15 text-[10px] text-indigo-200"
            >
              Edit Selected
            </button>
          )}
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

      {/* Inline Quick-Edit Bar for Clicked Block */}
      {renderQuickEditBar()}

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
            data-testid="timeline-track-scene"
            onDragOver={(e) => handleTrackDragOver(e, 'scene')}
            onDragEnter={(e) => handleTrackDragOver(e, 'scene')}
            onDragLeave={() => setDropHover((prev) => (prev?.track === 'scene' ? null : prev))}
            onDrop={(e) => void handleTrackDrop(e, 'scene')}
            className={`h-12 border-b border-zinc-800/60 relative flex items-center px-0.5 transition-colors ${
              dropHover?.track === 'scene'
                ? dropHover.compatible
                  ? 'bg-indigo-500/15 ring-1 ring-inset ring-indigo-400/70'
                  : 'bg-rose-500/10'
                : ''
            }`}
            style={{ width: `${trackWidthPx}px` }}
          >
            {sceneEntries.map(({ scene, startSec }) => {
              const isPreview = previewPatch?.track === 'scene' && previewPatch.id === scene.id;
              const displayStart = isPreview ? previewPatch.startSec : startSec;
              const displayDur = isPreview ? previewPatch.durationSec : scene.durationSec;
              const isSelected =
                (selectedBlock?.track === 'scene' && selectedBlock.id === scene.id) ||
                (!selectedBlock && scene.id === activeSceneId);
              const width = Math.max(50, displayDur * pxPerSec - 2);

              return (
                <div
                  key={scene.id}
                  data-testid={`timeline-block-scene-${scene.id}`}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) =>
                    startPointerOp(e, {
                      kind: 'move',
                      track: 'scene',
                      id: scene.id,
                      origStartSec: startSec,
                      origDurationSec: scene.durationSec,
                      origTrimStartSec: scene.trimStartSec ?? 0,
                    })
                  }
                  onClick={() => selectAndEdit('scene', scene.id, startSec)}
                  style={{ left: `${displayStart * pxPerSec}px`, width: `${width}px` }}
                  className={`group absolute h-9 rounded-md px-2.5 text-left transition overflow-hidden border select-none cursor-grab active:cursor-grabbing ${
                    isSelected
                      ? 'bg-indigo-600/35 border-indigo-400 text-white shadow-sm shadow-indigo-500/20 z-10'
                      : 'bg-indigo-950/55 border-indigo-800/60 text-zinc-200 hover:border-indigo-500/70'
                  }`}
                >
                  {/* Left trim handle */}
                  <div
                    data-testid={`trim-left-scene-${scene.id}`}
                    title="Drag to trim start"
                    onPointerDown={(e) =>
                      startPointerOp(e, {
                        kind: 'trim-left',
                        track: 'scene',
                        id: scene.id,
                        origStartSec: startSec,
                        origDurationSec: scene.durationSec,
                        origTrimStartSec: scene.trimStartSec ?? 0,
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-indigo-400/0 hover:bg-indigo-300/60 transition"
                  />

                  <div className="flex items-center justify-between gap-1 pr-4">
                    <div className="flex items-center gap-1 min-w-0">
                      <GripVertical className="w-2.5 h-2.5 text-indigo-300/60 shrink-0" />
                      <span className="text-[11px] font-medium truncate">{scene.title}</span>
                    </div>
                  </div>
                  <div className="text-[9px] text-indigo-300/80 truncate pl-3.5">
                    {scene.cameraMotion} • {displayDur}s
                  </div>

                  {/* Delete button */}
                  {project.scenes.length > 1 && (
                    <button
                      type="button"
                      data-testid={`delete-scene-${scene.id}`}
                      title="Delete Scene"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteBlock('scene', scene.id);
                      }}
                      className={`absolute top-1 right-2 p-0.5 rounded bg-zinc-950/80 text-zinc-400 hover:text-rose-400 transition ${
                        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  )}

                  {/* Right trim handle */}
                  <div
                    data-testid={`trim-right-scene-${scene.id}`}
                    title="Drag to trim duration"
                    onPointerDown={(e) =>
                      startPointerOp(e, {
                        kind: 'trim-right',
                        track: 'scene',
                        id: scene.id,
                        origStartSec: startSec,
                        origDurationSec: scene.durationSec,
                        origTrimStartSec: scene.trimStartSec ?? 0,
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-indigo-400/0 hover:bg-indigo-300/60 transition"
                  />
                </div>
              );
            })}

            {/* Scene Reorder Insertion Marker */}
            {previewPatch?.track === 'scene' &&
              previewPatch.targetSceneInsertIdx !== undefined && (
                <div
                  className="absolute top-0.5 bottom-0.5 w-1 bg-cyan-400 rounded-full z-30 pointer-events-none shadow-[0_0_8px_rgba(34,211,238,0.9)]"
                  style={{
                    left: `${
                      (sceneEntries[previewPatch.targetSceneInsertIdx]?.startSec ?? totalSec) *
                      pxPerSec
                    }px`,
                  }}
                />
              )}

            {/* Drop zone indicator */}
            {dropHover?.track === 'scene' && dropHover.compatible && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-indigo-400 z-30 pointer-events-none"
                style={{ left: `${dropHover.dropSec * pxPerSec}px` }}
              >
                <span className="absolute -top-0.5 left-1 rounded bg-indigo-600 px-1.5 py-0.5 text-[9px] font-mono text-white whitespace-nowrap">
                  Drop @ {formatShort(dropHover.dropSec)}
                </span>
              </div>
            )}
          </div>

          {/* Track 2: Characters */}
          <div
            data-testid="timeline-track-character"
            onDragOver={(e) => handleTrackDragOver(e, 'character')}
            onDragEnter={(e) => handleTrackDragOver(e, 'character')}
            onDragLeave={() => setDropHover((prev) => (prev?.track === 'character' ? null : prev))}
            onDrop={(e) => void handleTrackDrop(e, 'character')}
            className={`h-10 border-b border-zinc-800/60 relative flex items-center transition-colors ${
              dropHover?.track === 'character'
                ? dropHover.compatible
                  ? 'bg-cyan-500/15 ring-1 ring-inset ring-cyan-400/70'
                  : 'bg-rose-500/10'
                : ''
            }`}
            style={{ width: `${trackWidthPx}px` }}
          >
            {sceneEntries.map(({ scene, startSec }) => {
              const char = combinedCharacters.find((c) => c.id === scene.characterId);
              if (!char || scene.characterPlacement === 'offscreen') return null;
              const baseStart = scene.characterStartSec ?? startSec;
              const baseDur = scene.characterDurationSec ?? scene.durationSec;
              const isPreview =
                previewPatch?.track === 'character' && previewPatch.id === scene.id;
              const displayStart = isPreview ? previewPatch.startSec : baseStart;
              const displayDur = isPreview ? previewPatch.durationSec : baseDur;
              const isSelected =
                selectedBlock?.track === 'character' && selectedBlock.id === scene.id;
              const width = Math.max(46, displayDur * pxPerSec - 2);

              return (
                <div
                  key={`char-${scene.id}`}
                  data-testid={`timeline-block-character-${scene.id}`}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) =>
                    startPointerOp(e, {
                      kind: 'move',
                      track: 'character',
                      id: scene.id,
                      origStartSec: baseStart,
                      origDurationSec: baseDur,
                      origTrimStartSec: 0,
                    })
                  }
                  onClick={() => selectAndEdit('character', scene.id, displayStart)}
                  style={{
                    left: `${displayStart * pxPerSec}px`,
                    width: `${width}px`,
                    borderColor: isSelected ? '#22d3ee' : `${char.previewColor}66`,
                    backgroundColor: isSelected ? `${char.previewColor}40` : `${char.previewColor}22`,
                  }}
                  className={`group absolute h-7 rounded-md border px-2 text-left flex items-center justify-between gap-1 overflow-hidden select-none cursor-grab active:cursor-grabbing ${
                    isSelected ? 'ring-1 ring-cyan-400 z-10' : ''
                  }`}
                >
                  <div
                    data-testid={`trim-left-character-${scene.id}`}
                    title="Drag to trim character start"
                    onPointerDown={(e) =>
                      startPointerOp(e, {
                        kind: 'trim-left',
                        track: 'character',
                        id: scene.id,
                        origStartSec: baseStart,
                        origDurationSec: baseDur,
                        origTrimStartSec: 0,
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-cyan-300/70"
                  />
                  <span className="text-[10px] font-medium text-zinc-100 truncate pr-4">
                    {char.name} ({scene.characterPlacement}) • {displayDur}s
                  </span>
                  <button
                    type="button"
                    data-testid={`delete-character-${scene.id}`}
                    title="Delete Character Appearance"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteBlock('character', scene.id);
                    }}
                    className={`absolute right-2 p-0.5 rounded bg-zinc-950/80 text-zinc-400 hover:text-rose-400 transition ${
                      isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                  <div
                    data-testid={`trim-right-character-${scene.id}`}
                    title="Drag to trim character duration"
                    onPointerDown={(e) =>
                      startPointerOp(e, {
                        kind: 'trim-right',
                        track: 'character',
                        id: scene.id,
                        origStartSec: baseStart,
                        origDurationSec: baseDur,
                        origTrimStartSec: 0,
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-cyan-300/70"
                  />
                </div>
              );
            })}

            {dropHover?.track === 'character' && dropHover.compatible && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 z-30 pointer-events-none"
                style={{ left: `${dropHover.dropSec * pxPerSec}px` }}
              >
                <span className="absolute -top-0.5 left-1 rounded bg-cyan-600 px-1.5 py-0.5 text-[9px] font-mono text-white whitespace-nowrap">
                  Cast @ {formatShort(dropHover.dropSec)}
                </span>
              </div>
            )}
          </div>

          {/* Track 3: Voiceover */}
          <div
            data-testid="timeline-track-voiceover"
            onDragOver={(e) => handleTrackDragOver(e, 'voiceover')}
            onDragEnter={(e) => handleTrackDragOver(e, 'voiceover')}
            onDragLeave={() => setDropHover((prev) => (prev?.track === 'voiceover' ? null : prev))}
            onDrop={(e) => void handleTrackDrop(e, 'voiceover')}
            className={`h-10 border-b border-zinc-800/60 relative flex items-center transition-colors ${
              dropHover?.track === 'voiceover'
                ? dropHover.compatible
                  ? 'bg-amber-500/15 ring-1 ring-inset ring-amber-400/70'
                  : 'bg-rose-500/10'
                : ''
            }`}
            style={{ width: `${trackWidthPx}px` }}
          >
            {sceneEntries.map(({ scene, startSec }, idx) => {
              if (scene.voiceEnabled === false) return null;
              const baseStart = scene.voiceStartSec ?? startSec;
              const baseDur = scene.voiceDurationSec ?? scene.durationSec;
              const isPreview =
                previewPatch?.track === 'voiceover' && previewPatch.id === scene.id;
              const displayStart = isPreview ? previewPatch.startSec : baseStart;
              const displayDur = isPreview ? previewPatch.durationSec : baseDur;
              const isSelected =
                selectedBlock?.track === 'voiceover' && selectedBlock.id === scene.id;
              const width = Math.max(46, displayDur * pxPerSec - 2);
              const voiceName =
                voices.find((v) => v.voice_id === scene.voiceId)?.name?.split('—')[0]?.trim() ||
                `VO #${idx + 1}`;

              return (
                <div
                  key={`vo-${scene.id}`}
                  data-testid={`timeline-block-voiceover-${scene.id}`}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) =>
                    startPointerOp(e, {
                      kind: 'move',
                      track: 'voiceover',
                      id: scene.id,
                      origStartSec: baseStart,
                      origDurationSec: baseDur,
                      origTrimStartSec: scene.voiceTrimStartSec ?? 0,
                    })
                  }
                  onClick={() => selectAndEdit('voiceover', scene.id, displayStart)}
                  style={{ left: `${displayStart * pxPerSec}px`, width: `${width}px` }}
                  className={`group absolute h-7 rounded-md border px-2 flex items-center justify-between gap-1 overflow-hidden select-none cursor-grab active:cursor-grabbing ${
                    isSelected
                      ? 'border-amber-400 bg-amber-500/30 ring-1 ring-amber-400/60 z-10'
                      : 'border-amber-600/40 bg-amber-500/15 hover:border-amber-400/70'
                  }`}
                >
                  <div
                    data-testid={`trim-left-voiceover-${scene.id}`}
                    title="Drag to trim voiceover start"
                    onPointerDown={(e) =>
                      startPointerOp(e, {
                        kind: 'trim-left',
                        track: 'voiceover',
                        id: scene.id,
                        origStartSec: baseStart,
                        origDurationSec: baseDur,
                        origTrimStartSec: scene.voiceTrimStartSec ?? 0,
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-amber-300/70"
                  />
                  <span className="text-[10px] text-amber-100 truncate">
                    {voiceName} • {displayDur}s
                  </span>
                  <div className="flex items-center gap-1 pr-1">
                    <span className="flex items-end gap-0.5 h-3 shrink-0 opacity-70">
                      {[4, 9, 6, 11, 5, 8].map((bar, bi) => (
                        <span
                          key={bi}
                          className="w-0.5 bg-amber-400 rounded-full"
                          style={{ height: `${bar}px` }}
                        />
                      ))}
                    </span>
                    <button
                      type="button"
                      data-testid={`delete-voiceover-${scene.id}`}
                      title="Delete Voiceover Clip"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteBlock('voiceover', scene.id);
                      }}
                      className={`p-0.5 rounded bg-zinc-950/80 text-zinc-400 hover:text-rose-400 transition ${
                        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <div
                    data-testid={`trim-right-voiceover-${scene.id}`}
                    title="Drag to trim voiceover duration"
                    onPointerDown={(e) =>
                      startPointerOp(e, {
                        kind: 'trim-right',
                        track: 'voiceover',
                        id: scene.id,
                        origStartSec: baseStart,
                        origDurationSec: baseDur,
                        origTrimStartSec: scene.voiceTrimStartSec ?? 0,
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-amber-300/70"
                  />
                </div>
              );
            })}

            {dropHover?.track === 'voiceover' && dropHover.compatible && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-30 pointer-events-none"
                style={{ left: `${dropHover.dropSec * pxPerSec}px` }}
              >
                <span className="absolute -top-0.5 left-1 rounded bg-amber-600 px-1.5 py-0.5 text-[9px] font-mono text-white whitespace-nowrap">
                  Voice @ {formatShort(dropHover.dropSec)}
                </span>
              </div>
            )}
          </div>

          {/* Track 4: Music */}
          <div
            data-testid="timeline-track-music"
            onDragOver={(e) => handleTrackDragOver(e, 'music')}
            onDragEnter={(e) => handleTrackDragOver(e, 'music')}
            onDragLeave={() => setDropHover((prev) => (prev?.track === 'music' ? null : prev))}
            onDrop={(e) => void handleTrackDrop(e, 'music')}
            className={`h-10 relative flex items-center transition-colors ${
              dropHover?.track === 'music'
                ? dropHover.compatible
                  ? 'bg-emerald-500/15 ring-1 ring-inset ring-emerald-400/70'
                  : 'bg-rose-500/10'
                : ''
            }`}
            style={{ width: `${trackWidthPx}px` }}
          >
            {project.musicTracks.map((track) => {
              const isPreview = previewPatch?.track === 'music' && previewPatch.id === track.id;
              const displayStart = isPreview ? previewPatch.startSec : track.startTimeSec;
              const displayDur = isPreview ? previewPatch.durationSec : track.durationSec;
              const isSelected =
                selectedBlock?.track === 'music' && selectedBlock.id === track.id;
              const width = Math.max(56, displayDur * pxPerSec - 2);

              return (
                <div
                  key={track.id}
                  data-testid={`timeline-block-music-${track.id}`}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) =>
                    startPointerOp(e, {
                      kind: 'move',
                      track: 'music',
                      id: track.id,
                      origStartSec: track.startTimeSec,
                      origDurationSec: track.durationSec,
                      origTrimStartSec: 0,
                    })
                  }
                  onClick={() => selectAndEdit('music', track.id, displayStart)}
                  style={{
                    left: `${displayStart * pxPerSec}px`,
                    width: `${width}px`,
                    borderColor: isSelected ? '#34d399' : `${track.accentColor}66`,
                    backgroundColor: isSelected ? `${track.accentColor}38` : `${track.accentColor}20`,
                  }}
                  className={`group absolute h-7 rounded-md border px-2 flex items-center justify-between gap-2 overflow-hidden select-none cursor-grab active:cursor-grabbing ${
                    isSelected ? 'ring-1 ring-emerald-400 z-10' : ''
                  }`}
                >
                  <div
                    data-testid={`trim-left-music-${track.id}`}
                    title="Drag to trim music start"
                    onPointerDown={(e) =>
                      startPointerOp(e, {
                        kind: 'trim-left',
                        track: 'music',
                        id: track.id,
                        origStartSec: track.startTimeSec,
                        origDurationSec: track.durationSec,
                        origTrimStartSec: 0,
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-emerald-300/70"
                  />
                  <span className="text-[10px] font-medium text-emerald-100 truncate">
                    {track.title} ({displayDur}s)
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0 pr-1">
                    <span className="text-[9px] font-mono text-emerald-300/80">
                      {track.bpm} BPM • {track.volumeDb}dB
                    </span>
                    <button
                      type="button"
                      data-testid={`delete-music-${track.id}`}
                      title="Delete Music Bed"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteBlock('music', track.id);
                      }}
                      className={`p-0.5 rounded bg-zinc-950/80 text-zinc-400 hover:text-rose-400 transition ${
                        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <div
                    data-testid={`trim-right-music-${track.id}`}
                    title="Drag to trim music duration"
                    onPointerDown={(e) =>
                      startPointerOp(e, {
                        kind: 'trim-right',
                        track: 'music',
                        id: track.id,
                        origStartSec: track.startTimeSec,
                        origDurationSec: track.durationSec,
                        origTrimStartSec: 0,
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-emerald-300/70"
                  />
                </div>
              );
            })}

            {dropHover?.track === 'music' && dropHover.compatible && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 z-30 pointer-events-none"
                style={{ left: `${dropHover.dropSec * pxPerSec}px` }}
              >
                <span className="absolute -top-0.5 left-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-mono text-white whitespace-nowrap">
                  Music @ {formatShort(dropHover.dropSec)}
                </span>
              </div>
            )}
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

export { Timeline as MultiTrackTimeline };
