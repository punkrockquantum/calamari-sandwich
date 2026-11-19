import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  EyeOff,
  Film,
  KeyRound,
  Loader2,
  LogOut,
  Mic,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Video,
  X,
  XCircle,
} from 'lucide-react';
import type {
  ConnectConnectorRequest,
  ConnectorDescriptor,
  ConnectorId,
  ConnectorTestResult,
} from '@shared/types';

interface ProviderConnectModalProps {
  open: boolean;
  connector: ConnectorDescriptor | null;
  onClose: () => void;
  onConnect: (
    id: ConnectorId,
    payload: ConnectConnectorRequest
  ) => Promise<{ ok: boolean; error?: string; result?: ConnectorTestResult }>;
  onDisconnect: (id: ConnectorId) => Promise<void>;
  onTest: (id: ConnectorId) => Promise<ConnectorTestResult | undefined>;
  onSyncVoices?: () => Promise<void>;
}

const PORTAL_URLS: Partial<Record<ConnectorId, { url: string; label: string; instructions: string }>> = {
  elevenlabs: {
    url: 'https://elevenlabs.io/app/settings/api-keys',
    label: 'Open ElevenLabs API Keys Portal',
    instructions:
      'Sign in to your ElevenLabs account, create or copy an API key (xi-api-key) with Voices & Text-to-Speech access, then paste it below.',
  },
  higgsfield: {
    url: 'https://cloud.higgsfield.ai/',
    label: 'Open Higgsfield Cloud Portal',
    instructions:
      'Sign in to Higgsfield Cloud, generate an API Key ID + Key Secret (Key <id>:<secret>) or Bearer token, and verify it below.',
  },
  gemini_veo: {
    url: 'https://aistudio.google.com/apikey',
    label: 'Open Google AI Studio API Keys',
    instructions:
      'Sign in to Google AI Studio, create or copy a Gemini API key (GEMINI_API_KEY) for Veo video generation, and verify it below.',
  },
};

export function ProviderConnectModal({
  open,
  connector,
  onClose,
  onConnect,
  onDisconnect,
  onTest,
  onSyncVoices,
}: ProviderConnectModalProps) {
  const [higgsfieldMode, setHiggsfieldMode] = useState<'keypair' | 'single'>('keypair');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncingVoices, setSyncingVoices] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !connector) return;
    setApiKey('');
    setApiSecret('');
    setEndpoint(connector.endpoint || connector.defaultEndpoint || '');
    setModel(
      connector.model ||
        (connector.id === 'higgsfield'
          ? 'higgsfield-dop-turbo'
          : connector.id === 'gemini_veo'
            ? 'veo-2.0-generate-001'
            : '')
    );
    setShowAdvanced(false);
    setShowSecret(false);
    setError(null);
    setFeedback(null);
    setHiggsfieldMode(connector.supportsKeySecret ? 'keypair' : 'single');
  }, [open, connector]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !connector) return null;

  const isConnected = connector.status === 'connected';
  const portal = PORTAL_URLS[connector.id] || (connector.portalUrl
    ? {
        url: connector.portalUrl,
        label: connector.portalLabel || `Open ${connector.name} Portal`,
        instructions: `Sign in to ${connector.name}, copy your credential, and paste it below.`,
      }
    : null);

  const isHiggsfield = connector.id === 'higgsfield';
  const isGeminiVeo = connector.id === 'gemini_veo';
  const isElevenLabs = connector.id === 'elevenlabs';
  const Icon = isElevenLabs ? Mic : isGeminiVeo ? Video : isHiggsfield ? Film : KeyRound;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);

    if (!apiKey.trim()) {
      setError(
        isHiggsfield && higgsfieldMode === 'keypair'
          ? 'Please enter your Higgsfield Key ID.'
          : 'Please paste your API key.'
      );
      return;
    }
    if (isHiggsfield && higgsfieldMode === 'keypair' && !apiSecret.trim()) {
      setError('Please enter your Higgsfield Key Secret, or switch to Single API Key mode.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: ConnectConnectorRequest = {
        apiKey: apiKey.trim(),
        apiSecret:
          isHiggsfield && higgsfieldMode === 'keypair' && apiSecret.trim()
            ? apiSecret.trim()
            : undefined,
        endpoint: endpoint.trim() || undefined,
        model: (isHiggsfield || isGeminiVeo) && model.trim() ? model.trim() : undefined,
      };
      const res = await onConnect(connector.id, payload);
      if (!res.ok) {
        setError(res.error || res.result?.message || 'Credential verification failed.');
      } else {
        setApiKey('');
        setApiSecret('');
        setFeedback(
          res.result?.message || `${connector.name} connected and saved to your local vault.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    setError(null);
    setFeedback(null);
    setDisconnecting(true);
    try {
      await onDisconnect(connector.id);
      setFeedback(`Signed out of ${connector.name}. Studio safely falls back to Demo Mode.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleReverify = async () => {
    setError(null);
    setFeedback(null);
    setSubmitting(true);
    try {
      const res = await onTest(connector.id);
      if (res) {
        if (res.ok) setFeedback(res.message);
        else setError(res.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSyncVoices = async () => {
    if (!onSyncVoices) return;
    setSyncingVoices(true);
    setError(null);
    try {
      await onSyncVoices();
      setFeedback('Synced real voices from your ElevenLabs library.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync ElevenLabs voices.');
    } finally {
      setSyncingVoices(false);
    }
  };

  const account = connector.account;
  const remainingPct =
    account &&
    typeof account.remainingCharacters === 'number' &&
    typeof account.characterLimit === 'number' &&
    account.characterLimit > 0
      ? Math.max(0, Math.min(100, Math.round((account.remainingCharacters / account.characterLimit) * 100)))
      : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="provider-connect-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-[#0d0d14] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800/90 flex items-center justify-between gap-3 bg-zinc-950/80">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/35 flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-indigo-300" />
            </div>
            <div className="min-w-0">
              <h2 id="provider-connect-title" className="text-sm font-semibold text-zinc-100 truncate">
                {isConnected ? `${connector.name} — Connected` : `Connect ${connector.name}`}
              </h2>
              <p className="text-[11px] text-zinc-400 truncate">{connector.category}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close connect dialog"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Connected Account Status Card */}
          {isConnected && (
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-950/20 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-emerald-200">
                      {account?.label || `${connector.name} Verified`}
                    </div>
                    <div className="text-[11px] text-emerald-300/80 flex items-center gap-2 flex-wrap mt-0.5">
                      <span>
                        Source:{' '}
                        <strong className="font-medium">
                          {connector.keySource === 'vault'
                            ? 'Local Vault'
                            : connector.keySource === 'env'
                              ? 'Server Env'
                              : 'Browser Session'}
                        </strong>
                      </span>
                      {connector.maskedKey && (
                        <span className="font-mono rounded bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 text-[10px]">
                          Key {connector.maskedKey}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {account?.tier && (
                  <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                    {account.tier}
                  </span>
                )}
              </div>

              {isElevenLabs && account && (
                <div className="space-y-1.5 pt-1 border-t border-emerald-500/20">
                  <div className="flex items-center justify-between text-[11px] text-zinc-200">
                    <span>Character Quota Remaining</span>
                    <span className="font-mono text-emerald-300">
                      {typeof account.remainingCharacters === 'number' &&
                      typeof account.characterLimit === 'number'
                        ? `${account.remainingCharacters.toLocaleString()} / ${account.characterLimit.toLocaleString()}`
                        : `${account.voiceCount ?? 0} voices ready`}
                    </span>
                  </div>
                  {remainingPct !== null && (
                    <div className="h-1.5 w-full rounded-full bg-zinc-900 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full"
                        style={{ width: `${remainingPct}%` }}
                      />
                    </div>
                  )}
                  {typeof account.voiceCount === 'number' && (
                    <div className="text-[11px] text-zinc-400">
                      {account.voiceCount} voices available in your ElevenLabs library
                    </div>
                  )}
                </div>
              )}

              {(isHiggsfield || isGeminiVeo) && (
                <div className="space-y-1 pt-1 border-t border-emerald-500/20 text-[11px] text-zinc-300">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-400">Endpoint</span>
                    <span className="font-mono text-[10px] truncate max-w-[270px]">
                      {account?.endpoint || connector.endpoint || connector.defaultEndpoint}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-400">Model</span>
                    <span className="font-mono text-[10px]">
                      {account?.model ||
                        connector.model ||
                        (isGeminiVeo ? 'veo-2.0-generate-001' : 'higgsfield-dop-turbo')}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {isElevenLabs && onSyncVoices && (
                  <button
                    type="button"
                    disabled={syncingVoices}
                    onClick={() => void handleSyncVoices()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 px-3 py-1.5 text-xs font-medium text-amber-200 transition"
                  >
                    {syncingVoices ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    Sync ElevenLabs Voices
                  </button>
                )}

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleReverify()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${submitting ? 'animate-spin' : ''}`} />
                  Re-verify
                </button>

                {connector.savedInVault && (
                  <button
                    type="button"
                    disabled={disconnecting}
                    onClick={() => void handleDisconnect()}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-950/40 hover:bg-rose-900/50 px-3 py-1.5 text-xs font-medium text-rose-200 transition"
                  >
                    {disconnecting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <LogOut className="w-3.5 h-3.5" />
                    )}
                    Sign Out / Disconnect
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Guided Step 1: Portal Launch */}
          {portal && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300">
                  Step 1 • Get Credentials
                </span>
                <a
                  href={portal.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/40 px-2.5 py-1 text-[11px] font-medium text-indigo-200 transition"
                >
                  {portal.label}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">{portal.instructions}</p>
            </div>
          )}

          {/* Step 2: Credential Input Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300">
                {isConnected ? 'Update Stored Credentials' : 'Step 2 • Paste & Verify Credentials'}
              </span>
              {isHiggsfield && (
                <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setHiggsfieldMode('keypair')}
                    className={`px-2 py-0.5 rounded-md transition ${
                      higgsfieldMode === 'keypair'
                        ? 'bg-indigo-600 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Key ID + Secret
                  </button>
                  <button
                    type="button"
                    onClick={() => setHiggsfieldMode('single')}
                    className={`px-2 py-0.5 rounded-md transition ${
                      higgsfieldMode === 'single'
                        ? 'bg-indigo-600 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Single Key / Token
                  </button>
                </div>
              )}
            </div>

            {isHiggsfield && higgsfieldMode === 'keypair' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Higgsfield Key ID
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="hf_key_id..."
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Higgsfield Key Secret
                  </label>
                  <div className="relative">
                    <input
                      type={showSecret ? 'text' : 'password'}
                      autoComplete="off"
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      placeholder="hf_secret..."
                      className="w-full rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 pl-3 pr-9 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((s) => !s)}
                      aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  {isElevenLabs
                    ? 'ElevenLabs API Key (xi-api-key)'
                    : isGeminiVeo
                      ? 'Gemini API Key (GEMINI_API_KEY)'
                      : isHiggsfield
                        ? 'Higgsfield API Key / Bearer Token or Key <id>:<secret>'
                        : `${connector.name} API Key`}
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={
                      isElevenLabs
                        ? 'sk_...'
                        : isGeminiVeo
                          ? 'AIza...'
                          : isHiggsfield
                            ? 'Key <id>:<secret> or Bearer token'
                            : 'Paste API key...'
                    }
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 pl-3 pr-9 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((s) => !s)}
                    aria-label={showSecret ? 'Hide API key' : 'Show API key'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}

            {/* Collapsible Endpoint & Model Settings (especially useful for Higgsfield) */}
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="w-full px-3 py-2 flex items-center justify-between text-[11px] text-zinc-400 hover:text-zinc-200"
              >
                <span>Advanced Endpoint & Model Settings</span>
                {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {showAdvanced && (
                <div className="px-3 pb-3 space-y-2 border-t border-zinc-800/70 pt-2">
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">
                      API Endpoint URL
                    </label>
                    <input
                      type="url"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder={connector.defaultEndpoint}
                      className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 font-mono"
                    />
                  </div>
                  {(isHiggsfield || isGeminiVeo) && (
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">
                        {isGeminiVeo ? 'Gemini Veo Model' : 'Higgsfield Model'}
                      </label>
                      <input
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder={isGeminiVeo ? 'veo-2.0-generate-001' : 'higgsfield-dop-turbo'}
                        className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 font-mono"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-200 flex items-start gap-2">
                <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {feedback && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/25 px-3 py-2 text-xs text-emerald-200 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{feedback}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Saved locally in gitignored vault; never leaked to browser bundles.</span>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white transition shrink-0"
              >
                {submitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <KeyRound className="w-3.5 h-3.5" />
                )}
                Connect & Verify
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
