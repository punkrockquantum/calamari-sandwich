import { useState } from 'react';
import {
  Camera,
  Check,
  Film,
  Loader2,
  Mic,
  Music,
  Play,
  Plus,
  Sparkles,
  Trash2,
  User,
  UserPlus,
  Volume2,
} from 'lucide-react';
import type {
  CameraMotionPreset,
  CharacterPlacement,
  CharacterProfile,
  CinematicStyle,
  ExplainerProject,
  MusicTrack,
  SceneItem,
  SceneVisualOverlay,
  TransitionType,
  VoiceProfile,
} from '@shared/types';

type InspectorTab = 'scene' | 'characters' | 'voices' | 'music';

interface InspectorPanelProps {
  project: ExplainerProject;
  activeScene: SceneItem | undefined;
  voices: VoiceProfile[];
  voiceSource: 'env' | 'session' | 'mock';
  allCharacters: CharacterProfile[];
  onUpdateScene: (sceneId: string, patch: Partial<SceneItem>) => Promise<void>;
  onTriggerHiggsfield: (sceneId: string) => Promise<void>;
  onPreviewVoice: (voiceId: string, sampleText?: string, sceneId?: string) => Promise<void>;
  onOpenCharacterClone: () => void;
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
  allCharacters,
  onUpdateScene,
  onTriggerHiggsfield,
  onPreviewVoice,
  onOpenCharacterClone,
  onAddMusicTrack,
  onDeleteMusicTrack,
  busyAction,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<InspectorTab>('scene');
  const [musicTitle, setMusicTitle] = useState('Neural Drift');
  const [musicMood, setMusicMood] = useState('Ambient Tech');
  const [musicBpm, setMusicBpm] = useState(110);
  const [musicDb, setMusicDb] = useState(-15);

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

  return (
    <aside className="w-full lg:w-[360px] xl:w-[390px] shrink-0 bg-[#0d0d14] border border-zinc-800/90 rounded-xl flex flex-col overflow-hidden">
      {/* Tabs */}
      <div className="grid grid-cols-4 border-b border-zinc-800/90 bg-zinc-950/70 p-1 gap-1">
        {(
          [
            { id: 'scene', label: 'Scene', icon: Film },
            { id: 'characters', label: 'Cast', icon: User },
            { id: 'voices', label: 'Voices', icon: Mic },
            { id: 'music', label: 'Music', icon: Music },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition ${
              tab === id
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
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
                Higgsfield Visual Prompt
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

            <div className="pt-1 flex flex-col gap-2">
              <button
                type="button"
                disabled={busyAction === 'higgsfield'}
                onClick={() => void onTriggerHiggsfield(activeScene.id)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 py-2 text-xs font-medium text-cyan-200 transition"
              >
                {busyAction === 'higgsfield' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Camera className="w-3.5 h-3.5" />
                )}
                Render Scene with Higgsfield
              </button>

              <button
                type="button"
                disabled={busyAction === 'tts'}
                onClick={() =>
                  void onPreviewVoice(activeScene.voiceId, activeScene.narration, activeScene.id)
                }
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 py-2 text-xs font-medium text-amber-200 transition"
              >
                {busyAction === 'tts' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
                Synthesize & Preview Voiceover
              </button>

              {activeScene.higgsfield.renderNote && (
                <div className="rounded-lg bg-zinc-950 border border-zinc-800/80 p-2 text-[11px] text-zinc-400">
                  {activeScene.higgsfield.renderNote}
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
                  Cloned Cast & Presets
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Reusable characters cloned from photos or video
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
                      <button
                        type="button"
                        onClick={() =>
                          void onUpdateScene(activeScene.id, { characterId: char.id })
                        }
                        className="mt-2.5 w-full rounded-lg border border-zinc-800 hover:border-cyan-500/50 bg-zinc-900/90 py-1.5 text-[11px] font-medium text-zinc-200 flex items-center justify-center gap-1"
                      >
                        {isOnActiveScene ? (
                          <>
                            <Check className="w-3 h-3 text-cyan-400" /> Assigned to Active Scene
                          </>
                        ) : (
                          'Assign to Active Scene'
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'voices' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  ElevenLabs Voice Library
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Source:{' '}
                  <span className="text-amber-300 font-medium">
                    {voiceSource === 'mock'
                      ? 'Studio Demo Fallback'
                      : `ElevenLabs (${voiceSource})`}
                  </span>
                </p>
              </div>
              <Sparkles className="w-4 h-4 text-amber-400" />
            </div>

            <div className="space-y-2">
              {voices.map((v) => {
                const isSelected = activeScene?.voiceId === v.voice_id;
                return (
                  <div
                    key={v.voice_id}
                    className={`rounded-xl border p-2.5 ${
                      isSelected
                        ? 'border-amber-500/50 bg-amber-950/15'
                        : 'border-zinc-800 bg-zinc-950/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-100 truncate">
                          {v.name}
                        </div>
                        <div className="text-[10px] text-zinc-400 truncate">
                          {Object.values(v.labels).slice(0, 3).join(' • ') || v.category}
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
                Soundtrack & Audio Beds
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
