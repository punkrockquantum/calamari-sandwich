import { History, RotateCcw, X } from 'lucide-react';
import type { IterationSnapshot } from '@shared/types';

interface IterationHistoryDrawerProps {
  open: boolean;
  history: IterationSnapshot[];
  onClose: () => void;
  onRestore: (snapshotId: string) => Promise<void>;
}

export function IterationHistoryDrawer({
  open,
  history,
  onClose,
  onRestore,
}: IterationHistoryDrawerProps) {
  if (!open) return null;

  const reversed = [...history].reverse();

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-md bg-[#101018] border-l border-zinc-800 h-full flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              Iteration & Prompt History
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

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {reversed.map((snap, idx) => (
            <div
              key={snap.id}
              className={`rounded-xl border p-3 ${
                idx === 0
                  ? 'border-indigo-500/40 bg-indigo-950/20'
                  : 'border-zinc-800 bg-zinc-950/70'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs font-semibold text-zinc-100">{snap.prompt}</div>
                {idx === 0 ? (
                  <span className="text-[10px] rounded bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 shrink-0">
                    Current
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onRestore(snap.id)}
                    className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200 shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" /> Restore
                  </button>
                )}
              </div>
              <div className="mt-1 text-[11px] text-zinc-400">{snap.summary}</div>
              <div className="mt-2 text-[10px] font-mono text-zinc-500">
                {new Date(snap.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
