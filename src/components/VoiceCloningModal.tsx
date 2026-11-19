import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AudioLines,
  Loader2,
  Mic,
  MicOff,
  Sparkles,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import type { VoicePlaybackMode, VoiceProfile, VoiceTraits } from '@shared/types';

interface VoiceCloningModalProps {
  open: boolean;
  projectId?: string;
  onClose: () => void;
  onCloneVoice: (
    formData: FormData,
    options?: { setAsActiveExplainerVoice: boolean }
  ) => Promise<VoiceProfile | void>;
  busy: boolean;
}

const TONE_OPTIONS = [
  'Warm & Articulate',
  'Crisp Technical',
  'Deep Documentary',
  'Energetic Educator',
  'Calm Analyst',
];

export function VoiceCloningModal({
  open,
  projectId,
  onClose,
  onCloneVoice,
  busy,
}: VoiceCloningModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sampleMode, setSampleMode] = useState<'upload' | 'record' | 'traits'>('upload');
  const [playbackMode, setPlaybackMode] = useState<VoicePlaybackMode>('speak-script');
  const [setAsActiveExplainerVoice, setSetAsActiveExplainerVoice] = useState(true);
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [tone, setTone] = useState(TONE_OPTIONS[0]);
  const [pitch, setPitch] = useState<VoiceTraits['pitch']>('medium');
  const [warmth, setWarmth] = useState(72);
  const [cadence, setCadence] = useState<VoiceTraits['cadence']>('conversational');

  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!sampleFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(sampleFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [sampleFile]);

  if (!open) return null;

  const stopRecording = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Microphone recording is unavailable in this browser context. Upload an audio/video file or use System Speech + Traits.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const mime = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        const ext = mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `mic-sample-${Date.now()}.${ext}`, { type: mime });
        setSampleFile(file);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };

      recorder.start();
      setRecordSec(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        setRecordSec((s) => s + 1);
      }, 1000);
    } catch (err) {
      setError(
        `Could not access microphone (${err instanceof Error ? err.message : 'permission denied'}). Upload a sample file instead.`
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) {
      setError('Enter a voice name (at least 2 characters).');
      return;
    }

    let fileToUpload = sampleFile;
    if (sampleMode === 'record' && recording && mediaRecorderRef.current) {
      const recorder = mediaRecorderRef.current;
      if (recorder.state !== 'inactive') {
        fileToUpload = await new Promise<File | null>((resolve) => {
          const prevOnStop = recorder.onstop;
          recorder.onstop = (ev) => {
            if (typeof prevOnStop === 'function') {
              prevOnStop.call(recorder, ev);
            }
            const mime = recorder.mimeType || 'audio/webm';
            const blob = new Blob(chunksRef.current, { type: mime });
            const ext = mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : 'webm';
            const recorded =
              blob.size > 0
                ? new File([blob], `mic-sample-${Date.now()}.${ext}`, { type: mime })
                : null;
            resolve(recorded);
          };
          stopRecording();
        });
      }
    }

    if (sampleMode === 'upload' && !fileToUpload) {
      setError('Select an audio or video voice sample, or switch to System Speech + Traits.');
      return;
    }
    if (sampleMode === 'record' && !fileToUpload) {
      setError('Record a microphone voice sample first, or switch to System Speech + Traits.');
      return;
    }

    const effectivePlaybackMode: VoicePlaybackMode =
      sampleMode !== 'traits' && fileToUpload ? playbackMode : 'speak-script';

    const fd = new FormData();
    fd.append('name', name.trim());
    if (description.trim()) fd.append('description', description.trim());
    fd.append('tone', tone);
    fd.append('pitch', pitch);
    fd.append('warmth', String(warmth));
    fd.append('cadence', cadence);
    fd.append('playbackMode', effectivePlaybackMode);
    if (projectId) fd.append('projectId', projectId);
    fd.append('setAsActiveExplainerVoice', String(setAsActiveExplainerVoice));
    if (sampleMode !== 'traits' && fileToUpload) {
      fd.append('sample', fileToUpload);
    }

    try {
      await onCloneVoice(fd, { setAsActiveExplainerVoice });
      setName('');
      setDescription('');
      setSampleFile(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice cloning failed.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-clone-title"
    >
      <div className="w-full max-w-xl bg-[#0d0d14] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/35 flex items-center justify-center">
              <Mic className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 id="voice-clone-title" className="text-sm font-semibold text-zinc-100">
                Add Native Voice (+ Add Voice)
              </h2>
              <p className="text-[11px] text-zinc-400">
                Uses local system speech + voice traits, or plays your recorded audio clip directly. Connect ElevenLabs for neural timbre cloning.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (recording) stopRecording();
              onClose();
            }}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Voice Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dr. Maya — Systems Host"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 focus:border-amber-500 px-3 py-2 text-xs text-zinc-100 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Voice Notes / Role
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Calm infrastructure explainer voice"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 focus:border-amber-500 px-3 py-2 text-xs text-zinc-100 focus:outline-none"
              />
            </div>
          </div>

          {/* Sample Acquisition Mode */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Voice Input Source
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'upload', label: 'Upload Audio/Video', icon: Upload },
                  { id: 'record', label: 'Record Microphone', icon: Mic },
                  { id: 'traits', label: 'System Speech + Traits', icon: Sparkles },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    if (recording) stopRecording();
                    setSampleMode(id);
                    if (id === 'traits') {
                      setPlaybackMode('speak-script');
                    }
                    setError(null);
                  }}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 px-2 text-xs font-medium transition ${
                    sampleMode === id
                      ? 'bg-amber-500/15 border-amber-400 text-amber-200'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {sampleMode === 'upload' && (
            <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/70 p-3.5 space-y-2">
              <label className="flex flex-col items-center gap-1.5 cursor-pointer text-center">
                <span className="text-xs font-medium text-zinc-200">
                  Select an audio or video voice clip (WAV, MP3, WEBM, M4A, MP4, MOV)
                </span>
                <input
                  type="file"
                  accept="audio/*,video/mp4,video/webm,video/quicktime"
                  onChange={(e) => setSampleFile(e.target.files?.[0] || null)}
                  className="text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-200 hover:file:bg-zinc-700"
                />
              </label>
              {previewUrl && (
                <div className="pt-1">
                  {sampleFile?.type.startsWith('video/') ? (
                    <video src={previewUrl} controls className="w-full max-h-32 rounded-lg" />
                  ) : (
                    <audio src={previewUrl} controls className="w-full h-9" />
                  )}
                </div>
              )}
            </div>
          )}

          {sampleMode === 'record' && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 flex flex-col items-center gap-3">
              <div className="text-xs text-zinc-300 text-center">
                {recording
                  ? `Recording voice clip... ${recordSec}s`
                  : 'Record your narration or voice sample directly from your microphone.'}
              </div>
              <button
                type="button"
                onClick={recording ? stopRecording : () => void startRecording()}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
                  recording
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-amber-500 hover:bg-amber-400 text-zinc-950'
                }`}
              >
                {recording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                {recording ? 'Stop Recording' : 'Start Mic Recording'}
              </button>
              {previewUrl && !recording && (
                <audio src={previewUrl} controls className="w-full h-9" />
              )}
            </div>
          )}

          {/* Scene Playback Routing Mode when a clip is provided */}
          {sampleMode !== 'traits' && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <AudioLines className="w-3.5 h-3.5 text-cyan-400" />
                Scene Playback Mode
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPlaybackMode('direct-sample')}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    playbackMode === 'direct-sample'
                      ? 'bg-cyan-500/15 border-cyan-400 text-cyan-100'
                      : 'bg-zinc-900/70 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <div className="text-xs font-semibold">Use Recorded Clip</div>
                  <div className="text-[10px] opacity-80 mt-0.5">
                    Plays your actual recorded/uploaded voice in timeline &amp; video export
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setPlaybackMode('speak-script')}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    playbackMode === 'speak-script'
                      ? 'bg-amber-500/15 border-amber-400 text-amber-100'
                      : 'bg-zinc-900/70 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <div className="text-xs font-semibold">Speak Script Mode</div>
                  <div className="text-[10px] opacity-80 mt-0.5">
                    Reads scene text using local system speech + traits (or ElevenLabs if pushed)
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Voice Profile Traits */}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-3.5 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-amber-400" />
              System Speech &amp; EQ Traits
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Tone</label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100"
                >
                  {TONE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Pitch</label>
                <select
                  value={pitch}
                  onChange={(e) => setPitch(e.target.value as VoiceTraits['pitch'])}
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Cadence</label>
                <select
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value as VoiceTraits['cadence'])}
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100"
                >
                  <option value="measured">Measured</option>
                  <option value="conversational">Conversational</option>
                  <option value="brisk">Brisk</option>
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                <span>EQ Warmth &amp; Resonance</span>
                <span className="font-mono text-amber-300">{warmth}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                value={warmth}
                onChange={(e) => setWarmth(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>
          </div>

          {/* Set as Active Explainer Voice Toggle */}
          <label className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-amber-100">
                Set as Active Explainer Voice
              </div>
              <div className="text-[10px] text-amber-200/75">
                Immediately binds primary voice &amp; updates all scenes in this project (sample f0Hz, warmth &amp; cadence analyzed on save)
              </div>
            </div>
            <input
              type="checkbox"
              checked={setAsActiveExplainerVoice}
              onChange={(e) => setSetAsActiveExplainerVoice(e.target.checked)}
              className="w-4 h-4 accent-amber-400 rounded shrink-0"
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
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 px-4 py-2 text-xs font-semibold text-zinc-950"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
              Save Native Voice
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
