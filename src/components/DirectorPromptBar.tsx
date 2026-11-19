import { useState } from 'react';
import { ArrowRight, Database, Loader2, Sparkles, Wand2 } from 'lucide-react';
import type { RagContextMatch } from '@shared/types';

interface DirectorPromptBarProps {
  onSubmitPrompt: (prompt: string) => Promise<void>;
  lastActionSummary: string | null;
  lastRagContext?: RagContextMatch[];
  busy: boolean;
}

const SUGGESTIONS = [
  'Add a new scene explaining H100 server rack cooling with Neon Lab and Orbital Pan',
  'Add character "Maya Chen" as an ML Engineer at center stage',
  'Add synthwave soundtrack "Midnight Pulse" at -14dB',
  'Make it 1 minute with crisp visual metaphors',
];

export function DirectorPromptBar({
  onSubmitPrompt,
  lastActionSummary,
  lastRagContext,
  busy,
}: DirectorPromptBarProps) {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    const text = prompt.trim();
    setPrompt('');
    await onSubmitPrompt(text);
  };

  return (
    <div className="shrink-0 bg-[#0d0d14] border border-indigo-500/30 rounded-xl p-3 shadow-lg shadow-indigo-950/20">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
          <Wand2 className="w-4 h-4 text-indigo-400" />
        </div>

        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='Director Prompt: e.g. "Add a scene on H100 server rack cooling" or "Push scene 1 to Gemini Veo"'
          className="flex-1 bg-zinc-950/90 border border-zinc-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
        />

        <button
          type="submit"
          disabled={!prompt.trim() || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 px-3.5 py-2 text-xs font-semibold text-white transition shrink-0"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          Apply Edit
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </form>

      <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setPrompt(s)}
              className="text-[10px] rounded-full border border-zinc-800 bg-zinc-900/80 hover:border-indigo-500/50 hover:text-indigo-200 px-2.5 py-1 text-zinc-400 transition truncate max-w-[230px]"
            >
              {s}
            </button>
          ))}
        </div>
        {lastActionSummary && (
          <div className="text-[11px] text-emerald-300/90 truncate max-w-[360px]">
            Applied: {lastActionSummary}
          </div>
        )}
      </div>

      {lastRagContext && lastRagContext.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
            <Database className="w-3 h-3" />
            RAG Context Used:
          </span>
          {lastRagContext.map((m) => (
            <span
              key={`${m.sourceType}-${m.id}`}
              title={m.snippet}
              className="inline-flex items-center gap-1 rounded-md border border-indigo-500/35 bg-indigo-500/10 px-2 py-0.5 text-[10px] text-indigo-200"
            >
              <span className="opacity-70 uppercase text-[9px]">{m.sourceType}</span>
              <span>{m.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
