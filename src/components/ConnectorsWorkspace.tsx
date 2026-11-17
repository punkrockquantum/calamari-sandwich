import { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cpu,
  Film,
  KeyRound,
  Loader2,
  Mic,
  Music,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserPlus,
  XCircle,
} from 'lucide-react';
import type {
  ConnectorDescriptor,
  ConnectorId,
  ConnectorStatusLevel,
  ConnectorTestResult,
} from '@shared/types';
import type {
  DemoFallbackPrefs,
  SessionConnectorKeys,
} from '@/lib/connectors/registry';

interface ConnectorsWorkspaceProps {
  connectors: ConnectorDescriptor[];
  sessionKeys: SessionConnectorKeys;
  demoPrefs: DemoFallbackPrefs;
  testResults: Partial<Record<ConnectorId, ConnectorTestResult>>;
  testingId: ConnectorId | 'all' | null;
  onUpdateSessionKey: (id: ConnectorId, value: string) => void;
  onToggleDemoFallback: (id: ConnectorId, enabled: boolean) => void;
  onTestConnector: (id: ConnectorId) => Promise<void>;
  onTestAllConnectors: () => Promise<void>;
  onClearAllSessionKeys: () => void;
  onBackToStudio: () => void;
}

const CONNECTOR_ICONS: Record<ConnectorId, typeof Mic> = {
  elevenlabs: Mic,
  higgsfield: Film,
  character_cloning: UserPlus,
  script_director_llm: Cpu,
  music_soundtrack: Music,
};

function StatusBadge({ status }: { status: ConnectorStatusLevel }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Connected
      </span>
    );
  }
  if (status === 'demo') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-0.5 text-[11px] font-medium text-cyan-300">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
        Demo Mode
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400">
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
      Not Configured
    </span>
  );
}

export function ConnectorsWorkspace({
  connectors,
  sessionKeys,
  demoPrefs,
  testResults,
  testingId,
  onUpdateSessionKey,
  onToggleDemoFallback,
  onTestConnector,
  onTestAllConnectors,
  onClearAllSessionKeys,
  onBackToStudio,
}: ConnectorsWorkspaceProps) {
  const [draftKeys, setDraftKeys] = useState<SessionConnectorKeys>(sessionKeys);

  const connectedCount = connectors.filter((c) => c.status === 'connected').length;
  const demoCount = connectors.filter((c) => c.status === 'demo').length;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="rounded-2xl border border-zinc-800/90 bg-[#0d0d14] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
                <PlugZap className="w-4 h-4 text-indigo-400" />
              </div>
              <h1 className="text-base font-semibold text-zinc-100">
                Calamari Sandwich — API Connectors Hub
              </h1>
              <span className="rounded-full bg-zinc-900 border border-zinc-800 px-2.5 py-0.5 text-[11px] text-zinc-300">
                {connectedCount} Connected • {demoCount} Demo Mode
              </span>
            </div>
            <p className="text-xs text-zinc-400 max-w-2xl">
              Plug in provider keys to run each stage of the Calamari Sandwich pipeline. Server
              environment variables stay strictly backend-only; optional session keys entered here
              stay in browser session memory and are never saved to bundles or project files.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setDraftKeys({
                  elevenlabs: '',
                  higgsfield: '',
                  character_cloning: '',
                  script_director_llm: '',
                  music_soundtrack: '',
                });
                onClearAllSessionKeys();
              }}
              className="rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 transition"
            >
              Clear Session Keys
            </button>
            <button
              type="button"
              disabled={testingId !== null}
              onClick={() => void onTestAllConnectors()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3.5 py-2 text-xs font-semibold text-white transition"
            >
              {testingId === 'all' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Test All Connectors
            </button>
            <button
              type="button"
              onClick={onBackToStudio}
              className="rounded-xl border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-3.5 py-2 text-xs font-medium text-indigo-200 transition"
            >
              Back to Studio
            </button>
          </div>
        </div>

        {/* Security Notice */}
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/15 px-4 py-2.5 flex items-center gap-2.5 text-xs text-emerald-200/90">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>
            Zero-leak architecture: keys are passed per-request over custom headers or read from{' '}
            <code className="text-emerald-300">process.env</code> on the Express backend. Demo Mode
            keeps every creative tool working out of the box before API keys are added.
          </span>
        </div>

        {/* 5 Connector Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {connectors.map((connector) => {
            const Icon = CONNECTOR_ICONS[connector.id] || Sparkles;
            const testResult = testResults[connector.id];
            const isTesting = testingId === connector.id || testingId === 'all';
            const demoEnabled = demoPrefs[connector.id] ?? true;

            return (
              <div
                key={connector.id}
                className="rounded-2xl border border-zinc-800/90 bg-[#0d0d14] p-4 flex flex-col gap-3.5 shadow-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-100 truncate">
                        {connector.name}
                      </div>
                      <div className="text-[11px] text-cyan-300/90 font-medium">
                        {connector.category}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={connector.status} />
                </div>

                <p className="text-xs text-zinc-400 leading-relaxed">{connector.description}</p>

                <div className="flex flex-wrap gap-1.5">
                  {connector.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="text-[10px] rounded-md border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-300"
                    >
                      {cap}
                    </span>
                  ))}
                </div>

                <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-3">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-400 flex items-center gap-1">
                      <KeyRound className="w-3 h-3 text-amber-400" />
                      Server Env: <code className="text-zinc-200">{connector.envVar}</code>
                    </span>
                    <span className="text-zinc-500 font-mono">
                      Source: {connector.keySource}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      autoComplete="off"
                      aria-label={`${connector.name} session key`}
                      value={draftKeys[connector.id]}
                      onChange={(e) =>
                        setDraftKeys((prev) => ({
                          ...prev,
                          [connector.id]: e.target.value,
                        }))
                      }
                      placeholder={`Optional session key (${connector.sessionHeader})`}
                      className="flex-1 rounded-lg bg-zinc-900 border border-zinc-800 focus:border-indigo-500 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSessionKey(connector.id, draftKeys[connector.id])
                      }
                      className="rounded-lg border border-zinc-700 hover:border-indigo-500/60 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition shrink-0"
                    >
                      Save Key
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <label className="inline-flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={demoEnabled}
                        onChange={(e) =>
                          onToggleDemoFallback(connector.id, e.target.checked)
                        }
                        className="accent-cyan-500 rounded"
                      />
                      Enable Demo Mode fallback when no key is set
                    </label>

                    <button
                      type="button"
                      disabled={isTesting}
                      onClick={() => void onTestConnector(connector.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-100 transition"
                    >
                      {isTesting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                      ) : (
                        <Activity className="w-3.5 h-3.5 text-cyan-400" />
                      )}
                      Test Connection
                    </button>
                  </div>
                </div>

                {testResult && (
                  <div
                    className={`rounded-xl border px-3 py-2 text-xs flex items-start gap-2 ${
                      testResult.ok
                        ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
                        : 'border-rose-500/30 bg-rose-950/20 text-rose-200'
                    }`}
                  >
                    {testResult.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{testResult.message}</div>
                      <div className="text-[10px] opacity-75 mt-0.5 font-mono">
                        Status: {testResult.status} • {testResult.latencyMs}ms
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
