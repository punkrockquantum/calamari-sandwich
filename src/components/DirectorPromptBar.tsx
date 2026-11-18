import { useState } from 'react';
import { ArrowRight, Loader2, Sparkles, Wand2 } from 'lucide-react';

interface DirectorPromptBarProps {
  onSubmitPrompt: (prompt: string) => Promise<void>;
  lastActionSummary: string | null;
  busy: boolean;
}

const SUGGESTIONS = [
  'Add a new scene explaining KV cache compression with Neon Lab and Orbital Pan',
  'Add character "Maya Chen" as an ML Engineer at center stage',
  'Add synthwave soundtrack "Midnight Pulse" at -14dB',
  'Set scene 2 camera motion to Rack Focus and transition to Whip Pan',
  'Rewrite scene 1 narration to be simpler with an analogy',
];

export function DirectorPromptBar({
  onSubmitPrompt,
  lastActionSummary,
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
    <div className="bg-[#0d0d14] border border-indigo-500/30 rounded-xl p-3 shadow-lg shadow-indigo-950/20">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
          <Wand2 className="w-4 h-4 text-indigo-400" />
        </div>

        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='Director Prompt: e.g. "Add a scene on GPU tensor cores with Orbital Pan" or "Add synthwave soundtrack at -14dB"'
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
          {SUGGESTIONS.slice(0, 4).map((s) => (
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
    </div>
  );
}
