import { useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  Database,
  Download,
  Film,
  Loader2,
  LogIn,
  Mic,
  Music,
  Play,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  User,
  UserPlus,
  Video,
  Volume2,
} from 'lucide-react';
import type {
  CameraMotionPreset,
  CharacterPlacement,
  CharacterProfile,
  CinematicStyle,
  ConnectorDescriptor,
  ConnectorId,
  ExplainerProject,
  MusicTrack,
  PushVoiceElevenLabsResult,
  SceneItem,
  SceneVisualOverlay,
  TechAsset,
  TransitionType,
  VoicePlaybackMode,
  VoiceProfile,
} from '@shared/types';

type InspectorTab = 'scene' | 'characters' | 'voices' | 'assets' | 'music';

interface InspectorPanelProps {
  project: ExplainerProject;
  activeScene: SceneItem | undefined;
  voices: VoiceProfile[];
  voiceSource: 'env' | 'vault' | 'session' | 'mock';
  connectors: ConnectorDescriptor[];
  allCharacters: CharacterProfile[];
  assets: TechAsset[];
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
  onOpenConnectModal: (id: ConnectorId) => void;
  onOpenCharacterClone: () => void;
  onOpenVoiceClone: () => void;
  onOpenAssetUpload: () => void;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onAddMusicTrack: (track: Omit<MusicTrack, 'id'>) => Promise<void>;
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
  onOpenConnectModal,
  onOpenCharacterClone,
  onOpenVoiceClone,
  onOpenAssetUpload,
  onDeleteAsset,
  onAddMusicTrack,
  onDeleteMusicTrack,
  busyAction,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<InspectorTab>('scene');
  const [musicTitle, setMusicTitle] = useState('Neural Drift');
  const [musicMood, setMusicMood] = useState('Ambient Tech');
  const [musicBpm, setMusicBpm] = useState(110);
  const [musicDb, setMusicDb] = useState(-15);

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
      {/* 5 Tabs */}
      <div className="grid grid-cols-5 border-b border-zinc-800/90 bg-zinc-950/70 p-1 gap-1">
        {(
          [
            { id: 'scene', label: 'Scene', icon: Film },
            { id: 'characters', label: 'Cast', icon: User },
            { id: 'voices', label: 'Voices', icon: Mic },
            { id: 'assets', label: 'Assets', icon: Database },
            { id: 'music', label: 'Music', icon: Music },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] font-medium transition ${
              tab === id
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
            }`}
          >
            <Icon className="w-3 h-3 shrink-0" />
            <span>{label}</span>
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

            <div className="grid grid-cols-2 gap-2.5">
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
                      : selectedVoice?.source === 'native' &&
                          effectiveSceneMode === 'direct-sample' &&
                          selectedVoice.sampleUrl
                        ? 'Plays your recorded/uploaded voice clip directly in timeline & video export.'
                        : 'Uses local system speech + voice traits. Connect ElevenLabs for neural timbre cloning.'}
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
                    className={`rounded-xl border p-2.5 transition ${
                      isOnActiveScene
                        ? 'border-cyan-500/50 bg-cyan-950/20'
                        : 'border-zinc-800 bg-zinc-950/70'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
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
                const isNative = v.source === 'native';
                return (
                  <div
                    key={v.voice_id}
                    className={`rounded-xl border p-2.5 space-y-2 ${
                      isSelected
                        ? 'border-amber-500/50 bg-amber-950/15'
                        : 'border-zinc-800 bg-zinc-950/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
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
                                  : 'System Speech + Traits'
                                : 'System Speech'}
                          </span>
                        </div>
                        <div className="text-[10px] text-zinc-400 truncate">
                          {Object.values(v.labels).slice(0, 4).join(' • ') || v.category}
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
                            {isSelected ? 'Active' : 'Use'}
                          </button>
                        )}
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
              <button
                type="button"
                onClick={onOpenAssetUpload}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1.5 text-xs font-medium text-white shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Asset
              </button>
            </div>

            <div className="space-y-2.5">
              {assets.map((asset) => {
                const isAttached = activeScene?.assetIds?.includes(asset.id) ?? false;
                return (
                  <div
                    key={asset.id}
                    className={`rounded-xl border p-2.5 space-y-2 ${
                      isAttached
                        ? 'border-indigo-500/50 bg-indigo-950/20'
                        : 'border-zinc-800 bg-zinc-950/70'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
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

            <div className="space-y-2">
              {project.musicTracks.map((track) => (
                <div
                  key={track.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-zinc-100 truncate">
                      {track.title}
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      {track.mood} • {track.bpm} BPM • {track.volumeDb} dB
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
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
