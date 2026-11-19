import { useEffect, useState } from 'react';
import { AlertCircle, Database, Film, ImagePlus, Loader2, X } from 'lucide-react';
import type { TechAssetCategory } from '@shared/types';

interface AssetUploadModalProps {
  open: boolean;
  onClose: () => void;
  onUploadAsset: (formData: FormData) => Promise<void>;
  busy: boolean;
}

const CATEGORIES: { value: TechAssetCategory; label: string }[] = [
  { value: 'server-rack', label: 'Server Rack / Cluster' },
  { value: 'hardware', label: 'Hardware / Chip' },
  { value: 'architecture-diagram', label: 'Architecture Diagram' },
  { value: 'lab-environment', label: 'Lab / Data Center' },
  { value: 'product-demo', label: 'Product / UI Demo' },
  { value: 'reference-clip', label: 'Reference Motion Clip' },
];

export function AssetUploadModal({
  open,
  onClose,
  onUploadAsset,
  busy,
}: AssetUploadModalProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<TechAssetCategory>('server-rack');
  const [sourceType, setSourceType] = useState<'photos' | 'video'>('photos');
  const [description, setDescription] = useState('');
  const [technicalSpecs, setTechnicalSpecs] = useState('');
  const [tags, setTags] = useState('gpu, rack, datacenter');
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  if (!open) return null;

  const handleFilesSelected = (list: FileList | null) => {
    setError(null);
    if (!list || list.length === 0) return;
    const arr = Array.from(list);
    if (sourceType === 'photos') {
      if (arr.length > 5) {
        setError('Maximum 5 photos allowed per asset.');
        return;
      }
      if (arr.some((f) => !f.type.startsWith('image/'))) {
        setError('Select PNG, JPG, or WEBP photos.');
        return;
      }
    } else {
      if (arr.length > 1) {
        setError('Upload only 1 video per asset.');
        return;
      }
      if (!arr[0].type.startsWith('video/')) {
        setError('Select an MP4, WEBM, or MOV video.');
        return;
      }
    }
    setFiles(arr);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) {
      setError('Enter an asset name (at least 2 characters).');
      return;
    }
    if (files.length === 0) {
      setError(
        sourceType === 'photos'
          ? 'Upload 1–5 reference photos for this tech asset.'
          : 'Upload 1 reference video for this tech asset.'
      );
      return;
    }

    const fd = new FormData();
    fd.append('name', name.trim());
    fd.append('category', category);
    fd.append('sourceType', sourceType);
    fd.append('description', description.trim());
    fd.append('technicalSpecs', technicalSpecs.trim());
    fd.append('tags', tags);
    files.forEach((f) => fd.append('media', f));

    try {
      await onUploadAsset(fd);
      setName('');
      setDescription('');
      setTechnicalSpecs('');
      setFiles([]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Asset upload failed.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="asset-upload-title"
    >
      <div className="w-full max-w-xl bg-[#0d0d14] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/35 flex items-center justify-center">
              <Database className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 id="asset-upload-title" className="text-sm font-semibold text-zinc-100">
                Import Tech Asset into RAG Context Vault
              </h2>
              <p className="text-[11px] text-zinc-400">
                Indexed automatically for topic generation, Director Prompts &amp; provider push-outs
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

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Asset Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Blackwell GB200 NVL72 Rack"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 px-3 py-2 text-xs text-zinc-100 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Asset Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as TechAssetCategory)}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-100"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setSourceType('photos');
                setFiles([]);
                setError(null);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-medium transition ${
                sourceType === 'photos'
                  ? 'bg-indigo-600/20 border-indigo-400 text-indigo-200'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400'
              }`}
            >
              <ImagePlus className="w-3.5 h-3.5" />
              1–5 Reference Photos
            </button>
            <button
              type="button"
              onClick={() => {
                setSourceType('video');
                setFiles([]);
                setError(null);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-medium transition ${
                sourceType === 'video'
                  ? 'bg-indigo-600/20 border-indigo-400 text-indigo-200'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              1 Reference Video
            </button>
          </div>

          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/70 p-3.5">
            <label className="flex flex-col items-center gap-1.5 cursor-pointer text-center">
              <span className="text-xs font-medium text-zinc-200">
                {sourceType === 'photos'
                  ? 'Select 1–5 tech photos (PNG, JPG, WEBP)'
                  : 'Select 1 reference clip (MP4, WEBM, MOV)'}
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
                  previewUrls.map((u, idx) => (
                    <img
                      key={u}
                      src={u}
                      alt={`Asset ${idx + 1}`}
                      className="w-16 h-16 rounded-lg object-cover border border-indigo-500/40"
                    />
                  ))
                ) : (
                  <video src={previewUrlOrFirst(previewUrls)} controls className="max-h-32 rounded-lg" />
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Technical Specs (indexed for RAG &amp; Stage Callouts)
            </label>
            <input
              type="text"
              value={technicalSpecs}
              onChange={(e) => setTechnicalSpecs(e.target.value)}
              placeholder="e.g. 72 Blackwell GPUs, 130 TB/s NVLink, liquid-cooled manifold"
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Description
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Explain what this photo or video depicts and when scenes should reference it..."
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Retrieval Tags (comma-separated)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="gpu, rack, inference, cluster"
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-100"
            />
          </div>

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
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-2 text-xs font-semibold text-white"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
              Save to RAG Asset Vault
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function previewUrlOrFirst(urls: string[]): string {
  return urls[0] || '';
}
