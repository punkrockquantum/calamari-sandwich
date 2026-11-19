import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Layers,
  Loader2,
  Mic,
  Music,
  Play,
  Plus,
  Sparkles,
  Upload,
  UserPlus,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import type {
  AudienceLevel,
  CharacterProfile,
  CinematicStyle,
  GenerateProjectRequest,
  ImportedSource,
  NativeVisualDiagramType,
  SceneAnimationPreset,
  TechAsset,
  VoicePlaybackMode,
  VoiceProfile,
  VoiceTraits,
  WizardMusicPreset,
} from '@shared/types';
import { studioApi } from '@/lib/api';
import { STUDIO_MUSIC_PRESETS } from '@/components/InspectorPanel';

interface ExplainerWizardModalProps {
  open: boolean;
  voices: VoiceProfile[];
  sources: ImportedSource[];
  assets: TechAsset[];
  characters: CharacterProfile[];
  activeVoiceId?: string;
  onClose: () => void;
  onAssemble: (payload: GenerateProjectRequest) => Promise<void>;
  onCloneVoice: (
    formData: FormData,
    options?: { setAsActiveExplainerVoice: boolean }
  ) => Promise<VoiceProfile | void>;
  onImportPptx: (formData: FormData) => Promise<ImportedSource | undefined>;
  onImportNotebookLm: (
    payload: FormData | { name?: string; rawText: string }
  ) => Promise<ImportedSource | undefined>;
  onPreviewVoice: (voiceId: string, sampleText?: string) => Promise<void>;
  onOpenCharacterClone: () => void;
  onAssetCreated?: (asset: TechAsset) => void;
  busy: boolean;
}

const STEPS = [
  { id: 1, title: 'Prompt & Goal' },
  { id: 2, title: 'Sources' },
  { id: 3, title: 'Voice & Cast' },
  { id: 4, title: 'Visuals & Animation' },
  { id: 5, title: 'Assemble & Review' },
] as const;

const DURATION_PRESETS = [1, 2, 3, 5, 10, 15, 30];

const SAMPLE_PROMPTS = [
  'How Transformer Attention & KV Caching Scale LLMs',
  'Zero-Knowledge Proofs (zk-SNARKs) Visually Explained',
  'Distributed Raft Consensus & Leader Election',
  'gRPC HTTP/2 Multiplexing vs REST JSON Polling',
];

const CINEMATIC_STYLES: CinematicStyle[] = [
  'Neon Lab',
  'Anamorphic Studio',
  'Blueprint Isometric',
  'Editorial Documentary',
  'Quantum Noir',
];

const ANIMATION_PRESETS: Array<{ value: SceneAnimationPreset; label: string; desc: string }> = [
  { value: 'diagram-flow', label: 'Diagram Flow', desc: 'Animated node-and-edge pipelines' },
  { value: 'kinetic-cards', label: 'Kinetic Cards', desc: 'Crisp sliding takeaway cards' },
  { value: 'slide-deck-reveal', label: 'Slide Deck Reveal', desc: 'Scan-lit slide & SVG spotlight' },
  { value: 'data-pulse', label: 'Data Pulse', desc: 'Telemetry wave rings & metric beats' },
  { value: 'split-comparison', label: 'Split Comparison', desc: 'Side-by-side tradeoff bars' },
  { value: 'timeline-walkthrough', label: 'Timeline Walkthrough', desc: 'Step-by-step milestone arc' },
  { value: 'particle-network', label: 'Particle Network', desc: 'Connected mesh topology' },
];

const DIAGRAM_TYPES: Array<{ value: NativeVisualDiagramType; label: string }> = [
  { value: 'auto', label: 'Auto-Detect from Prompt' },
  { value: 'architecture', label: 'Architecture Diagram' },
  { value: 'flow', label: 'Sequence / Flow' },
  { value: 'comparison', label: 'Comparison Matrix' },
  { value: 'infographic', label: 'Metric Infographic' },
  { value: 'hardware', label: 'Hardware / Cloud Topology' },
];

export function ExplainerWizardModal({
  open,
  voices,
  sources,
  assets,
  characters,
  activeVoiceId,
  onClose,
  onAssemble,
  onCloneVoice,
  onImportPptx,
  onImportNotebookLm,
  onPreviewVoice,
  onOpenCharacterClone,
  onAssetCreated,
  busy,
}: ExplainerWizardModalProps) {
  const [step, setStep] = useState<number>(1);

  // Step 1: Prompt & Goal
  const [topic, setTopic] = useState(SAMPLE_PROMPTS[0]);
  const [durationMinutes, setDurationMinutes] = useState(3);
  const [audience, setAudience] = useState<AudienceLevel>('engineering');
  const [cinematicStyle, setCinematicStyle] = useState<CinematicStyle>('Neon Lab');

  // Step 2: Sources & RAG Assets
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [nlmName, setNlmName] = useState('');
  const [nlmNotes, setNlmNotes] = useState('');
  const [sourceUploading, setSourceUploading] = useState(false);

  // Step 3: Voice & Cast
  const [selectedVoiceId, setSelectedVoiceId] = useState(
    activeVoiceId || voices[0]?.voice_id || 'mock-rachel'
  );
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>(() =>
    characters.slice(0, 2).map((c) => c.id)
  );
  const [showAddVoice, setShowAddVoice] = useState(false);
  const [newVoiceName, setNewVoiceName] = useState('');
  const [newVoicePlaybackMode, setNewVoicePlaybackMode] =
    useState<VoicePlaybackMode>('speak-script');
  const [newVoiceFile, setNewVoiceFile] = useState<File | null>(null);
  const [newVoiceTone, setNewVoiceTone] = useState('Warm & Articulate');
  const [newVoicePitch, setNewVoicePitch] = useState<VoiceTraits['pitch']>('medium');
  const [newVoiceCadence, setNewVoiceCadence] =
    useState<VoiceTraits['cadence']>('conversational');
  const [cloningVoiceBusy, setCloningVoiceBusy] = useState(false);

  // Step 4: Visuals & Animation
  const [animationPreset, setAnimationPreset] =
    useState<SceneAnimationPreset>('diagram-flow');
  const [diagramType, setDiagramType] = useState<NativeVisualDiagramType>('auto');
  const [autoGenerateVisuals, setAutoGenerateVisuals] = useState(true);
  const [previewSvgUrl, setPreviewSvgUrl] = useState<string | null>(null);
  const [generatingPreviewSvg, setGeneratingPreviewSvg] = useState(false);
  const [selectedMusicPreset, setSelectedMusicPreset] = useState<WizardMusicPreset | null>(
    STUDIO_MUSIC_PRESETS[0]
  );

  const [error, setError] = useState<string | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;
    setError(null);
    if (activeVoiceId && voices.some((v) => v.voice_id === activeVoiceId)) {
      setSelectedVoiceId(activeVoiceId);
    } else if (voices[0]) {
      setSelectedVoiceId((prev) =>
        voices.some((v) => v.voice_id === prev) ? prev : voices[0].voice_id
      );
    }
    if (selectedCharacterIds.length === 0 && characters.length > 0) {
      setSelectedCharacterIds(characters.slice(0, 2).map((c) => c.id));
    }
  }, [open, activeVoiceId, voices, characters, selectedCharacterIds.length]);

  if (!open) return null;

  const toggleId = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const handleUploadSourceFile = async (file: File) => {
    setError(null);
    setSourceUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', file.name.replace(/\.[^.]+$/, ''));
      const imported = file.name.toLowerCase().endsWith('.pptx')
        ? await onImportPptx(fd)
        : await onImportNotebookLm(fd);
      if (imported) {
        setSelectedSourceIds((prev) =>
          prev.includes(imported.id) ? prev : [imported.id, ...prev]
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import source.');
    } finally {
      setSourceUploading(false);
    }
  };

  const handleAddNotebookLmNotes = async () => {
    if (!nlmNotes.trim()) return;
    setError(null);
    setSourceUploading(true);
    try {
      const imported = await onImportNotebookLm({
        name: nlmName.trim() || 'Wizard NotebookLM Notes',
        rawText: nlmNotes.trim(),
      });
      if (imported) {
        setSelectedSourceIds((prev) =>
          prev.includes(imported.id) ? prev : [imported.id, ...prev]
        );
        setNlmName('');
        setNlmNotes('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import NotebookLM notes.');
    } finally {
      setSourceUploading(false);
    }
  };

  const handleInlineCreateVoice = async () => {
    if (newVoiceName.trim().length < 2) {
      setError('Enter a voice name (at least 2 characters).');
      return;
    }
    if (newVoicePlaybackMode === 'direct-sample' && !newVoiceFile) {
      setError('Attach an audio/video clip to use Direct Clip mode, or switch to Speak Script.');
      return;
    }
    setError(null);
    setCloningVoiceBusy(true);
    try {
      const fd = new FormData();
      fd.append('name', newVoiceName.trim());
      fd.append('tone', newVoiceTone);
      fd.append('pitch', newVoicePitch);
      fd.append('warmth', '75');
      fd.append('cadence', newVoiceCadence);
      fd.append('playbackMode', newVoiceFile ? newVoicePlaybackMode : 'speak-script');
      fd.append('setAsActiveExplainerVoice', 'false');
      if (newVoiceFile) {
        fd.append('sample', newVoiceFile);
      }
      const created = await onCloneVoice(fd, { setAsActiveExplainerVoice: false });
      if (created && 'voice_id' in created) {
        setSelectedVoiceId(created.voice_id);
      }
      setNewVoiceName('');
      setNewVoiceFile(null);
      setShowAddVoice(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add voice.');
    } finally {
      setCloningVoiceBusy(false);
    }
  };

  const handleGeneratePreviewVisual = async () => {
    if (!topic.trim()) return;
    setError(null);
    setGeneratingPreviewSvg(true);
    try {
      const res = await studioApi.generateNativeVisual({
        prompt: topic.trim(),
        title: topic.trim().slice(0, 64),
        style: cinematicStyle,
        diagramType,
      });
      setPreviewSvgUrl(res.visualUrl);
      onAssetCreated?.(res.asset);
      setSelectedAssetIds((prev) =>
        prev.includes(res.asset.id) ? prev : [res.asset.id, ...prev]
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate preview SVG.');
    } finally {
      setGeneratingPreviewSvg(false);
    }
  };

  const handleAssemble = async () => {
    if (topic.trim().length < 2) {
      setError('Enter a topic prompt in Step 1.');
      setStep(1);
      return;
    }
    setError(null);
    await onAssemble({
      topic: topic.trim(),
      durationMinutes,
      audience,
      primaryVoiceId: selectedVoiceId,
      characterIds: selectedCharacterIds.length > 0 ? selectedCharacterIds : undefined,
      assetIds: selectedAssetIds.length > 0 ? selectedAssetIds : undefined,
      sourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : undefined,
      autoGenerateVisuals,
      cinematicStyle,
      animationPreset,
      diagramType,
      musicPreset: selectedMusicPreset || undefined,
    });
    setStep(1);
    onClose();
  };

  const selectedVoiceObj = voices.find((v) => v.voice_id === selectedVoiceId);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="explainer-wizard-title"
      data-testid="explainer-wizard-modal"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-3xl bg-[#0e0e16] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header + 5-Step Stepper */}
        <div className="px-5 py-4 border-b border-zinc-800 bg-zinc-950/80 space-y-3 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center">
                <Wand2 className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 id="explainer-wizard-title" className="text-sm font-semibold text-zinc-100">
                  Guided Explainer Wizard
                </h2>
                <p className="text-[11px] text-zinc-400">
                  Step {step} of 5 • Build a prompt-grounded multi-track explainer
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            {STEPS.map((s) => {
              const isActive = step === s.id;
              const isDone = step > s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  data-testid={`wizard-step-tab-${s.id}`}
                  onClick={() => setStep(s.id)}
                  className={`rounded-lg border px-2 py-1.5 text-left transition ${
                    isActive
                      ? 'border-indigo-400 bg-indigo-600/20 text-white'
                      : isDone
                        ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-200'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <div className="text-[9px] font-mono uppercase opacity-75">
                    Step {s.id}
                  </div>
                  <div className="text-[11px] font-medium truncate">{s.title}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {step === 1 && (
            <div className="space-y-4" data-testid="wizard-step-1">
              <div>
                <label className="block text-xs font-semibold text-zinc-200 mb-1.5">
                  Topic Prompt &amp; Goal
                </label>
                <textarea
                  rows={3}
                  aria-label="Wizard Topic Prompt"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Describe what your explainer should teach..."
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 p-3 text-sm text-zinc-100 focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SAMPLE_PROMPTS.map((sample) => (
                    <button
                      key={sample}
                      type="button"
                      onClick={() => setTopic(sample)}
                      className="text-[11px] rounded-full border border-zinc-800 bg-zinc-900 hover:border-indigo-500/50 px-2.5 py-1 text-zinc-300 transition"
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                    Duration: <span className="text-cyan-300">{durationMinutes} minutes</span>
                  </label>
                  <span className="text-[11px] text-zinc-400">1–30m supported</span>
                </div>
                <div className="grid grid-cols-7 gap-1.5 mb-2">
                  {DURATION_PRESETS.map((min) => (
                    <button
                      key={min}
                      type="button"
                      onClick={() => setDurationMinutes(min)}
                      className={`py-1.5 rounded-lg text-xs font-medium border transition ${
                        durationMinutes === min
                          ? 'bg-indigo-600/25 border-indigo-400 text-indigo-200'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {min}m
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  aria-label="Wizard Duration"
                  min={1}
                  max={30}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-200 mb-1.5">
                    Audience Level
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'beginner', label: 'Beginner' },
                        { id: 'engineering', label: 'Engineering' },
                        { id: 'executive', label: 'Executive' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setAudience(opt.id)}
                        className={`rounded-xl border py-2 px-2 text-xs font-medium transition ${
                          audience === opt.id
                            ? 'bg-indigo-600/20 border-indigo-400 text-white'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-200 mb-1.5">
                    Visual Tone &amp; Cinematic Style
                  </label>
                  <select
                    aria-label="Wizard Cinematic Style"
                    value={cinematicStyle}
                    onChange={(e) => setCinematicStyle(e.target.value as CinematicStyle)}
                    className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-100"
                  >
                    {CINEMATIC_STYLES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4" data-testid="wizard-step-2">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
                    Import .pptx Deck or NotebookLM Doc / Audio
                  </div>
                  <label className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 px-2.5 py-1 text-[11px] font-medium text-cyan-200 cursor-pointer">
                    {sourceUploading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Upload className="w-3 h-3" />
                    )}
                    Upload File
                    <input
                      type="file"
                      accept=".pptx,.md,.txt,audio/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleUploadSourceFile(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={nlmName}
                    onChange={(e) => setNlmName(e.target.value)}
                    placeholder="Source title (optional)"
                    className="rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100"
                  />
                  <input
                    type="text"
                    value={nlmNotes}
                    onChange={(e) => setNlmNotes(e.target.value)}
                    placeholder="Paste NotebookLM briefing notes..."
                    className="sm:col-span-2 rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100"
                  />
                </div>
                {nlmNotes.trim() && (
                  <button
                    type="button"
                    disabled={sourceUploading}
                    onClick={() => void handleAddNotebookLmNotes()}
                    className="inline-flex items-center gap-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3 py-1 text-[11px] font-semibold text-white"
                  >
                    <Plus className="w-3 h-3" /> Add &amp; Select NotebookLM Notes
                  </button>
                )}

                {sources.length === 0 ? (
                  <p className="text-[11px] text-zinc-500">
                    No PPTX or NotebookLM sources imported yet. Scenes will be generated directly from your prompt.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                    {sources.map((src) => {
                      const active = selectedSourceIds.includes(src.id);
                      return (
                        <button
                          key={src.id}
                          type="button"
                          onClick={() => toggleId(selectedSourceIds, setSelectedSourceIds, src.id)}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition ${
                            active
                              ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                              : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                          }`}
                        >
                          {active && <Check className="w-3 h-3 text-cyan-300" />}
                          <span className="uppercase text-[9px] opacity-70">{src.sourceType}</span>
                          <span>{src.name}</span>
                          <span className="text-[9px] opacity-70">({src.slides.length})</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-2.5">
                <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-indigo-400" />
                  Select RAG Assets ({selectedAssetIds.length} selected)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                  {assets.map((asset) => {
                    const active = selectedAssetIds.includes(asset.id);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => toggleId(selectedAssetIds, setSelectedAssetIds, asset.id)}
                        className={`rounded-xl border p-2 text-left flex items-center gap-2 transition ${
                          active
                            ? 'border-indigo-400 bg-indigo-500/20 text-white'
                            : 'border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-zinc-700'
                        }`}
                      >
                        <div className="w-4 h-4 rounded border border-zinc-600 flex items-center justify-center shrink-0">
                          {active && <Check className="w-3 h-3 text-indigo-300" />}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate">{asset.name}</div>
                          <div className="text-[10px] text-zinc-400 truncate">
                            {asset.category}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4" data-testid="wizard-step-3">
              {/* Voice Picker + Inline + Add Voice */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    <Mic className="w-3.5 h-3.5 text-amber-400" />
                    Active Narrator Voice
                  </div>
                  <button
                    type="button"
                    data-testid="wizard-add-voice-toggle"
                    onClick={() => setShowAddVoice((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-500 hover:bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-zinc-950"
                  >
                    <Plus className="w-3 h-3" />
                    + Add Voice
                  </button>
                </div>

                {showAddVoice && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3 space-y-2.5">
                    <div className="text-[11px] font-semibold text-amber-200">
                      Clone / Add Voice in Speak Script or Direct Clip Mode
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        aria-label="New Voice Name"
                        value={newVoiceName}
                        onChange={(e) => setNewVoiceName(e.target.value)}
                        placeholder="Voice name (e.g. Jordan Host)"
                        className="rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100"
                      />
                      <select
                        aria-label="New Voice Playback Mode"
                        value={newVoicePlaybackMode}
                        onChange={(e) =>
                          setNewVoicePlaybackMode(e.target.value as VoicePlaybackMode)
                        }
                        className="rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100"
                      >
                        <option value="speak-script">Speak Script Mode</option>
                        <option value="direct-sample">Direct Clip Mode</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <select
                        aria-label="New Voice Tone"
                        value={newVoiceTone}
                        onChange={(e) => setNewVoiceTone(e.target.value)}
                        className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs text-zinc-100"
                      >
                        <option value="Warm & Articulate">Warm &amp; Articulate</option>
                        <option value="Crisp Technical">Crisp Technical</option>
                        <option value="Deep Documentary">Deep Documentary</option>
                      </select>
                      <select
                        aria-label="New Voice Pitch"
                        value={newVoicePitch}
                        onChange={(e) =>
                          setNewVoicePitch(e.target.value as VoiceTraits['pitch'])
                        }
                        className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs text-zinc-100"
                      >
                        <option value="low">Low Pitch</option>
                        <option value="medium">Medium Pitch</option>
                        <option value="high">High Pitch</option>
                      </select>
                      <select
                        aria-label="New Voice Cadence"
                        value={newVoiceCadence}
                        onChange={(e) =>
                          setNewVoiceCadence(e.target.value as VoiceTraits['cadence'])
                        }
                        className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs text-zinc-100"
                      >
                        <option value="measured">Measured</option>
                        <option value="conversational">Conversational</option>
                        <option value="brisk">Brisk</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <input
                        type="file"
                        accept="audio/*,video/mp4,video/webm"
                        onChange={(e) => setNewVoiceFile(e.target.files?.[0] || null)}
                        className="text-[11px] text-zinc-300 file:mr-2 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-[11px] file:text-zinc-200"
                      />
                      <button
                        type="button"
                        disabled={cloningVoiceBusy}
                        onClick={() => void handleInlineCreateVoice()}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-500 hover:bg-amber-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 disabled:opacity-50"
                      >
                        {cloningVoiceBusy ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                        Save &amp; Set Active
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                  {voices.map((v) => {
                    const isSelected = selectedVoiceId === v.voice_id;
                    return (
                      <div
                        key={v.voice_id}
                        className={`rounded-xl border p-2 flex items-center justify-between gap-2 ${
                          isSelected
                            ? 'border-amber-400 bg-amber-500/15'
                            : 'border-zinc-800 bg-zinc-900/70'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedVoiceId(v.voice_id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="text-xs font-semibold text-zinc-100 truncate">
                            {v.name}
                          </div>
                          <div className="text-[10px] text-zinc-400 truncate">
                            {v.source === 'native'
                              ? v.playbackMode === 'direct-sample'
                                ? 'Direct Clip'
                                : 'Native Speak Script'
                              : v.source}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void onPreviewVoice(v.voice_id, `Testing voice ${v.name}.`)
                          }
                          className="p-1.5 rounded-lg border border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-800"
                          title="Preview voice"
                        >
                          <Play className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Cast Picker */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-cyan-400" />
                    Cast Characters ({selectedCharacterIds.length} selected)
                  </div>
                  <button
                    type="button"
                    onClick={onOpenCharacterClone}
                    className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 hover:bg-cyan-500/25 px-2.5 py-1 text-[11px] font-medium text-cyan-200"
                  >
                    <UserPlus className="w-3 h-3" />
                    Clone Character
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                  {characters.map((ch) => {
                    const active = selectedCharacterIds.includes(ch.id);
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() =>
                          toggleId(selectedCharacterIds, setSelectedCharacterIds, ch.id)
                        }
                        className={`rounded-xl border p-2 text-left flex items-center gap-2 transition ${
                          active
                            ? 'border-cyan-400 bg-cyan-500/15 text-white'
                            : 'border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-zinc-700'
                        }`}
                      >
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
                          style={{ backgroundColor: ch.previewColor }}
                        >
                          {ch.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate">{ch.name}</div>
                          <div className="text-[10px] text-zinc-400 truncate">
                            {ch.stylePreset}
                          </div>
                        </div>
                        {active && <Check className="w-3.5 h-3.5 text-cyan-300 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4" data-testid="wizard-step-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-200 mb-1.5">
                  Native Animation Preset
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ANIMATION_PRESETS.map((ap) => (
                    <button
                      key={ap.value}
                      type="button"
                      onClick={() => setAnimationPreset(ap.value)}
                      className={`rounded-xl border p-2.5 text-left transition ${
                        animationPreset === ap.value
                          ? 'border-indigo-400 bg-indigo-600/20 text-white'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      <div className="text-xs font-semibold">{ap.label}</div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">{ap.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/15 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="text-xs font-semibold text-cyan-200 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                      Auto-Generate Native SVG Diagrams &amp; Illustrations
                    </div>
                    <div className="text-[10px] text-cyan-200/75">
                      Generates prompt-exact SVG visuals for every scene on assembly
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    aria-label="Auto-generate native SVG diagrams"
                    checked={autoGenerateVisuals}
                    onChange={(e) => setAutoGenerateVisuals(e.target.checked)}
                    className="w-4 h-4 accent-cyan-400"
                  />
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    aria-label="Wizard Diagram Type"
                    value={diagramType}
                    onChange={(e) =>
                      setDiagramType(e.target.value as NativeVisualDiagramType)
                    }
                    className="rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100"
                  >
                    {DIAGRAM_TYPES.map((dt) => (
                      <option key={dt.value} value={dt.value}>
                        {dt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={generatingPreviewSvg}
                    onClick={() => void handleGeneratePreviewVisual()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600/25 hover:bg-cyan-600/35 border border-cyan-400/50 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-50"
                  >
                    {generatingPreviewSvg ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="w-3.5 h-3.5" />
                    )}
                    Preview Native SVG for Prompt
                  </button>
                </div>

                {previewSvgUrl && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
                    <img
                      src={previewSvgUrl}
                      alt="Generated native SVG preview"
                      className="w-full h-36 object-cover"
                    />
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 space-y-2">
                <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5 text-emerald-400" />
                  Soundtrack Bed Preset
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {STUDIO_MUSIC_PRESETS.map((preset) => {
                    const active = selectedMusicPreset?.title === preset.title;
                    return (
                      <button
                        key={preset.title}
                        type="button"
                        onClick={() => setSelectedMusicPreset(preset)}
                        className={`rounded-lg border p-2 text-left transition ${
                          active
                            ? 'border-emerald-400 bg-emerald-500/15 text-emerald-100'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                        }`}
                      >
                        <div className="text-[11px] font-semibold truncate">{preset.title}</div>
                        <div className="text-[9px] text-zinc-400">{preset.bpm} BPM</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3" data-testid="wizard-step-5">
              <div className="rounded-xl border border-indigo-500/35 bg-indigo-950/20 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-200">
                  <Layers className="w-4 h-4 text-indigo-400" />
                  Explainer Assembly Blueprint
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg bg-zinc-950/80 border border-zinc-800 p-2.5">
                    <div className="text-[10px] uppercase text-zinc-500">Prompt &amp; Goal</div>
                    <div className="font-semibold text-zinc-100 mt-0.5 line-clamp-2">{topic}</div>
                    <div className="text-[11px] text-cyan-300 mt-1">
                      {durationMinutes} min • {audience} • {cinematicStyle}
                    </div>
                  </div>
                  <div className="rounded-lg bg-zinc-950/80 border border-zinc-800 p-2.5">
                    <div className="text-[10px] uppercase text-zinc-500">Sources &amp; RAG Assets</div>
                    <div className="font-semibold text-zinc-100 mt-0.5">
                      {selectedSourceIds.length} source(s) • {selectedAssetIds.length} RAG asset(s)
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-1">
                      {selectedSourceIds.length > 0
                        ? '1-to-1 source mapping enabled'
                        : 'Prompt-exact scene outline'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-zinc-950/80 border border-zinc-800 p-2.5">
                    <div className="text-[10px] uppercase text-zinc-500">Voice &amp; Cast</div>
                    <div className="font-semibold text-amber-200 mt-0.5">
                      {selectedVoiceObj?.name || selectedVoiceId}
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-1">
                      {selectedCharacterIds.length} cast character(s) assigned
                    </div>
                  </div>
                  <div className="rounded-lg bg-zinc-950/80 border border-zinc-800 p-2.5">
                    <div className="text-[10px] uppercase text-zinc-500">
                      Visuals, Animation &amp; Music
                    </div>
                    <div className="font-semibold text-cyan-200 mt-0.5">
                      {animationPreset} • {diagramType}
                    </div>
                    <div className="text-[11px] text-emerald-300 mt-1">
                      Auto SVG: {autoGenerateVisuals ? 'On' : 'Off'} •{' '}
                      {selectedMusicPreset?.title || 'Adaptive Bed'}
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-zinc-400">
                Assembling populates all 4 timeline tracks (Scenes, Characters, Voiceover, Music) so you can click, drag, trim, and export right away.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-2.5 text-xs text-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="px-5 py-3.5 border-t border-zinc-800 bg-zinc-950/80 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className="inline-flex items-center gap-1 rounded-xl border border-zinc-800 px-3.5 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-900 disabled:opacity-35"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-zinc-800 px-3.5 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-900"
            >
              Cancel
            </button>
            {step < 5 ? (
              <button
                type="button"
                data-testid="wizard-next-btn"
                onClick={() => setStep((s) => Math.min(5, s + 1))}
                className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                data-testid="wizard-assemble-btn"
                disabled={busy}
                onClick={() => void handleAssemble()}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 disabled:opacity-45 px-4 py-2 text-xs font-semibold text-white"
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                Assemble Explainer &amp; Populate Timeline
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
