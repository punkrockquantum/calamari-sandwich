import { useEffect, useState } from 'react';
import { Clock, Loader2, Mic, Sparkles, X } from 'lucide-react';
import type { AudienceLevel, GenerateProjectRequest, VoiceProfile } from '@shared/types';

interface TopicGeneratorModalProps {
  open: boolean;
  voices: VoiceProfile[];
  activeVoiceId?: string;
  onClose: () => void;
  onGenerate: (payload: GenerateProjectRequest) => Promise<void>;
  busy: boolean;
}

const DURATION_PRESETS = [1, 2, 3, 5, 10, 15, 30];

const SAMPLE_TOPICS = [
  'How Transformer Attention & KV Caching Work',
  'Zero-Knowledge Proofs (zk-SNARKs) Visually Explained',
  'Distributed Raft Consensus & Leader Election',
  'WebGPU Compute Shaders for Real-Time Physics',
];

export function TopicGeneratorModal({
  open,
  voices,
  activeVoiceId,
  onClose,
  onGenerate,
  busy,
}: TopicGeneratorModalProps) {
  const [topic, setTopic] = useState(SAMPLE_TOPICS[0]);
  const [durationMinutes, setDurationMinutes] = useState(2);
  const [audience, setAudience] = useState<AudienceLevel>('engineering');
  const [primaryVoiceId, setPrimaryVoiceId] = useState(
    activeVoiceId || voices[0]?.voice_id || 'mock-rachel'
  );

  useEffect(() => {
    if (!open) return;
    if (activeVoiceId && voices.some((v) => v.voice_id === activeVoiceId)) {
      setPrimaryVoiceId(activeVoiceId);
    } else if (voices.length > 0) {
      setPrimaryVoiceId((prev) =>
        voices.some((v) => v.voice_id === prev) ? prev : voices[0].voice_id
      );
    }
  }, [open, activeVoiceId, voices]);

  if (!open) return null;

  const estimatedChapters =
    durationMinutes === 1
      ? 2
      : durationMinutes <= 3
        ? 3
        : durationMinutes <= 6
          ? 4
          : durationMinutes <= 12
            ? 6
            : durationMinutes <= 20
              ? 8
              : 10;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || busy) return;
    await onGenerate({
      topic: topic.trim(),
      durationMinutes,
      audience,
      primaryVoiceId,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-[#101018] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              New Tech-Explainer Generator (1–30 min)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Complex Technology Topic
            </label>
            <textarea
              rows={2}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Describe the technical system, protocol, or architecture to explain..."
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 p-3 text-sm text-zinc-100 focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SAMPLE_TOPICS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => setTopic(sample)}
                  className="text-[11px] rounded-full border border-zinc-800 bg-zinc-900/80 hover:border-indigo-500/50 px-2.5 py-1 text-zinc-400 hover:text-zinc-200 transition"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                Target Duration: <span className="text-cyan-300 font-semibold">{durationMinutes} minutes</span>
              </label>
              <span className="text-[11px] text-zinc-400">
                Auto-paced into {estimatedChapters} chapters • {estimatedChapters * 2} scenes
              </span>
            </div>

            <div className="grid grid-cols-7 gap-1.5 mb-2.5">
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
              min={1}
              max={30}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Audience Depth & Pacing
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'beginner', title: 'Beginner', desc: 'Analogy-first intuition' },
                  { id: 'engineering', title: 'Engineering', desc: 'Architecture & invariants' },
                  { id: 'executive', title: 'Executive', desc: 'Strategic ROI & tradeoffs' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAudience(opt.id)}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    audience === opt.id
                      ? 'bg-indigo-600/20 border-indigo-400 text-zinc-100'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <div className="text-xs font-semibold">{opt.title}</div>
                  <div className="text-[10px] opacity-75 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
              <Mic className="w-3.5 h-3.5 text-amber-400" />
              Narrator Voice (Cloned &amp; Studio)
            </label>
            <select
              aria-label="Narrator Voice"
              value={primaryVoiceId}
              onChange={(e) => setPrimaryVoiceId(e.target.value)}
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 px-3 py-2 text-xs text-zinc-100 focus:outline-none"
            >
              {voices.map((v) => (
                <option key={v.voice_id} value={v.voice_id}>
                  {v.name} ({v.source === 'native' ? 'Native Clone' : v.source === 'elevenlabs' ? 'ElevenLabs' : 'Studio'})
                </option>
              ))}
            </select>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!topic.trim() || busy}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-2 text-xs font-semibold text-white"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Generate Studio Timeline
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
