import { useEffect, useState } from 'react';
import { AlertCircle, Film, ImagePlus, Loader2, Sparkles, UserPlus, X } from 'lucide-react';
import type { CharacterProfile, CharacterSourceType, VoiceProfile } from '@shared/types';

interface CharacterCloningModalProps {
  open: boolean;
  projectId: string;
  voices: VoiceProfile[];
  presets: CharacterProfile[];
  onClose: () => void;
  onCloneSubmit: (formData: FormData) => Promise<void>;
  busy: boolean;
}

const STYLE_PRESETS = [
  'Tech Founder',
  'Cyberpunk Architect',
  'Studio Educator',
  'Quantum Minimalist',
];

export function CharacterCloningModal({
  open,
  projectId,
  voices,
  presets,
  onClose,
  onCloneSubmit,
  busy,
}: CharacterCloningModalProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('AI Systems Explainer');
  const [sourceType, setSourceType] = useState<CharacterSourceType>('photos');
  const [stylePreset, setStylePreset] = useState(STYLE_PRESETS[0]);
  const [voiceId, setVoiceId] = useState(voices[0]?.voice_id || 'mock-rachel');
  const [wardrobe, setWardrobe] = useState('Minimalist charcoal jacket');
  const [lighting, setLighting] = useState('Crisp rim light with studio key');
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (open && voices.length > 0 && !voices.some((v) => v.voice_id === voiceId)) {
      setVoiceId(voices[0].voice_id);
    }
  }, [open, voices, voiceId]);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  if (!open) return null;

  const handleFilesSelected = (selectedList: FileList | null) => {
    setValidationError(null);
    if (!selectedList || selectedList.length === 0) return;
    const arr = Array.from(selectedList);

    if (sourceType === 'photos') {
      if (arr.length > 5) {
        setValidationError('You can upload at most 5 reference photos.');
        return;
      }
      const nonImage = arr.find((f) => !f.type.startsWith('image/'));
      if (nonImage) {
        setValidationError(`"${nonImage.name}" is not a PNG/JPG/WEBP image.`);
        return;
      }
      setFiles(arr);
    } else {
      if (arr.length > 1) {
        setValidationError('Upload only 1 short reference video.');
        return;
      }
      if (!arr[0].type.startsWith('video/')) {
        setValidationError(`"${arr[0].name}" is not an MP4/WEBM/MOV video.`);
        return;
      }
      setFiles(arr);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    if (name.trim().length < 2) {
      setValidationError('Enter a character name (at least 2 characters).');
      return;
    }
    if (sourceType !== 'preset' && files.length === 0) {
      setValidationError(
        sourceType === 'photos'
          ? 'Upload 1–5 reference photos or switch to Preset mode.'
          : 'Upload 1 short reference video or switch to Preset mode.'
      );
      return;
    }

    const fd = new FormData();
    fd.append('name', name.trim());
    fd.append('role', role.trim());
    fd.append('sourceType', sourceType);
    fd.append('stylePreset', stylePreset);
    fd.append('voiceId', voiceId);
    fd.append('projectId', projectId);
    fd.append(
      'traits',
      JSON.stringify({
        wardrobe,
        lighting,
      })
    );
    files.forEach((f) => fd.append('media', f));

    try {
      await onCloneSubmit(fd);
      setName('');
      setFiles([]);
      onClose();
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Character cloning failed.');
    }
  };

  const handleQuickPreset = async (preset: CharacterProfile) => {
    setValidationError(null);
    const fd = new FormData();
    fd.append('name', `${preset.name} Clone`);
    fd.append('role', preset.role);
    fd.append('sourceType', 'preset');
    fd.append('stylePreset', preset.stylePreset);
    fd.append('voiceId', preset.voiceId || voiceId);
    fd.append('projectId', projectId);
    try {
      await onCloneSubmit(fd);
      onClose();
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Failed to clone preset.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#101018] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              Character Cloning Studio (Up to 5 Photos or 1 Short Video)
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Character Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Elena Rostova"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Role / Title
              </label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Source Mode Switcher */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Reference Media Mode
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'photos', label: 'Up to 5 Photos', icon: ImagePlus },
                  { id: 'video', label: '1 Short Video', icon: Film },
                  { id: 'preset', label: 'Styled Preset', icon: Sparkles },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setSourceType(id);
                    setFiles([]);
                    setValidationError(null);
                  }}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-medium transition ${
                    sourceType === id
                      ? 'bg-cyan-500/15 border-cyan-400 text-cyan-200'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Upload Zone */}
          {sourceType !== 'preset' && (
            <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/70 p-4">
              <label className="flex flex-col items-center justify-center gap-2 cursor-pointer text-center">
                <span className="text-xs font-medium text-zinc-200">
                  {sourceType === 'photos'
                    ? 'Select 1–5 portrait photos (PNG, JPG, WEBP • max 25MB each)'
                    : 'Select 1 short reference clip (MP4, WEBM, MOV • max 25MB)'}
                </span>
                <input
                  type="file"
                  multiple={sourceType === 'photos'}
                  accept={
                    sourceType === 'photos'
                      ? 'image/png,image/jpeg,image/webp'
                      : 'video/mp4,video/webm,video/quicktime'
                  }
                  onChange={(e) => handleFilesSelected(e.target.files)}
                  className="text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-200 hover:file:bg-zinc-700"
                />
              </label>

              {previewUrls.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 justify-center">
                  {sourceType === 'photos' ? (
                    previewUrls.map((url, idx) => (
                      <img
                        key={url}
                        src={url}
                        alt={`Reference ${idx + 1}`}
                        className="w-16 h-16 rounded-lg object-cover border border-cyan-500/40"
                      />
                    ))
                  ) : (
                    <video
                      src={previewUrls[0]}
                      controls
                      className="max-h-36 rounded-lg border border-cyan-500/40"
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Trait Extraction & Styling */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Visual Style Preset
              </label>
              <select
                value={stylePreset}
                onChange={(e) => setStylePreset(e.target.value)}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-100"
              >
                {STYLE_PRESETS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Default Voice Pairing
              </label>
              <select
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-100"
              >
                {voices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Extracted Wardrobe Trait
              </label>
              <input
                type="text"
                value={wardrobe}
                onChange={(e) => setWardrobe(e.target.value)}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Stage Lighting Trait
              </label>
              <input
                type="text"
                value={lighting}
                onChange={(e) => setLighting(e.target.value)}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-100"
              />
            </div>
          </div>

          {validationError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-2.5 text-xs text-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {validationError}
            </div>
          )}

          {/* Quick Ready-to-Use Sample Presets */}
          <div className="border-t border-zinc-800 pt-3">
            <div className="text-[11px] font-medium text-zinc-400 mb-2">
              Or add a ready-to-use studio character preset instantly:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void handleQuickPreset(p)}
                  className="rounded-xl border border-zinc-800 hover:border-cyan-500/40 bg-zinc-950 p-2 text-left transition"
                >
                  <div className="text-xs font-semibold text-zinc-100 truncate">{p.name}</div>
                  <div className="text-[10px] text-zinc-400 truncate">{p.stylePreset}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
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
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              Clone Character into Cast
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
