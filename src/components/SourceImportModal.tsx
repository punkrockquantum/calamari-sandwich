import { useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  FileAudio,
  FileSpreadsheet,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { ImportedSource } from '@shared/types';

interface SourceImportModalProps {
  open: boolean;
  onClose: () => void;
  onImportPptx: (formData: FormData, autoGenerate?: boolean) => Promise<ImportedSource>;
  onImportNotebookLm: (
    payload: FormData | { name?: string; rawText: string },
    autoGenerate?: boolean
  ) => Promise<ImportedSource>;
  busy: boolean;
}

export function SourceImportModal({
  open,
  onClose,
  onImportPptx,
  onImportNotebookLm,
  busy,
}: SourceImportModalProps) {
  const [mode, setMode] = useState<'pptx' | 'notebooklm'>('pptx');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState('');
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      if (mode === 'pptx') {
        if (!file) {
          setError('Select a .pptx presentation file to import.');
          return;
        }
        const fd = new FormData();
        fd.append('file', file);
        if (name.trim()) fd.append('name', name.trim());
        await onImportPptx(fd, autoGenerate);
      } else {
        if (!file && !rawText.trim()) {
          setError('Upload a NotebookLM Briefing Doc / Audio Overview or paste your notes.');
          return;
        }
        if (file) {
          const fd = new FormData();
          fd.append('file', file);
          if (name.trim()) fd.append('name', name.trim());
          if (rawText.trim()) fd.append('rawText', rawText.trim());
          await onImportNotebookLm(fd, autoGenerate);
        } else {
          await onImportNotebookLm(
            {
              name: name.trim() || undefined,
              rawText: rawText.trim(),
            },
            autoGenerate
          );
        }
      }
      setName('');
      setFile(null);
      setRawText('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Source import failed.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="source-import-title"
    >
      <div className="w-full max-w-xl bg-[#0d0d14] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/35 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h2 id="source-import-title" className="text-sm font-semibold text-zinc-100">
                Import Presentation or NotebookLM Source
              </h2>
              <p className="text-[11px] text-zinc-400">
                Extract slides, speaker notes, embedded visuals, or NotebookLM Briefing Docs &amp; Audio Overviews
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setMode('pptx');
                setFile(null);
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-semibold transition ${
                mode === 'pptx'
                  ? 'bg-cyan-500/15 border-cyan-400 text-cyan-100'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              PowerPoint (.pptx)
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('notebooklm');
                setFile(null);
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-semibold transition ${
                mode === 'notebooklm'
                  ? 'bg-indigo-500/15 border-indigo-400 text-indigo-100'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileText className="w-4 h-4" />
              NotebookLM Doc / Audio
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Source Title (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                mode === 'pptx'
                  ? 'e.g. Q4 Inference Architecture Deck'
                  : 'e.g. NotebookLM Briefing: KV Cache Deep Dive'
              }
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 focus:border-cyan-500 px-3 py-2 text-xs text-zinc-100 focus:outline-none"
            />
          </div>

          {mode === 'pptx' ? (
            <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/70 p-4 space-y-2 text-center">
              <Upload className="w-5 h-5 text-cyan-400 mx-auto" />
              <div className="text-xs font-medium text-zinc-200">
                Upload PowerPoint Presentation (.pptx)
              </div>
              <p className="text-[11px] text-zinc-500">
                Parses slide titles, bullets, speaker notes, and extracts embedded diagrams into your Asset Library
              </p>
              <input
                type="file"
                accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="mx-auto block text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-200 hover:file:bg-zinc-700"
              />
              {file && (
                <div className="text-[11px] text-cyan-300 font-medium">
                  Selected: {file.name} ({Math.round(file.size / 1024)} KB)
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/70 p-3.5 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                  <FileAudio className="w-4 h-4 text-indigo-400" />
                  Upload NotebookLM Briefing Doc (.md, .txt, .pdf) or Audio Overview (.wav, .mp3, .m4a)
                </div>
                <input
                  type="file"
                  accept=".md,.txt,.pdf,.wav,.mp3,.m4a,.webm,.ogg,audio/*,text/markdown,text/plain,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-200 hover:file:bg-zinc-700"
                />
                {file && (
                  <div className="text-[11px] text-indigo-300 font-medium">
                    Attached: {file.name}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Paste NotebookLM Briefing Doc / Study Guide / Notes
                </label>
                <textarea
                  rows={5}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={`# Section 1: Core Idea\n- Bullet point mapped directly to scene\nNotes: Speaker narration or explanation...`}
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 p-3 text-xs text-zinc-100 font-mono leading-relaxed focus:outline-none"
                />
              </div>
            </div>
          )}

          <label className="flex items-center justify-between gap-3 rounded-xl border border-indigo-500/35 bg-indigo-500/10 px-3.5 py-2.5 cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-indigo-100">
                Create Prompt-Exact Explainer Video Now
              </div>
              <div className="text-[10px] text-indigo-200/75">
                Immediately map extracted slides/sections 1-to-1 into scenes with native SVG visuals
              </div>
            </div>
            <input
              type="checkbox"
              checked={autoGenerate}
              onChange={(e) => setAutoGenerate(e.target.checked)}
              className="w-4 h-4 accent-indigo-500 rounded shrink-0"
            />
          </label>

          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-2.5 text-xs text-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 px-4 py-2 text-xs font-semibold text-white"
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {autoGenerate ? 'Import & Generate Explainer' : 'Import Source'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
