import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  Download,
  Film,
  GripVertical,
  Loader2,
  LogIn,
  Mic,
  MicOff,
  Music,
  Play,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  User,
  UserPlus,
  Video,
  Volume2,
  Wand2,
} from 'lucide-react';
import type {
  CameraMotionPreset,
  CharacterPlacement,
  CharacterProfile,
  CinematicStyle,
  ConnectorDescriptor,
  ConnectorId,
  ExplainerProject,
  ImportedSource,
  MusicTrack,
  NativeVisualDiagramType,
  PushVoiceElevenLabsResult,
  SceneAnimationPreset,
  SceneItem,
  SceneVisualOverlay,
  TechAsset,
  TimelineDragPayload,
  TransitionType,
  VoicePlaybackMode,
  VoiceProfile,
} from '@shared/types';

export type InspectorTab = 'scene' | 'characters' | 'voices' | 'sources' | 'assets' | 'music';

export const STUDIO_MUSIC_PRESETS: Array<{
  title: string;
  mood: string;
  bpm: number;
  volumeDb: number;
  accentColor: string;
}> = [
  {
    title: 'Silicon Horizon',
    mood: 'Focused Tech Ambient',
    bpm: 108,
    volumeDb: -16,
    accentColor: '#10b981',
  },
  {
    title: 'Midnight Synthwave',
    mood: 'Upbeat Electronic',
    bpm: 118,
    volumeDb: -15,
    accentColor: '#a855f7',
  },
  {
    title: 'Quantum Minimalist',
    mood: 'Minimalist Pluck',
    bpm: 96,
    volumeDb: -18,
    accentColor: '#06b6d4',
  },
  {
    title: 'Telemetry Rising',
    mood: 'Inspiring Synth',
    bpm: 124,
    volumeDb: -14,
    accentColor: '#3b82f6',
  },
];

interface InspectorPanelProps {
  project: ExplainerProject;
  activeScene: SceneItem | undefined;
  voices: VoiceProfile[];
  voiceSource: 'env' | 'vault' | 'session' | 'mock';
  connectors: ConnectorDescriptor[];
  allCharacters: CharacterProfile[];
  assets: TechAsset[];
  sources: ImportedSource[];
  activeTab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
  selectedMusicTrackId?: string | null;
  onDragStartPayload?: (payload: TimelineDragPayload) => void;
  onDragEndPayload?: () => void;
  lastVoicePushResult?: PushVoiceElevenLabsResult | null;
  onUpdateScene: (sceneId: string, patch: Partial<SceneItem>) => Promise<void>;
  onTriggerHiggsfield: (sceneId: string) => Promise<void>;
  onPushSceneToProvider: (
    provider: 'higgsfield' | 'gemini_veo',
    sceneId: string,
    characterId?: string
  ) => Promise<void>;
  onPreviewVoice: (voiceId: string, sampleText?: string, sceneId?: string) => Promise<void>;
  onDownloadSceneAudio: (scene: SceneItem) => Promise<void>;
  onPlaySampleUrl: (url: string, label: string) => Promise<void>;
  onUpdateVoice: (voiceId: string, patch: { playbackMode?: VoicePlaybackMode }) => Promise<void>;
  onDeleteVoice: (voiceId: string) => Promise<void>;
  onPushVoiceToElevenLabs: (voiceId: string) => Promise<void>;
  onSyncElevenLabsVoices: () => Promise<void>;
  onAssignVoiceToAllScenes: (voiceId: string) => Promise<void>;
  onUploadSceneVoiceTake: (sceneId: string, file: File) => Promise<void>;
  onDeleteSceneVoiceTake: (sceneId: string) => Promise<void>;
  onGenerateSceneVisual: (sceneId: string, diagramType: NativeVisualDiagramType) => Promise<void>;
  onOpenConnectModal: (id: ConnectorId) => void;
  onOpenCharacterClone: () => void;
  onOpenVoiceClone: () => void;
  onOpenAssetUpload: () => void;
  onOpenSourceImport: () => void;
  onDeleteSource: (sourceId: string) => Promise<void>;
  onGenerateFromSource: (source: ImportedSource) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onAddMusicTrack: (track: Omit<MusicTrack, 'id'>) => Promise<void>;
  onUpdateMusicTrack?: (trackId: string, patch: Partial<MusicTrack>) => Promise<void>;
  onDeleteMusicTrack: (trackId: string) => Promise<void>;
  busyAction: string | null;
}

const CAMERA_OPTIONS: CameraMotionPreset[] = [
  'Slow Dolly In',
  'Orbital Pan',
  'Crane Pullback',
  'Handheld Micro',
  'Rack Focus',
  'Static Tripod',
];

const STYLE_OPTIONS: CinematicStyle[] = [
  'Neon Lab',
  'Anamorphic Studio',
  'Blueprint Isometric',
  'Editorial Documentary',
  'Quantum Noir',
];

const TRANSITION_OPTIONS: TransitionType[] = [
  'Cross Dissolve',
  'Whip Pan',
  'Glitch Cut',
  'Iris Wipe',
  'Match Cut',
];

const OVERLAY_OPTIONS: { value: SceneVisualOverlay; label: string }[] = [
  { value: 'architecture-flow', label: 'Architecture Flow' },
  { value: 'neural-graph', label: 'Neural Graph' },
  { value: 'code-terminal', label: 'Code Terminal' },
  { value: 'packet-stream', label: 'Packet Stream' },
  { value: 'wave-spectrum', label: 'Wave Spectrum' },
];

const ANIMATION_PRESET_OPTIONS: { value: SceneAnimationPreset; label: string }[] = [
  { value: 'diagram-flow', label: 'Diagram Flow' },
  { value: 'kinetic-cards', label: 'Kinetic Cards' },
  { value: 'slide-deck-reveal', label: 'Slide Deck Reveal' },
  { value: 'data-pulse', label: 'Data Pulse' },
  { value: 'split-comparison', label: 'Split Comparison' },
  { value: 'timeline-walkthrough', label: 'Timeline Walkthrough' },
  { value: 'particle-network', label: 'Particle Network' },
];

const DIAGRAM_TYPE_OPTIONS: { value: NativeVisualDiagramType; label: string }[] = [
  { value: 'auto', label: 'Auto-Detect' },
  { value: 'architecture', label: 'Architecture' },
  { value: 'flow', label: 'Sequence / Flow' },
  { value: 'comparison', label: 'Comparison' },
  { value: 'infographic', label: 'Metric Infographic' },
  { value: 'hardware', label: 'Hardware / Cloud' },
];

const PLACEMENT_OPTIONS: { value: CharacterPlacement; label: string }[] = [
  { value: 'left', label: 'Left Stage' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right Stage' },
  { value: 'split', label: 'Split Frame' },
  { value: 'offscreen', label: 'Offscreen VO' },
];

export function InspectorPanel({
  project,
  activeScene,
  voices,
  voiceSource,
  connectors,
  allCharacters,
  assets,
  sources,
  activeTab,
  onTabChange,
  selectedMusicTrackId,
  onDragStartPayload,
  onDragEndPayload,
  lastVoicePushResult,
  onUpdateScene,
  onTriggerHiggsfield,
  onPushSceneToProvider,
  onPreviewVoice,
  onDownloadSceneAudio,
  onPlaySampleUrl,
  onUpdateVoice,
  onDeleteVoice,
  onPushVoiceToElevenLabs,
  onSyncElevenLabsVoices,
  onAssignVoiceToAllScenes,
  onUploadSceneVoiceTake,
  onDeleteSceneVoiceTake,
  onGenerateSceneVisual,
  onOpenConnectModal,
  onOpenCharacterClone,
  onOpenVoiceClone,
  onOpenAssetUpload,
  onOpenSourceImport,
  onDeleteSource,
  onGenerateFromSource,
  onDeleteAsset,
  onAddMusicTrack,
  onUpdateMusicTrack,
  onDeleteMusicTrack,
  busyAction,
}: InspectorPanelProps) {
  const [internalTab, setInternalTab] = useState<InspectorTab>('scene');
  const tab = activeTab ?? internalTab;
  const setTab = (next: InspectorTab) => {
    setInternalTab(next);
    onTabChange?.(next);
  };

  const makeDraggableProps = (payload: TimelineDragPayload) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      const json = JSON.stringify(payload);
      e.dataTransfer.setData('application/x-calamari-drag', json);
      e.dataTransfer.setData('text/plain', json);
      e.dataTransfer.effectAllowed = 'copy';
      onDragStartPayload?.(payload);
    },
    onDragEnd: () => {
      onDragEndPayload?.();
    },
  });
  const [musicTitle, setMusicTitle] = useState('Neural Drift');
  const [musicMood, setMusicMood] = useState('Ambient Tech');
  const [musicBpm, setMusicBpm] = useState(110);
  const [musicDb, setMusicDb] = useState(-15);
  const [diagramType, setDiagramType] = useState<NativeVisualDiagramType>('auto');
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [recordingTake, setRecordingTake] = useState(false);
  const [takeSec, setTakeSec] = useState(0);
  const takeRecorderRef = useRef<MediaRecorder | null>(null);
  const takeStreamRef = useRef<MediaStream | null>(null);
  const takeChunksRef = useRef<Blob[]>([]);
  const takeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (takeTimerRef.current) window.clearInterval(takeTimerRef.current);
      if (takeStreamRef.current) takeStreamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startSceneTakeRecording = async () => {
    if (!activeScene || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return;
    }
    const targetSceneId = activeScene.id;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    takeStreamRef.current = stream;
    takeChunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    takeRecorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) takeChunksRef.current.push(ev.data);
    };
    recorder.onstop = () => {
      const mime = recorder.mimeType || 'audio/webm';
      const blob = new Blob(takeChunksRef.current, { type: mime });
      const ext = mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : 'webm';
      if (blob.size > 0) {
        const file = new File([blob], `scene-take-${Date.now()}.${ext}`, { type: mime });
        void onUploadSceneVoiceTake(targetSceneId, file);
      }
      stream.getTracks().forEach((t) => t.stop());
      takeStreamRef.current = null;
    };

    recorder.start();
    setTakeSec(0);
    setRecordingTake(true);
    takeTimerRef.current = window.setInterval(() => setTakeSec((s) => s + 1), 1000);
  };

  const stopSceneTakeRecording = () => {
    if (takeTimerRef.current) {
      window.clearInterval(takeTimerRef.current);
      takeTimerRef.current = null;
    }
    if (takeRecorderRef.current && takeRecorderRef.current.state !== 'inactive') {
      takeRecorderRef.current.stop();
    }
    setRecordingTake(false);
  };

  const elevenLabsConnector = connectors.find((c) => c.id === 'elevenlabs');
  const higgsfieldConnector = connectors.find((c) => c.id === 'higgsfield');
  const veoConnector = connectors.find((c) => c.id === 'gemini_veo');
  const isElevenLabsConnected = elevenLabsConnector?.status === 'connected';
  const isHiggsfieldConnected = higgsfieldConnector?.status === 'connected';
  const isVeoConnected = veoConnector?.status === 'connected';

  const combinedCharacters = [
    ...project.characters,
    ...allCharacters.filter((c) => !project.characters.some((pc) => pc.id === c.id)),
  ];

  const handleAddMusic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!musicTitle.trim()) return;
    const totalSec = project.scenes.reduce((s, sc) => s + sc.durationSec, 0);
    await onAddMusicTrack({
      title: musicTitle.trim(),
      mood: musicMood,
      bpm: musicBpm,
      startTimeSec: 0,
      durationSec: Math.max(30, Math.round(totalSec / 2)),
      volumeDb: musicDb,
      duckUnderVoice: true,
      accentColor: '#10b981',
    });
  };

  const activePushJob =
    activeScene?.activeVideoProvider === 'gemini_veo' && activeScene.veo
      ? activeScene.veo
      : activeScene?.higgsfield;
  const pushStatus = activePushJob?.status;
  const isPollingPush =
    pushStatus === 'queued' || pushStatus === 'generating' || pushStatus === 'rendering';

  const toggleAssetOnActiveScene = async (assetId: string) => {
    if (!activeScene) return;
    const current = new Set(activeScene.assetIds || []);
    if (current.has(assetId)) {
      current.delete(assetId);
    } else {
      current.add(assetId);
    }
    await onUpdateScene(activeScene.id, { assetIds: Array.from(current) });
  };

  return (
    <aside className="w-full lg:w-[375px] xl:w-[405px] shrink-0 bg-[#0d0d14] border border-zinc-800/90 rounded-xl flex flex-col overflow-hidden">
      {/* 6 Tabs */}
      <div className="grid grid-cols-6 border-b border-zinc-800/90 bg-zinc-950/70 p-1 gap-1">
        {(
          [
            { id: 'scene', label: 'Scene', icon: Film },
            { id: 'characters', label: 'Cast', icon: User },
            { id: 'voices', label: 'Voices', icon: Mic },
            { id: 'sources', label: 'Sources', icon: BookOpen },
            { id: 'assets', label: 'Assets', icon: Database },
            { id: 'music', label: 'Music', icon: Music },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center justify-center gap-1 py-2 rounded-lg text-[10.5px] font-medium transition ${
              tab === id
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
            }`}
          >
            <Icon className="w-3 h-3 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {tab === 'scene' && activeScene && (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                  Scene Inspector
                </div>
                <div className="text-sm font-semibold text-zinc-100 truncate">
                  {activeScene.title}
                </div>
              </div>
              <span className="text-xs font-mono bg-zinc-900 border border-zinc-800 px-2 py-1 rounded-md text-zinc-300 shrink-0">
                {activeScene.durationSec}s
              </span>
            </div>

            {/* RAG Context Used Chips */}
            {activeScene.ragContext && activeScene.ragContext.length > 0 && (
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
                  <span className="inline-flex items-center gap-1">
                    <Database className="w-3 h-3" />
                    RAG Context Used ({activeScene.ragContext.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setTab('assets')}
                    className="text-indigo-300 hover:underline font-normal normal-case"
                  >
                    Manage Assets
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activeScene.ragContext.map((m) => (
                    <span
                      key={`${m.sourceType}-${m.id}`}
                      title={m.snippet}
                      className="inline-flex items-center gap-1 rounded-md border border-indigo-500/35 bg-zinc-950/80 px-2 py-0.5 text-[10px] text-indigo-200"
                    >
                      <span className="uppercase text-[9px] text-indigo-400">{m.sourceType}</span>
                      <span className="truncate max-w-[160px]">{m.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Provider Connect Banner when Disconnected */}
            {(!isHiggsfieldConnected || !isVeoConnected) && (
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/15 p-2.5 space-y-2">
                <div className="text-[11px] font-semibold text-cyan-200">
                  Native 60fps Canvas Ready • Optional Cloud Push
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {!isHiggsfieldConnected && (
                    <button
                      type="button"
                      onClick={() => onOpenConnectModal('higgsfield')}
                      className="inline-flex items-center gap-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-2.5 py-1 text-[11px] font-semibold text-white transition"
                    >
                      <LogIn className="w-3 h-3" />
                      Connect Higgsfield
                    </button>
                  )}
                  {!isVeoConnected && (
                    <button
                      type="button"
                      onClick={() => onOpenConnectModal('gemini_veo')}
                      className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/40 bg-indigo-600/25 hover:bg-indigo-600/40 px-2.5 py-1 text-[11px] font-semibold text-indigo-200 transition"
                    >
                      <Video className="w-3 h-3" />
                      Connect Gemini Veo
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-[11px] font-medium text-zinc-400">
                Narration Script
              </label>
              <textarea
                rows={4}
                value={activeScene.narration}
                onChange={(e) =>
                  void onUpdateScene(activeScene.id, { narration: e.target.value })
                }
                className="w-full rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 p-2.5 text-xs text-zinc-100 leading-relaxed focus:outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-medium text-zinc-400">
                Scene Visual Prompt (Grounded with RAG Context)
              </label>
              <textarea
                rows={3}
                value={activeScene.visualPrompt}
                onChange={(e) =>
                  void onUpdateScene(activeScene.id, { visualPrompt: e.target.value })
                }
                className="w-full rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 p-2.5 text-xs text-zinc-200 leading-relaxed focus:outline-none"
              />
            </div>

            {/* Native SVG Diagram & Illustration Generator */}
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/15 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-cyan-200 flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-cyan-400" />
                  Native Visual &amp; Diagram Studio
                </span>
                <select
                  aria-label="Diagram Type"
                  value={diagramType}
                  onChange={(e) => setDiagramType(e.target.value as NativeVisualDiagramType)}
                  className="bg-zinc-950 border border-zinc-800 rounded-md px-2 py-0.5 text-[10px] text-zinc-200"
                >
                  {DIAGRAM_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busyAction === 'generate-visual'}
                  onClick={() => void onGenerateSceneVisual(activeScene.id, diagramType)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-cyan-600/25 hover:bg-cyan-600/35 border border-cyan-400/50 py-1.5 text-[11px] font-semibold text-cyan-100 transition disabled:opacity-50"
                >
                  {busyAction === 'generate-visual' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  Generate Native SVG Visual
                </button>
              </div>
              {activeScene.generatedVisualUrl && (
                <div className="rounded-lg border border-zinc-800 overflow-hidden bg-zinc-950">
                  <img
                    src={activeScene.generatedVisualUrl}
                    alt={activeScene.title}
                    className="w-full h-24 object-cover"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Animation Preset</label>
                <select
                  aria-label="Animation Preset"
                  value={activeScene.animationPreset || 'diagram-flow'}
                  onChange={(e) =>
                    void onUpdateScene(activeScene.id, {
                      animationPreset: e.target.value as SceneAnimationPreset,
                    })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
                >
                  {ANIMATION_PRESET_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Camera Motion</label>
                <select
                  value={activeScene.cameraMotion}
                  onChange={(e) =>
                    void onUpdateScene(activeScene.id, {
                      cameraMotion: e.target.value as CameraMotionPreset,
                    })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
                >
                  {CAMERA_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Cinematic Style</label>
                <select
                  value={activeScene.cinematicStyle}
                  onChange={(e) =>
                    void onUpdateScene(activeScene.id, {
                      cinematicStyle: e.target.value as CinematicStyle,
                    })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
                >
                  {STYLE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Transition In</label>
                <select
                  value={activeScene.transitionIn}
                  onChange={(e) =>
                    void onUpdateScene(activeScene.id, {
                      transitionIn: e.target.value as TransitionType,
                    })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
                >
                  {TRANSITION_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Tech Overlay</label>
                <select
                  value={activeScene.visualOverlay}
                  onChange={(e) =>
                    void onUpdateScene(activeScene.id, {
                      visualOverlay: e.target.value as SceneVisualOverlay,
                    })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
                >
                  {OVERLAY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Character</label>
                <select
                  value={activeScene.characterId || ''}
                  onChange={(e) =>
                    void onUpdateScene(activeScene.id, {
                      characterId: e.target.value || undefined,
                    })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
                >
                  <option value="">None</option>
                  {combinedCharacters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Stage Placement</label>
                <select
                  value={activeScene.characterPlacement}
                  onChange={(e) =>
                    void onUpdateScene(activeScene.id, {
                      characterPlacement: e.target.value as CharacterPlacement,
                    })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
                >
                  {PLACEMENT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Voiceover Selector directly in Scene Tab */}
            {(() => {
              const selectedVoice = voices.find((v) => v.voice_id === activeScene.voiceId);
              const effectiveSceneMode: VoicePlaybackMode =
                activeScene.voicePlaybackMode && activeScene.voicePlaybackMode !== 'auto'
                  ? activeScene.voicePlaybackMode
                  : selectedVoice?.playbackMode || 'speak-script';

              return (
                <div className="rounded-xl border border-amber-500/25 bg-amber-950/10 p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[11px] font-medium text-amber-200 flex items-center gap-1.5">
                      <Mic className="w-3 h-3 text-amber-400" />
                      Scene Narrator Voice
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void onAssignVoiceToAllScenes(activeScene.voiceId)}
                        className="text-[10px] text-amber-300 hover:underline"
                        title="Apply this voice to every scene in the project"
                      >
                        Apply to All Scenes
                      </button>
                      <button
                        type="button"
                        onClick={onOpenVoiceClone}
                        className="text-[10px] text-cyan-300 hover:underline"
                      >
                        + Add Voice
                      </button>
                    </div>
                  </div>
                  <select
                    aria-label="Scene Narrator Voice"
                    value={activeScene.voiceId}
                    onChange={(e) =>
                      void onUpdateScene(activeScene.id, { voiceId: e.target.value })
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none"
                  >
                    {!voices.some((v) => v.voice_id === activeScene.voiceId) && (
                      <option value={activeScene.voiceId}>{activeScene.voiceId}</option>
                    )}
                    {voices.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name} (
                        {v.source === 'native'
                          ? v.playbackMode === 'direct-sample' && v.sampleUrl
                            ? 'Native Clip'
                            : 'System Speech'
                          : v.source === 'elevenlabs'
                            ? 'ElevenLabs'
                            : 'System Speech'}
                        )
                      </option>
                    ))}
                  </select>

                  {selectedVoice?.source === 'native' && selectedVoice.sampleUrl && (
                    <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          void onUpdateScene(activeScene.id, { voicePlaybackMode: 'speak-script' })
                        }
                        className={`rounded-lg border py-1 px-2 text-[10px] font-medium transition ${
                          effectiveSceneMode === 'speak-script'
                            ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                            : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        Speak Script
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void onUpdateScene(activeScene.id, { voicePlaybackMode: 'direct-sample' })
                        }
                        className={`rounded-lg border py-1 px-2 text-[10px] font-medium transition ${
                          effectiveSceneMode === 'direct-sample'
                            ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                            : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        Use Recorded Clip
                      </button>
                    </div>
                  )}

                  <div className="text-[10px] text-zinc-400 leading-snug">
                    {selectedVoice?.source === 'elevenlabs'
                      ? 'Neural TTS synthesized via connected ElevenLabs account.'
                      : activeScene.voiceAudioUrl && effectiveSceneMode === 'direct-sample'
                        ? 'Using your per-scene recorded/attached audio take in timeline & export.'
                        : selectedVoice?.source === 'native' &&
                            effectiveSceneMode === 'direct-sample' &&
                            selectedVoice.sampleUrl
                          ? 'Plays your recorded/uploaded voice clip directly in timeline & video export.'
                          : 'Uses local system speech + DSP acoustic profile. Connect ElevenLabs for neural cloning.'}
                  </div>

                  {/* Per-Scene Frictionless Record Scene Take / Attach Audio Clip */}
                  <div className="pt-1.5 border-t border-amber-500/20 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        Record Scene Take / Attach Clip
                      </span>
                      {activeScene.voiceAudioUrl && (
                        <span className="text-[10px] text-emerald-300 font-medium">
                          Scene Take Active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={
                          recordingTake
                            ? stopSceneTakeRecording
                            : () => void startSceneTakeRecording()
                        }
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${
                          recordingTake
                            ? 'border-rose-500 bg-rose-600 text-white'
                            : 'border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200'
                        }`}
                      >
                        {recordingTake ? (
                          <>
                            <MicOff className="w-3 h-3" /> Stop ({takeSec}s)
                          </>
                        ) : (
                          <>
                            <Mic className="w-3 h-3" /> Record Scene Take
                          </>
                        )}
                      </button>

                      <label className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-2 py-1 text-[10px] font-medium text-zinc-200 cursor-pointer transition">
                        <Upload className="w-3 h-3 text-cyan-300" />
                        Attach Audio
                        <input
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) {
                              void onUploadSceneVoiceTake(activeScene.id, f);
                            }
                            e.target.value = '';
                          }}
                        />
                      </label>

                      {activeScene.voiceAudioUrl && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              void onPlaySampleUrl(activeScene.voiceAudioUrl!, activeScene.title)
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2 py-1 text-[10px] text-cyan-200"
                          >
                            <Play className="w-2.5 h-2.5" /> Play Take
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeleteSceneVoiceTake(activeScene.id)}
                            title="Clear Scene Take"
                            className="p-1 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-zinc-900"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Push to Provider + Native Voiceover */}
            <div className="pt-1 flex flex-col gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Push to Provider (with Character &amp; RAG Refs)
              </div>

              <button
                type="button"
                disabled={busyAction === 'higgsfield' || isPollingPush}
                onClick={() => void onTriggerHiggsfield(activeScene.id)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 py-2 text-xs font-medium text-cyan-200 transition disabled:opacity-60"
              >
                {busyAction === 'higgsfield' ||
                (isPollingPush && activePushJob?.provider === 'higgsfield') ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Camera className="w-3.5 h-3.5" />
                )}
                Generate Cinematic Scene with Higgsfield
              </button>

              <button
                type="button"
                disabled={busyAction === 'gemini_veo' || isPollingPush}
                onClick={() => void onPushSceneToProvider('gemini_veo', activeScene.id)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 py-2 text-xs font-medium text-indigo-200 transition disabled:opacity-60"
              >
                {busyAction === 'gemini_veo' ||
                (isPollingPush && activePushJob?.provider === 'gemini_veo') ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Push to Provider: Gemini Veo
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busyAction === 'tts'}
                  onClick={() =>
                    void onPreviewVoice(activeScene.voiceId, activeScene.narration, activeScene.id)
                  }
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 py-2 text-xs font-medium text-amber-200 transition disabled:opacity-60"
                >
                  {busyAction === 'tts' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                  Synthesize &amp; Preview Voiceover
                </button>
                <button
                  type="button"
                  disabled={busyAction === 'tts'}
                  onClick={() => void onDownloadSceneAudio(activeScene)}
                  title="Download Synthesized Voiceover Audio"
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 px-2.5 py-2 text-xs font-medium text-zinc-200 transition disabled:opacity-60"
                >
                  <Download className="w-3.5 h-3.5 text-amber-300" />
                </button>
              </div>

              {/* Job Status Box */}
              {activePushJob && (
                <div
                  className={`rounded-lg border p-2.5 text-[11px] space-y-1 ${
                    pushStatus === 'failed'
                      ? 'border-rose-500/40 bg-rose-950/25 text-rose-200'
                      : pushStatus === 'ready'
                        ? 'border-emerald-500/35 bg-emerald-950/20 text-emerald-200'
                        : 'border-zinc-800/80 bg-zinc-950 text-zinc-400'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1">
                      {pushStatus === 'failed' && <AlertCircle className="w-3 h-3 text-rose-400" />}
                      {pushStatus === 'ready' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                      {isPollingPush && <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />}
                      {activePushJob.provider}: {activePushJob.status}
                    </span>
                    {activePushJob.jobId && (
                      <span className="font-mono text-[10px] opacity-75 truncate max-w-[140px]">
                        {activePushJob.jobId}
                      </span>
                    )}
                  </div>
                  {activePushJob.renderNote && (
                    <div className="leading-relaxed">{activePushJob.renderNote}</div>
                  )}
                  {activePushJob.attachedMediaUrls && activePushJob.attachedMediaUrls.length > 0 && (
                    <div className="text-[10px] text-cyan-300/80">
                      Attached {activePushJob.attachedMediaUrls.length} reference file(s)
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'characters' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  Cloned Cast &amp; Presets
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Usable natively; optionally push to Higgsfield or Gemini Veo
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenCharacterClone}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1.5 text-xs font-medium text-white"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Clone
              </button>
            </div>

            <div className="space-y-2.5">
              {combinedCharacters.map((char) => {
                const isOnActiveScene = activeScene?.characterId === char.id;
                return (
                  <div
                    key={char.id}
                    data-testid={`draggable-character-${char.id}`}
                    {...makeDraggableProps({
                      kind: 'character',
                      characterId: char.id,
                      name: char.name,
                      voiceId: char.voiceId,
                    })}
                    className={`rounded-xl border p-2.5 transition cursor-grab active:cursor-grabbing ${
                      isOnActiveScene
                        ? 'border-cyan-500/50 bg-cyan-950/20'
                        : 'border-zinc-800 bg-zinc-950/70 hover:border-cyan-500/40'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <GripVertical className="w-3.5 h-3.5 text-zinc-600 shrink-0 mt-1" />
                      {char.sourceType === 'photos' && char.mediaUrls[0] ? (
                        <img
                          src={char.mediaUrls[0]}
                          alt={char.name}
                          className="w-11 h-11 rounded-lg object-cover border border-zinc-700 shrink-0"
                        />
                      ) : (
                        <div
                          className="w-11 h-11 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0"
                          style={{ backgroundColor: char.previewColor }}
                        >
                          {char.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-zinc-100 truncate">
                            {char.name}
                          </span>
                          <span className="text-[10px] rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 text-zinc-400">
                            {char.sourceType}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400 truncate">{char.role}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="text-[10px] rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
                            {char.stylePreset}
                          </span>
                          <span className="text-[10px] rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">
                            {char.traits.archetype}
                          </span>
                        </div>
                      </div>
                    </div>

                    {activeScene && (
                      <div className="mt-2.5 space-y-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            void onUpdateScene(activeScene.id, {
                              characterId: char.id,
                              ...(char.voiceId ? { voiceId: char.voiceId } : {}),
                            })
                          }
                          className="w-full rounded-lg border border-zinc-800 hover:border-cyan-500/50 bg-zinc-900/90 py-1.5 text-[11px] font-medium text-zinc-200 flex items-center justify-center gap-1"
                        >
                          {isOnActiveScene ? (
                            <>
                              <Check className="w-3 h-3 text-cyan-400" /> Assigned to Active Scene
                            </>
                          ) : (
                            'Assign to Active Scene'
                          )}
                        </button>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              void onPushSceneToProvider('higgsfield', activeScene.id, char.id)
                            }
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-950/30 hover:bg-cyan-900/40 py-1 text-[10px] font-medium text-cyan-200 transition"
                          >
                            <Send className="w-2.5 h-2.5" />
                            Push Higgsfield
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void onPushSceneToProvider('gemini_veo', activeScene.id, char.id)
                            }
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-indigo-500/35 bg-indigo-950/30 hover:bg-indigo-900/40 py-1 text-[10px] font-medium text-indigo-200 transition"
                          >
                            <Send className="w-2.5 h-2.5" />
                            Push Gemini Veo
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'voices' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  Studio &amp; Cloned Voices
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Source:{' '}
                  <span className="text-amber-300 font-medium">
                    {voiceSource === 'mock'
                      ? 'Native & Studio Voices'
                      : `ElevenLabs (${voiceSource}) + Native`}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenVoiceClone}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-500 hover:bg-amber-400 px-2.5 py-1.5 text-xs font-semibold text-zinc-950 transition shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Voice
              </button>
            </div>

            {!isElevenLabsConnected ? (
              <div className="rounded-xl border border-amber-500/35 bg-amber-950/20 p-3 space-y-2">
                <div className="text-xs font-semibold text-amber-200">
                  Local system speech &amp; direct clips active
                </div>
                <p className="text-[11px] text-amber-200/75 leading-relaxed">
                  Native voices use local system speech + traits or play your recorded audio clip
                  directly. Connect ElevenLabs for neural timbre cloning &amp; library voices.
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onOpenConnectModal('elevenlabs')}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-200 font-semibold py-1.5 text-xs transition"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    Connect ElevenLabs
                  </button>
                  {activeScene && (
                    <button
                      type="button"
                      disabled={busyAction === 'assign-voices'}
                      onClick={() => void onAssignVoiceToAllScenes(activeScene.voiceId)}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 transition"
                      title="Apply active scene voice to all scenes"
                    >
                      Apply All
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-200 min-w-0">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate font-medium">
                      {elevenLabsConnector?.account?.label || 'ElevenLabs Connected'}
                      {elevenLabsConnector?.account?.tier
                        ? ` (${elevenLabsConnector.account.tier})`
                        : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenConnectModal('elevenlabs')}
                    className="text-[10px] text-emerald-300 hover:underline shrink-0"
                  >
                    Account
                  </button>
                </div>

                {typeof elevenLabsConnector?.account?.remainingCharacters === 'number' &&
                  typeof elevenLabsConnector?.account?.characterLimit === 'number' && (
                    <div className="text-[10px] font-mono text-emerald-300/85">
                      {elevenLabsConnector.account.remainingCharacters.toLocaleString()} /{' '}
                      {elevenLabsConnector.account.characterLimit.toLocaleString()} chars remaining
                    </div>
                  )}

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busyAction === 'sync-voices'}
                    onClick={() => void onSyncElevenLabsVoices()}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 py-1 text-[11px] font-medium text-amber-200 transition"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${busyAction === 'sync-voices' ? 'animate-spin' : ''}`}
                    />
                    Sync ElevenLabs Voices
                  </button>
                  {activeScene && (
                    <button
                      type="button"
                      onClick={() => void onAssignVoiceToAllScenes(activeScene.voiceId)}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 transition"
                      title="Apply active voice to all scenes"
                    >
                      Apply All
                    </button>
                  )}
                </div>
              </div>
            )}

            {lastVoicePushResult && (
              <div className="rounded-xl border border-indigo-500/35 bg-indigo-950/25 p-2.5 text-[11px] text-indigo-200 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>{lastVoicePushResult.message}</span>
                </div>
                {lastVoicePushResult.workflowExport && (
                  <pre className="text-[9px] font-mono bg-zinc-950 border border-zinc-800 rounded p-2 overflow-x-auto text-zinc-300">
                    {JSON.stringify(lastVoicePushResult.workflowExport, null, 2)}
                  </pre>
                )}
              </div>
            )}

            <div className="space-y-2">
              {voices.map((v) => {
                const isSelected = activeScene?.voiceId === v.voice_id;
                const isPrimary = project.primaryVoiceId === v.voice_id;
                const isNative = v.source === 'native';
                return (
                  <div
                    key={v.voice_id}
                    data-testid={`draggable-voice-${v.voice_id}`}
                    {...makeDraggableProps({
                      kind: 'voice',
                      voiceId: v.voice_id,
                      name: v.name,
                      sampleUrl: v.sampleUrl,
                      playbackMode: v.playbackMode,
                    })}
                    className={`rounded-xl border p-2.5 space-y-2 cursor-grab active:cursor-grabbing transition ${
                      isPrimary || isSelected
                        ? 'border-amber-500/50 bg-amber-950/15'
                        : 'border-zinc-800 bg-zinc-950/70 hover:border-amber-500/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex items-start gap-1.5">
                        <GripVertical className="w-3.5 h-3.5 text-zinc-600 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-zinc-100 truncate">
                            {v.name}
                          </span>
                          <span
                            className={`text-[9px] rounded px-1 py-0.2 border shrink-0 ${
                              v.source === 'elevenlabs'
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                : isNative
                                  ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                                  : 'border-zinc-700 bg-zinc-900 text-zinc-400'
                            }`}
                          >
                            {v.source === 'elevenlabs'
                              ? 'ElevenLabs Neural'
                              : isNative
                                ? v.playbackMode === 'direct-sample' && v.sampleUrl
                                  ? 'Direct Clip'
                                  : 'Native DSP Clone'
                                : 'System Speech'}
                          </span>
                          {isPrimary && (
                            <span className="text-[9px] rounded px-1.5 py-0.2 border border-emerald-400/50 bg-emerald-500/15 text-emerald-200 font-semibold shrink-0">
                              Active Explainer Voice
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-zinc-400 truncate">
                          {v.acousticSignature
                            ? `${v.acousticSignature.f0Hz} Hz • ${v.acousticSignature.warmth}% warmth • ${v.acousticSignature.speakingRateWpm} WPM`
                            : Object.values(v.labels).slice(0, 4).join(' • ') || v.category}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            void onPreviewVoice(
                              v.voice_id,
                              `Hello, I am ${v.name}. Ready to narrate your technical explainer.`
                            )
                          }
                          className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200"
                          title="Preview Voice"
                        >
                          <Play className="w-3 h-3" />
                        </button>
                        {!isPrimary && (
                          <button
                            type="button"
                            onClick={() => void onAssignVoiceToAllScenes(v.voice_id)}
                            className="px-2 py-1 rounded-lg text-[10px] font-semibold border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200"
                            title="Bind as primary voice and apply to all scenes"
                          >
                            Set Active
                          </button>
                        )}
                        {activeScene && (
                          <button
                            type="button"
                            onClick={() =>
                              void onUpdateScene(activeScene.id, { voiceId: v.voice_id })
                            }
                            className={`px-2 py-1 rounded-lg text-[11px] font-medium border ${
                              isSelected
                                ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                                : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                            }`}
                          >
                            {isSelected ? 'Scene Active' : 'Scene'}
                          </button>
                        )}
                      </div>
                      </div>
                    </div>

                    {isNative && (
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800/70 flex-wrap">
                        <span className="text-[10px] text-zinc-400">
                          {v.elevenlabsVoiceId
                            ? `Synced: ${v.elevenlabsVoiceId}`
                            : v.sampleUrl
                              ? v.playbackMode === 'direct-sample'
                                ? 'Direct sample clip active'
                                : 'Clip saved • Speak Script mode'
                              : 'System speech + traits'}
                        </span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {v.sampleUrl && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  void onUpdateVoice(v.voice_id, {
                                    playbackMode:
                                      v.playbackMode === 'direct-sample'
                                        ? 'speak-script'
                                        : 'direct-sample',
                                  })
                                }
                                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition ${
                                  v.playbackMode === 'direct-sample'
                                    ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                                    : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                                }`}
                                title="Switch between Direct Recorded Clip and Speak Script mode"
                              >
                                {v.playbackMode === 'direct-sample'
                                  ? 'Mode: Direct Clip'
                                  : 'Mode: Speak Script'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void onPlaySampleUrl(v.sampleUrl!, v.name)}
                                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-2 py-1 text-[10px] font-medium text-zinc-200 transition"
                                title="Play uploaded/recorded sample"
                              >
                                <Volume2 className="w-2.5 h-2.5 text-cyan-300" />
                                Sample
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            disabled={busyAction === `push-voice-${v.voice_id}`}
                            onClick={() => void onPushVoiceToElevenLabs(v.voice_id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 text-[10px] font-medium text-amber-200 transition"
                          >
                            {busyAction === `push-voice-${v.voice_id}` ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            ) : (
                              <Send className="w-2.5 h-2.5" />
                            )}
                            {v.pushStatus === 'pushed' ? 'Re-push' : 'Push to ElevenLabs'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeleteVoice(v.voice_id)}
                            title="Delete Custom Voice"
                            className="p-1 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-zinc-900 transition"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'sources' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  Presentations &amp; NotebookLM Sources
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Import .pptx decks, Briefing Docs, or Audio Overviews
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenSourceImport}
                className="inline-flex items-center gap-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-2.5 py-1.5 text-xs font-semibold text-white shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Import
              </button>
            </div>

            {sources.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/60 p-4 text-center space-y-2">
                <BookOpen className="w-6 h-6 text-cyan-400 mx-auto" />
                <div className="text-xs font-medium text-zinc-200">
                  No PPTX or NotebookLM sources imported yet
                </div>
                <p className="text-[11px] text-zinc-500">
                  Upload a PowerPoint deck or NotebookLM Briefing Doc to map slides &amp; speaker notes 1-to-1 into scenes.
                </p>
                <button
                  type="button"
                  onClick={onOpenSourceImport}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 px-3 py-1.5 text-xs font-medium text-cyan-200"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Import PPTX / NotebookLM
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {sources.map((src) => {
                  const isExpanded = expandedSourceId === src.id;
                  return (
                    <div
                      key={src.id}
                      data-testid={`draggable-source-${src.id}`}
                      {...makeDraggableProps({
                        kind: 'source',
                        sourceId: src.id,
                        name: src.name,
                        sourceType: src.sourceType,
                      })}
                      className="rounded-xl border border-zinc-800 hover:border-cyan-500/40 bg-zinc-950/80 p-2.5 space-y-2 cursor-grab active:cursor-grabbing transition"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex items-start gap-1.5">
                          <GripVertical className="w-3.5 h-3.5 text-zinc-600 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] uppercase rounded px-1.5 py-0.5 bg-cyan-500/15 border border-cyan-500/35 text-cyan-200 font-semibold shrink-0">
                                {src.sourceType}
                              </span>
                              <span className="text-xs font-semibold text-zinc-100 truncate">
                                {src.name}
                              </span>
                            </div>
                            <div className="text-[10px] text-zinc-400 mt-0.5">{src.summary}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedSourceId(isExpanded ? null : src.id)
                            }
                            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                            title={isExpanded ? 'Collapse slides' : 'View slides & notes'}
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeleteSource(src.id)}
                            className="p-1 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-zinc-900"
                            title="Delete source"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {src.audioUrl && (
                        <audio src={src.audioUrl} controls className="w-full h-8" />
                      )}

                      {isExpanded && (
                        <div className="space-y-1.5 pt-1 border-t border-zinc-800/80 max-h-56 overflow-y-auto">
                          {src.slides.map((sl) => (
                            <div
                              key={sl.index}
                              {...makeDraggableProps({
                                kind: 'source-slide',
                                sourceId: src.id,
                                slideIndex: sl.index,
                                title: sl.title,
                              })}
                              className="rounded-lg border border-zinc-800/80 hover:border-cyan-500/40 bg-zinc-900/60 p-2 space-y-1 cursor-grab active:cursor-grabbing"
                            >
                              <div className="text-[11px] font-semibold text-cyan-200">
                                {sl.index}. {sl.title}
                              </div>
                              {sl.bullets.length > 0 && (
                                <ul className="list-disc list-inside text-[10px] text-zinc-300 space-y-0.5">
                                  {sl.bullets.slice(0, 3).map((b, bi) => (
                                    <li key={bi} className="truncate">
                                      {b}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {sl.speakerNotes && (
                                <div className="text-[10px] text-zinc-400 italic line-clamp-2">
                                  Notes: {sl.speakerNotes}
                                </div>
                              )}
                              {sl.imageUrls.length > 0 && (
                                <div className="flex gap-1.5 pt-0.5">
                                  {sl.imageUrls.map((u) => (
                                    <img
                                      key={u}
                                      src={u}
                                      alt={sl.title}
                                      className="w-14 h-9 rounded object-cover border border-zinc-700"
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      <button
                        type="button"
                        disabled={busyAction === 'generate'}
                        onClick={() => void onGenerateFromSource(src)}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/35 border border-indigo-500/40 py-1.5 text-[11px] font-semibold text-indigo-100 transition disabled:opacity-50"
                      >
                        <Sparkles className="w-3 h-3" />
                        Generate Explainer from Source ({src.slides.length} scenes)
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'assets' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  Assets &amp; RAG Context Vault
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Tech photos &amp; clips auto-retrieved for scenes &amp; prompts
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {activeScene && (
                  <button
                    type="button"
                    disabled={busyAction === 'generate-visual'}
                    onClick={() => void onGenerateSceneVisual(activeScene.id, 'auto')}
                    className="inline-flex items-center gap-1 rounded-lg bg-cyan-600/25 hover:bg-cyan-600/35 border border-cyan-500/40 px-2 py-1.5 text-[11px] font-medium text-cyan-200"
                    title="Generate a native SVG diagram for the active scene"
                  >
                    <Wand2 className="w-3 h-3" />
                    SVG
                  </button>
                )}
                <button
                  type="button"
                  onClick={onOpenAssetUpload}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1.5 text-xs font-medium text-white shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Asset
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              {assets.map((asset) => {
                const isAttached = activeScene?.assetIds?.includes(asset.id) ?? false;
                return (
                  <div
                    key={asset.id}
                    data-testid={`draggable-asset-${asset.id}`}
                    {...makeDraggableProps({
                      kind: 'asset',
                      assetId: asset.id,
                      name: asset.name,
                      sourceType: asset.sourceType,
                      mediaUrl: asset.mediaUrls[0],
                    })}
                    className={`rounded-xl border p-2.5 space-y-2 cursor-grab active:cursor-grabbing transition ${
                      isAttached
                        ? 'border-indigo-500/50 bg-indigo-950/20'
                        : 'border-zinc-800 bg-zinc-950/70 hover:border-indigo-500/40'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="w-3.5 h-3.5 text-zinc-600 shrink-0 mt-1" />
                      {asset.sourceType === 'photos' && asset.mediaUrls[0] ? (
                        <img
                          src={asset.mediaUrls[0]}
                          alt={asset.name}
                          className="w-12 h-12 rounded-lg object-cover border border-zinc-700 shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-indigo-950/60 border border-indigo-500/30 flex items-center justify-center shrink-0">
                          <Video className="w-5 h-5 text-indigo-300" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="text-xs font-semibold text-zinc-100 truncate">
                            {asset.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => void onDeleteAsset(asset.id)}
                            title="Delete Asset"
                            className="text-zinc-500 hover:text-rose-400 p-0.5"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-[10px] text-cyan-300">{asset.category}</div>
                        <div className="text-[10px] text-zinc-400 line-clamp-2 mt-0.5">
                          {asset.technicalSpecs || asset.description}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {asset.tags.slice(0, 5).map((tag) => (
                        <span
                          key={tag}
                          className="text-[9px] rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 text-zinc-400"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>

                    {activeScene && (
                      <button
                        type="button"
                        onClick={() => void toggleAssetOnActiveScene(asset.id)}
                        className={`w-full rounded-lg border py-1.5 text-[11px] font-medium flex items-center justify-center gap-1 transition ${
                          isAttached
                            ? 'border-indigo-400/50 bg-indigo-500/20 text-indigo-200'
                            : 'border-zinc-800 bg-zinc-900 hover:border-indigo-500/40 text-zinc-300'
                        }`}
                      >
                        {isAttached ? (
                          <>
                            <Check className="w-3 h-3 text-indigo-300" /> Attached to Scene
                          </>
                        ) : (
                          'Attach to Active Scene'
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'music' && (
          <div className="space-y-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                Soundtrack &amp; Audio Beds
              </h3>
              <p className="text-[11px] text-zinc-500">
                Auto-ducked under narration on the Music timeline track
              </p>
            </div>

            <form
              onSubmit={handleAddMusic}
              className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-2.5 space-y-2"
            >
              <input
                type="text"
                value={musicTitle}
                onChange={(e) => setMusicTitle(e.target.value)}
                placeholder="Track title"
                className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100"
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={musicMood}
                  onChange={(e) => setMusicMood(e.target.value)}
                  placeholder="Mood"
                  className="col-span-1 rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1 text-xs text-zinc-100"
                />
                <input
                  type="number"
                  min={60}
                  max={180}
                  value={musicBpm}
                  onChange={(e) => setMusicBpm(Number(e.target.value))}
                  className="rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1 text-xs text-zinc-100"
                />
                <input
                  type="number"
                  min={-36}
                  max={0}
                  value={musicDb}
                  onChange={(e) => setMusicDb(Number(e.target.value))}
                  className="rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1 text-xs text-zinc-100"
                />
              </div>
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 py-1.5 text-xs font-medium text-emerald-200"
              >
                <Plus className="w-3.5 h-3.5" /> Add Soundtrack Track
              </button>
            </form>

            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Draggable Music Presets (Drop onto Music Track)
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {STUDIO_MUSIC_PRESETS.map((preset) => (
                  <div
                    key={preset.title}
                    data-testid={`draggable-music-preset-${preset.title.toLowerCase().replace(/\s+/g, '-')}`}
                    {...makeDraggableProps({
                      kind: 'music-preset',
                      title: preset.title,
                      mood: preset.mood,
                      bpm: preset.bpm,
                      volumeDb: preset.volumeDb,
                      accentColor: preset.accentColor,
                    })}
                    className="rounded-lg border border-zinc-800 hover:border-emerald-500/50 bg-zinc-950/80 px-2.5 py-2 flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing transition"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <GripVertical className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: preset.accentColor }}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-zinc-100 truncate">
                          {preset.title}
                        </div>
                        <div className="text-[10px] text-zinc-400 truncate">
                          {preset.mood} • {preset.bpm} BPM • {preset.volumeDb} dB
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const totalSec = project.scenes.reduce((s, sc) => s + sc.durationSec, 0);
                        void onAddMusicTrack({
                          title: preset.title,
                          mood: preset.mood,
                          bpm: preset.bpm,
                          startTimeSec: 0,
                          durationSec: Math.max(20, Math.round(totalSec / 2)),
                          volumeDb: preset.volumeDb,
                          duckUnderVoice: true,
                          accentColor: preset.accentColor,
                        });
                      }}
                      className="px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-[10px] font-medium text-emerald-200 shrink-0"
                    >
                      + Add
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {project.musicTracks.map((track) => {
                const isSelectedTrack = selectedMusicTrackId === track.id;
                return (
                  <div
                    key={track.id}
                    className={`rounded-xl border p-2.5 space-y-2 transition ${
                      isSelectedTrack
                        ? 'border-emerald-400/70 bg-emerald-950/25'
                        : 'border-zinc-800 bg-zinc-950/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-100 truncate">
                          {track.title}
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          {track.mood} • {track.bpm} BPM • {track.volumeDb} dB • {track.startTimeSec}s–
                          {track.startTimeSec + track.durationSec}s
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onDeleteMusicTrack(track.id)}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-zinc-900"
                        title="Remove Track"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {isSelectedTrack && onUpdateMusicTrack && (
                      <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-emerald-500/20">
                        <label className="text-[10px] text-zinc-400">
                          Start (s)
                          <input
                            type="number"
                            min={0}
                            value={track.startTimeSec}
                            onChange={(e) =>
                              void onUpdateMusicTrack(track.id, {
                                startTimeSec: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className="mt-0.5 w-full rounded bg-zinc-900 border border-zinc-700 px-1.5 py-1 text-[11px] font-mono text-zinc-100"
                          />
                        </label>
                        <label className="text-[10px] text-zinc-400">
                          Dur (s)
                          <input
                            type="number"
                            min={5}
                            value={track.durationSec}
                            onChange={(e) =>
                              void onUpdateMusicTrack(track.id, {
                                durationSec: Math.max(5, Number(e.target.value) || 5),
                              })
                            }
                            className="mt-0.5 w-full rounded bg-zinc-900 border border-zinc-700 px-1.5 py-1 text-[11px] font-mono text-zinc-100"
                          />
                        </label>
                        <label className="text-[10px] text-zinc-400">
                          Vol (dB)
                          <input
                            type="number"
                            min={-40}
                            max={0}
                            value={track.volumeDb}
                            onChange={(e) =>
                              void onUpdateMusicTrack(track.id, {
                                volumeDb: Math.max(-40, Math.min(0, Number(e.target.value) || -16)),
                              })
                            }
                            className="mt-0.5 w-full rounded bg-zinc-900 border border-zinc-700 px-1.5 py-1 text-[11px] font-mono text-zinc-100"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
