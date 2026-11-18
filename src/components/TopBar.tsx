import {
  Clapperboard,
  History,
  PlugZap,
  Plus,
  Redo2,
  Sparkles,
  Undo2,
  UserPlus,
} from 'lucide-react';
import type { ConnectorDescriptor, ExplainerProject } from '@shared/types';

export type WorkspaceView = 'studio' | 'connectors';

interface TopBarProps {
  projects: ExplainerProject[];
  activeProject: ExplainerProject;
  connectors: ConnectorDescriptor[];
  activeView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  onSelectProject: (id: string) => void;
  onOpenNewProject: () => void;
  onOpenCharacterClone: () => void;
  onOpenHistory: () => void;
  onUndo: () => void;
  onRedo: () => void;
  busy: boolean;
}

export function TopBar({
  projects,
  activeProject,
  connectors,
  activeView,
  onChangeView,
  onSelectProject,
  onOpenNewProject,
  onOpenCharacterClone,
  onOpenHistory,
  onUndo,
  onRedo,
  busy,
}: TopBarProps) {
  const totalSec = activeProject.scenes.reduce((s, sc) => s + sc.durationSec, 0);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const canUndo = activeProject.history.length > 1;
  const canRedo = activeProject.redoStack.length > 0;
  const connectedCount = connectors.filter((c) => c.status === 'connected').length;

  return (
    <header className="h-14 shrink-0 border-b border-zinc-800/90 bg-[#0d0d14]/95 px-4 flex items-center justify-between gap-3 backdrop-blur">
      {/* Left: Calamari Sandwich Brand & Project Selector */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Clapperboard className="w-4 h-4 text-white" />
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-semibold tracking-tight text-zinc-100 leading-none">
              Calamari Sandwich
            </div>
            <div className="text-[10px] text-zinc-400 mt-0.5">Tech-Explainer Video Studio</div>
          </div>
        </div>

        <div className="h-5 w-px bg-zinc-800 hidden sm:block" />

        {/* Workspace View Switcher: Studio vs API Connectors */}
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => onChangeView('studio')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
              activeView === 'studio'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Studio
          </button>
          <button
            type="button"
            onClick={() => onChangeView('connectors')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
              activeView === 'connectors'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <PlugZap className="w-3.5 h-3.5 text-cyan-300" />
            <span>API Connectors</span>
            <span className="rounded bg-black/30 px-1.5 py-0.2 text-[10px] font-mono">
              {connectedCount}/{connectors.length || 5}
            </span>
          </button>
        </div>

        <select
          aria-label="Select explainer project"
          value={activeProject.id}
          onChange={(e) => onSelectProject(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-100 max-w-[210px] truncate focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onOpenNewProject}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white transition shadow-sm shadow-indigo-500/20 shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          New Explainer
        </button>

        <div className="hidden 2xl:flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-[11px] text-zinc-300 shrink-0">
          <Sparkles className="w-3 h-3 text-cyan-400" />
          <span>
            {mins}m {secs.toString().padStart(2, '0')}s
          </span>
          <span className="text-zinc-600">•</span>
          <span>{activeProject.chapters.length} ch</span>
          <span className="text-zinc-600">•</span>
          <span>{activeProject.scenes.length} scenes</span>
        </div>
      </div>

      {/* Right: Undo/Redo, History, Clone Character */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/70 p-0.5">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo || busy}
            title="Undo last iteration"
            className="p-1.5 rounded-md text-zinc-300 hover:bg-zinc-800 disabled:opacity-35 disabled:pointer-events-none transition"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo || busy}
            title="Redo iteration"
            className="p-1.5 rounded-md text-zinc-300 hover:bg-zinc-800 disabled:opacity-35 disabled:pointer-events-none transition"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onOpenHistory}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-300 hover:bg-zinc-800 transition"
          >
            <History className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden md:inline">History</span>
            <span className="text-[10px] rounded bg-zinc-800 px-1 text-zinc-400">
              {activeProject.history.length}
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenCharacterClone}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition"
        >
          <UserPlus className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden md:inline">Clone Character</span>
        </button>
      </div>
    </header>
  );
}
