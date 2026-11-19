import crypto from 'node:crypto';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type {
  CharacterSourceType,
  ProviderStatus,
  TechAssetCategory,
  VoiceTraits,
} from '../../shared/types.js';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  MAX_FILE_BYTES,
  PRESET_CHARACTERS,
  buildClonedCharacter,
  normalizeMediaMimeType,
  validateCharacterUpload,
} from '../services/characterService.js';
import {
  applyDirectorPrompt,
  extractProjectSnapshot,
  redoProjectIteration,
  restoreProjectSnapshot,
  undoProjectIteration,
} from '../services/directorEngine.js';
import {
  listElevenLabsVoices,
  pushVoiceToElevenLabs,
  resolveElevenLabsKey,
  synthesizeElevenLabsSpeech,
} from '../services/elevenlabs.js';
import {
  generateGeminiVeoScene,
  pollGeminiVeoJobStatus,
  resolveGeminiVeoKey,
} from '../services/geminiVeo.js';
import {
  generateHiggsfieldScene,
  pollHiggsfieldJobStatus,
  resolveHiggsfieldKey,
} from '../services/higgsfield.js';
import { retrieveRagContext } from '../services/ragContext.js';
import {
  connectConnector,
  disconnectConnector,
  getConnectorDefinition,
  listConnectors,
  testConnectorConnection,
} from '../connectors/registry.js';
import { generateNativeVisualAsset } from '../services/nativeVisualGenerator.js';
import { generateExplainerProject } from '../services/scriptGenerator.js';
import {
  parseAndImportNotebookLm,
  parseAndImportPptx,
} from '../services/sourceImporter.js';
import { analyzeVoiceSampleFile, deriveFallbackAcousticSignature } from '../services/voiceDsp.js';
import { AssetLibrary, validateAssetUpload } from '../store/assetLibrary.js';
import type { CredentialVault } from '../store/credentialVault.js';
import type { ProjectStore } from '../store/projectStore.js';
import { SourceStore } from '../store/sourceStore.js';
import {
  ALLOWED_VOICE_AUDIO_MIMES,
  VoiceStore,
  inferVoiceExtension,
  normalizeMimeType,
  resolveVoiceSampleMimeType,
} from '../store/voiceStore.js';

const GenerateProjectSchema = z.object({
  topic: z.string().min(2).max(300),
  durationMinutes: z.number().min(1).max(30),
  audience: z.enum(['beginner', 'engineering', 'executive']).default('engineering'),
  title: z.string().max(160).optional(),
  primaryVoiceId: z.string().max(120).optional(),
  characterIds: z.array(z.string()).optional(),
  assetIds: z.array(z.string()).optional(),
  sourceIds: z.array(z.string()).optional(),
  autoGenerateVisuals: z.boolean().optional(),
  cinematicStyle: z
    .enum(['Neon Lab', 'Anamorphic Studio', 'Blueprint Isometric', 'Editorial Documentary', 'Quantum Noir'])
    .optional(),
  animationPreset: z
    .enum([
      'diagram-flow',
      'kinetic-cards',
      'slide-deck-reveal',
      'data-pulse',
      'split-comparison',
      'timeline-walkthrough',
      'particle-network',
    ])
    .optional(),
  diagramType: z
    .enum(['auto', 'architecture', 'flow', 'comparison', 'infographic', 'hardware'])
    .optional(),
  musicPreset: z
    .object({
      title: z.string().min(1).max(120),
      mood: z.string().min(1).max(80),
      bpm: z.number().min(50).max(200),
      volumeDb: z.number().min(-40).max(0),
      accentColor: z.string().max(20).optional(),
    })
    .optional(),
});

const PrimaryVoiceSchema = z.object({
  voiceId: z.string().min(1).max(120),
  applyToAllScenes: z.boolean().default(true),
});

const GenerateVisualSchema = z.object({
  prompt: z.string().min(2).max(1500),
  title: z.string().max(160).optional(),
  keyPoints: z.array(z.string()).optional(),
  style: z
    .enum(['Neon Lab', 'Anamorphic Studio', 'Blueprint Isometric', 'Editorial Documentary', 'Quantum Noir'])
    .optional(),
  diagramType: z
    .enum(['auto', 'architecture', 'flow', 'comparison', 'infographic', 'hardware'])
    .optional(),
  projectId: z.string().optional(),
  sceneId: z.string().optional(),
});

const DirectorPromptSchema = z.object({
  prompt: z.string().min(2).max(1000),
});

const TtsSchema = z.object({
  voiceId: z.string().min(1).max(120),
  text: z.string().min(1).max(5000),
  projectId: z.string().optional(),
  sceneId: z.string().optional(),
  playbackMode: z.enum(['auto', 'speak-script', 'direct-sample']).optional(),
});

const HiggsfieldSceneSchema = z.object({
  projectId: z.string().min(1),
  sceneId: z.string().min(1),
});

const PushProviderSchema = z.object({
  provider: z.enum(['higgsfield', 'gemini_veo']),
  projectId: z.string().min(1),
  sceneId: z.string().min(1),
  characterId: z.string().optional(),
});

const ConnectConnectorSchema = z.object({
  apiKey: z.string().trim().min(1, 'API key or Key ID is required').max(512),
  apiSecret: z.string().trim().max(512).optional(),
  endpoint: z.string().trim().max(512).optional(),
  model: z.string().trim().max(160).optional(),
});

const UpdateSceneSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  durationSec: z.number().min(5).max(300).optional(),
  trimStartSec: z.number().min(0).max(295).optional(),
  order: z.number().int().min(0).optional(),
  narration: z.string().min(1).max(5000).optional(),
  visualPrompt: z.string().min(1).max(2000).optional(),
  visualOverlay: z
    .enum(['neural-graph', 'architecture-flow', 'code-terminal', 'packet-stream', 'wave-spectrum'])
    .optional(),
  animationPreset: z
    .enum([
      'diagram-flow',
      'kinetic-cards',
      'slide-deck-reveal',
      'data-pulse',
      'split-comparison',
      'timeline-walkthrough',
      'particle-network',
    ])
    .optional(),
  generatedVisualUrl: z.string().max(500).optional().nullable(),
  cameraMotion: z
    .enum(['Slow Dolly In', 'Orbital Pan', 'Crane Pullback', 'Handheld Micro', 'Rack Focus', 'Static Tripod'])
    .optional(),
  cinematicStyle: z
    .enum(['Neon Lab', 'Anamorphic Studio', 'Blueprint Isometric', 'Editorial Documentary', 'Quantum Noir'])
    .optional(),
  transitionIn: z
    .enum(['Cross Dissolve', 'Whip Pan', 'Glitch Cut', 'Iris Wipe', 'Match Cut'])
    .optional(),
  characterId: z.string().optional().nullable(),
  characterPlacement: z.enum(['left', 'center', 'right', 'split', 'offscreen']).optional(),
  characterStartSec: z.number().min(0).max(3600).optional().nullable(),
  characterDurationSec: z.number().min(2).max(600).optional().nullable(),
  voiceId: z.string().min(1).max(120).optional(),
  voicePlaybackMode: z.enum(['auto', 'speak-script', 'direct-sample']).optional(),
  voiceAudioUrl: z.string().max(500).optional().nullable(),
  voiceStartSec: z.number().min(0).max(3600).optional().nullable(),
  voiceDurationSec: z.number().min(2).max(600).optional().nullable(),
  voiceTrimStartSec: z.number().min(0).max(295).optional(),
  voiceEnabled: z.boolean().optional(),
  keyPoints: z.array(z.string()).optional(),
  assetIds: z.array(z.string()).optional(),
  activeVideoProvider: z.enum(['higgsfield', 'gemini_veo']).optional().nullable(),
});

const ReorderScenesSchema = z.object({
  sceneIds: z.array(z.string().min(1)).min(1),
  historySummary: z.string().max(200).optional(),
});

const CreateSceneSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  durationSec: z.number().min(5).max(300).optional(),
  narration: z.string().min(1).max(5000).optional(),
  visualPrompt: z.string().min(1).max(2000).optional(),
  assetIds: z.array(z.string()).optional(),
  sourceId: z.string().optional(),
  sourceSlideIndex: z.number().int().min(1).optional(),
  generatedVisualUrl: z.string().max(500).optional(),
  characterId: z.string().optional(),
  voiceId: z.string().optional(),
  insertAtIndex: z.number().int().min(0).optional(),
});

const AddMusicSchema = z.object({
  title: z.string().min(1).max(120),
  mood: z.string().min(1).max(80),
  bpm: z.number().min(50).max(200),
  startTimeSec: z.number().min(0),
  durationSec: z.number().min(5).max(1800),
  volumeDb: z.number().min(-40).max(0),
  duckUnderVoice: z.boolean().default(true),
  accentColor: z.string().max(20).optional(),
});

const UpdateMusicSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  mood: z.string().min(1).max(80).optional(),
  bpm: z.number().min(50).max(200).optional(),
  startTimeSec: z.number().min(0).max(3600).optional(),
  durationSec: z.number().min(5).max(1800).optional(),
  volumeDb: z.number().min(-40).max(0).optional(),
  duckUnderVoice: z.boolean().optional(),
  accentColor: z.string().max(20).optional(),
});

const TimelineDropSchema = z.object({
  track: z.enum(['scene', 'character', 'voiceover', 'music']),
  dropSec: z.number().min(0).max(3600),
  targetSceneId: z.string().optional(),
  payload: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('asset'),
      assetId: z.string().min(1),
      name: z.string().optional(),
      sourceType: z.enum(['photos', 'video']).optional(),
      mediaUrl: z.string().optional(),
    }),
    z.object({
      kind: z.literal('source'),
      sourceId: z.string().min(1),
      name: z.string().optional(),
      sourceType: z.enum(['pptx', 'notebooklm-doc', 'notebooklm-audio', 'notes']).optional(),
    }),
    z.object({
      kind: z.literal('source-slide'),
      sourceId: z.string().min(1),
      slideIndex: z.number().int().min(1),
      title: z.string().optional(),
    }),
    z.object({
      kind: z.literal('character'),
      characterId: z.string().min(1),
      name: z.string().optional(),
      voiceId: z.string().optional(),
    }),
    z.object({
      kind: z.literal('voice'),
      voiceId: z.string().min(1),
      name: z.string().optional(),
      sampleUrl: z.string().optional(),
      playbackMode: z.enum(['auto', 'speak-script', 'direct-sample']).optional(),
    }),
    z.object({
      kind: z.literal('music-preset'),
      title: z.string().min(1),
      mood: z.string().min(1),
      bpm: z.number().min(50).max(200),
      volumeDb: z.number().min(-40).max(0),
      accentColor: z.string().optional(),
    }),
  ]),
});

const RagRetrieveSchema = z.object({
  query: z.string().min(1).max(1000),
  projectId: z.string().optional(),
  limit: z.number().min(1).max(12).optional(),
});

function getHeaderKey(req: Request, name: string): string | undefined {
  const val = req.header(name);
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : undefined;
}

function buildConnectorContext(req: Request, vault?: CredentialVault) {
  const headers: Record<string, string | undefined> = {
    'x-elevenlabs-key': getHeaderKey(req, 'x-elevenlabs-key'),
    'x-elevenlabs-endpoint': getHeaderKey(req, 'x-elevenlabs-endpoint'),
    'x-higgsfield-key': getHeaderKey(req, 'x-higgsfield-key'),
    'x-higgsfield-secret': getHeaderKey(req, 'x-higgsfield-secret'),
    'x-higgsfield-endpoint': getHeaderKey(req, 'x-higgsfield-endpoint'),
    'x-higgsfield-model': getHeaderKey(req, 'x-higgsfield-model'),
    'x-gemini-veo-key': getHeaderKey(req, 'x-gemini-veo-key'),
    'x-gemini-veo-endpoint': getHeaderKey(req, 'x-gemini-veo-endpoint'),
    'x-gemini-veo-model': getHeaderKey(req, 'x-gemini-veo-model'),
    'x-character-clone-key': getHeaderKey(req, 'x-character-clone-key'),
    'x-director-llm-key': getHeaderKey(req, 'x-director-llm-key'),
    'x-music-key': getHeaderKey(req, 'x-music-key'),
  };
  const disabledRaw = getHeaderKey(req, 'x-connectors-demo-disabled') || '';
  const demoDisabledIds = new Set(
    disabledRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return { headers, demoDisabledIds, vault };
}

export function createApiRouter(
  store: ProjectStore,
  vault?: CredentialVault,
  voiceStoreArg?: VoiceStore,
  assetLibraryArg?: AssetLibrary,
  sourceStoreArg?: SourceStore
): express.Router {
  const router = express.Router();
  const baseDataDir = path.dirname(store.getUploadsDir());
  const voiceStore = voiceStoreArg || new VoiceStore(baseDataDir);
  const assetLibrary = assetLibraryArg || new AssetLibrary(baseDataDir);
  const sourceStore = sourceStoreArg || new SourceStore(baseDataDir);

  const sourceMemoryUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 40 * 1024 * 1024,
      files: 1,
    },
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: async (_req, _file, cb) => {
        try {
          await store.ensureInitialized();
          cb(null, store.getUploadsDir());
        } catch (err) {
          cb(err as Error, '');
        }
      },
      filename: (_req, file, cb) => {
        const rawExt = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
        const norm = normalizeMediaMimeType(file.mimetype, file.originalname);
        const inferred =
          norm === 'image/png'
            ? '.png'
            : norm === 'image/jpeg' || norm === 'image/jpg'
              ? '.jpg'
              : norm === 'image/webp'
                ? '.webp'
                : norm === 'video/mp4'
                  ? '.mp4'
                  : norm === 'video/webm'
                    ? '.webm'
                    : norm === 'video/quicktime'
                      ? '.mov'
                      : '.bin';
        const ext = rawExt || inferred;
        cb(null, `char-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
      },
    }),
    limits: {
      fileSize: MAX_FILE_BYTES,
      files: 6,
    },
    fileFilter: (_req, file, cb) => {
      const norm = normalizeMediaMimeType(file.mimetype, file.originalname);
      if (ALLOWED_IMAGE_MIME_TYPES.has(norm) || ALLOWED_VIDEO_MIME_TYPES.has(norm)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type "${file.mimetype}".`));
      }
    },
  });

  const voiceUpload = multer({
    storage: multer.diskStorage({
      destination: async (_req, _file, cb) => {
        try {
          await voiceStore.ensureInitialized();
          cb(null, voiceStore.getVoicesUploadDir());
        } catch (err) {
          cb(err as Error, '');
        }
      },
      filename: (_req, file, cb) => {
        const ext = inferVoiceExtension(file.mimetype, file.originalname);
        cb(null, `voice-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
      },
    }),
    limits: {
      fileSize: MAX_FILE_BYTES,
      files: 1,
    },
    fileFilter: (_req, file, cb) => {
      const resolvedMime = resolveVoiceSampleMimeType(file.mimetype, file.originalname);
      if (resolvedMime && ALLOWED_VOICE_AUDIO_MIMES.has(resolvedMime)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported voice sample type "${file.mimetype}".`));
      }
    },
  });

  const assetUpload = multer({
    storage: multer.diskStorage({
      destination: async (_req, _file, cb) => {
        try {
          await assetLibrary.ensureInitialized();
          cb(null, assetLibrary.getAssetsUploadDir());
        } catch (err) {
          cb(err as Error, '');
        }
      },
      filename: (_req, file, cb) => {
        const rawExt = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
        const norm = normalizeMediaMimeType(file.mimetype, file.originalname);
        const inferred =
          norm === 'image/png'
            ? '.png'
            : norm === 'image/jpeg' || norm === 'image/jpg'
              ? '.jpg'
              : norm === 'image/webp'
                ? '.webp'
                : norm === 'video/mp4'
                  ? '.mp4'
                  : norm === 'video/webm'
                    ? '.webm'
                    : norm === 'video/quicktime'
                      ? '.mov'
                      : '.bin';
        const ext = rawExt || inferred;
        cb(null, `asset-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
      },
    }),
    limits: {
      fileSize: MAX_FILE_BYTES,
      files: 6,
    },
    fileFilter: (_req, file, cb) => {
      const norm = normalizeMediaMimeType(file.mimetype, file.originalname);
      if (ALLOWED_IMAGE_MIME_TYPES.has(norm) || ALLOWED_VIDEO_MIME_TYPES.has(norm)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported asset file type "${file.mimetype}".`));
      }
    },
  });

  // Health & Provider status (never leaks secrets)
  router.get('/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  router.get('/providers/status', (req, res) => {
    const el = resolveElevenLabsKey(getHeaderKey(req, 'x-elevenlabs-key'), vault);
    const hf = resolveHiggsfieldKey(getHeaderKey(req, 'x-higgsfield-key'), vault, {
      sessionSecret: getHeaderKey(req, 'x-higgsfield-secret'),
      sessionEndpoint: getHeaderKey(req, 'x-higgsfield-endpoint'),
      sessionModel: getHeaderKey(req, 'x-higgsfield-model'),
    });
    const veo = resolveGeminiVeoKey(getHeaderKey(req, 'x-gemini-veo-key'), vault, {
      sessionEndpoint: getHeaderKey(req, 'x-gemini-veo-endpoint'),
      sessionModel: getHeaderKey(req, 'x-gemini-veo-model'),
    });
    const status: ProviderStatus = {
      elevenlabs: {
        configured: Boolean(el.key),
        source: el.source,
      },
      higgsfield: {
        configured: Boolean(hf.key),
        source: hf.source,
      },
      gemini_veo: {
        configured: Boolean(veo.key),
        source: veo.source,
      },
    };
    res.json(status);
  });

  // Dedicated 6-slot API Connectors Registry
  router.get('/connectors', (req, res) => {
    const connectors = listConnectors(buildConnectorContext(req, vault));
    res.json({ connectors });
  });

  router.post('/connectors/:id/test', async (req, res, next) => {
    try {
      const def = getConnectorDefinition(req.params.id);
      if (!def) {
        res.status(404).json({ error: `Unknown connector "${req.params.id}".` });
        return;
      }
      const result = await testConnectorConnection(def.id, buildConnectorContext(req, vault));
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/connectors/:id/connect', async (req, res, next) => {
    try {
      const def = getConnectorDefinition(req.params.id);
      if (!def) {
        res.status(404).json({ error: `Unknown connector "${req.params.id}".` });
        return;
      }
      const parsed = ConnectConnectorSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          ok: false,
          error: parsed.error.issues[0]?.message || 'Invalid connector credentials.',
          details: parsed.error.flatten(),
        });
        return;
      }

      const response = await connectConnector(
        def.id,
        parsed.data,
        buildConnectorContext(req, vault)
      );
      if (!response.ok) {
        res.status(400).json(response);
        return;
      }
      res.json(response);
    } catch (err) {
      next(err);
    }
  });

  router.post('/connectors/:id/disconnect', async (req, res, next) => {
    try {
      const def = getConnectorDefinition(req.params.id);
      if (!def) {
        res.status(404).json({ error: `Unknown connector "${req.params.id}".` });
        return;
      }
      const connector = await disconnectConnector(def.id, buildConnectorContext(req, vault));
      res.json({ ok: true, connector });
    } catch (err) {
      next(err);
    }
  });

  // Projects CRUD & Generation (1–30 minutes + RAG Asset grounding)
  router.get('/projects', async (_req, res, next) => {
    try {
      const projects = await store.listProjects();
      res.json({ projects });
    } catch (err) {
      next(err);
    }
  });

  router.get('/projects/:id', async (req, res, next) => {
    try {
      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      res.json({ project });
    } catch (err) {
      next(err);
    }
  });

  router.post('/projects/generate', async (req, res, next) => {
    try {
      const parsed = GenerateProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid project parameters.', details: parsed.error.flatten() });
        return;
      }

      const [allChars, allAssets, selectedSources] = await Promise.all([
        store.listCharacters(),
        assetLibrary.listAssets(),
        sourceStore.getSourcesByIds(parsed.data.sourceIds || []),
      ]);
      const customChars = allChars.filter((c) => !c.isPreset);
      const presetChars = allChars.filter((c) => c.isPreset);
      const defaultChars = [...customChars, ...presetChars].slice(0, 4);
      const selectedChars =
        parsed.data.characterIds && parsed.data.characterIds.length > 0
          ? allChars.filter((c) => parsed.data.characterIds!.includes(c.id))
          : defaultChars;

      const project = generateExplainerProject({
        topic: parsed.data.topic,
        durationMinutes: parsed.data.durationMinutes,
        audience: parsed.data.audience,
        title: parsed.data.title,
        primaryVoiceId: parsed.data.primaryVoiceId,
        characters: selectedChars.length > 0 ? selectedChars : PRESET_CHARACTERS,
        assets: allAssets,
        preferredAssetIds: parsed.data.assetIds,
        sources: selectedSources,
        cinematicStyle: parsed.data.cinematicStyle,
        animationPreset: parsed.data.animationPreset,
        musicPreset: parsed.data.musicPreset,
      });

      // Auto-generate native prompt-exact SVG visuals for scenes
      if (parsed.data.autoGenerateVisuals !== false) {
        const assetMap = new Map(allAssets.map((a) => [a.id, a]));
        for (const sc of project.scenes) {
          const strongUploadedPhoto = (sc.ragContext || []).some((m) => {
            if (m.sourceType !== 'asset') return false;
            const a = assetMap.get(m.id);
            const isStarter = a?.id.startsWith('asset-gpu-rack') || a?.id.startsWith('asset-kv-cache');
            return a && a.sourceType === 'photos' && a.mediaUrls.length > 0 && (!isStarter || m.score >= 4);
          });
          const generated = await generateNativeVisualAsset({
            prompt: sc.visualPrompt,
            title: sc.title,
            keyPoints: sc.keyPoints,
            style: sc.cinematicStyle,
            diagramType: parsed.data.diagramType || 'auto',
            uploadsRootDir: store.getUploadsDir(),
            assetLibrary,
          });
          sc.generatedVisualUrl = generated.visualUrl;
          const generatedRagEntry = {
            sourceType: 'asset' as const,
            id: generated.asset.id,
            name: generated.asset.name,
            category: generated.asset.category,
            score: 9,
            matchedTerms: ['generated-svg'],
            snippet: generated.asset.technicalSpecs,
            mediaUrl: generated.visualUrl,
            mediaType: 'image' as const,
          };
          if (strongUploadedPhoto) {
            sc.assetIds = [...(sc.assetIds || []), generated.asset.id];
            sc.ragContext = [...(sc.ragContext || []), generatedRagEntry];
          } else {
            sc.assetIds = [generated.asset.id, ...(sc.assetIds || [])];
            sc.ragContext = [generatedRagEntry, ...(sc.ragContext || [])];
          }
        }
      }

      const saved = await store.saveProject(project);
      res.status(201).json({ project: saved });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/projects/:id', async (req, res, next) => {
    try {
      const removed = await store.deleteProject(req.params.id);
      if (!removed) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  });

  // Scene reorder (must come before :sceneId param route)
  router.patch('/projects/:id/scenes/reorder', async (req, res, next) => {
    try {
      const parsed = ReorderScenesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid scene reorder payload.', details: parsed.error.flatten() });
        return;
      }

      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }

      const byId = new Map(project.scenes.map((s) => [s.id, s]));
      const ordered: typeof project.scenes = [];
      const seen = new Set<string>();
      for (const id of parsed.data.sceneIds) {
        const sc = byId.get(id);
        if (sc && !seen.has(id)) {
          ordered.push(sc);
          seen.add(id);
        }
      }
      for (const sc of project.scenes) {
        if (!seen.has(sc.id)) ordered.push(sc);
      }

      ordered.forEach((sc, idx) => {
        sc.order = idx;
      });
      project.scenes = ordered;

      project.history.push({
        id: `hist-${crypto.randomUUID().slice(0, 6)}`,
        timestamp: new Date().toISOString(),
        prompt: parsed.data.historySummary || 'Reorder timeline scenes',
        summary: parsed.data.historySummary || `Reordered ${project.scenes.length} scenes on timeline`,
        actions: ['Reordered scenes on timeline'],
        projectState: extractProjectSnapshot(project),
      });
      project.redoStack = [];

      const saved = await store.saveProject(project);
      res.json({ project: saved });
    } catch (err) {
      next(err);
    }
  });

  // Create/insert a scene directly
  router.post('/projects/:id/scenes', async (req, res, next) => {
    try {
      const parsed = CreateSceneSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid scene payload.', details: parsed.error.flatten() });
        return;
      }

      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }

      const allAssets = await assetLibrary.listAssets();
      const attachedAssets = (parsed.data.assetIds || [])
        .map((id) => allAssets.find((a) => a.id === id))
        .filter((a): a is NonNullable<typeof a> => Boolean(a));

      const defaultTitle =
        parsed.data.title ||
        attachedAssets[0]?.name ||
        `Scene ${project.scenes.length + 1}`;
      const durationSec = parsed.data.durationSec ?? 25;
      const chapterId =
        project.chapters[project.chapters.length - 1]?.id ||
        `chap-${crypto.randomUUID().slice(0, 6)}`;

      const newScene = {
        id: `scene-${project.scenes.length + 1}-${crypto.randomUUID().slice(0, 6)}`,
        chapterId,
        order: project.scenes.length,
        title: defaultTitle,
        durationSec,
        narration:
          parsed.data.narration ||
          `Walking through ${defaultTitle} and how it fits into ${project.topic}.`,
        visualPrompt:
          parsed.data.visualPrompt ||
          `Visual diagram and scene showcasing ${defaultTitle} for ${project.topic}.`,
        visualOverlay: 'architecture-flow' as const,
        animationPreset: 'diagram-flow' as const,
        generatedVisualUrl:
          parsed.data.generatedVisualUrl ||
          (attachedAssets[0]?.sourceType === 'photos' ? attachedAssets[0].mediaUrls[0] : undefined),
        sourceId: parsed.data.sourceId,
        sourceSlideIndex: parsed.data.sourceSlideIndex,
        cameraMotion: 'Slow Dolly In' as const,
        cinematicStyle: project.scenes[0]?.cinematicStyle || ('Neon Lab' as const),
        transitionIn: 'Cross Dissolve' as const,
        characterId: parsed.data.characterId || project.characters[0]?.id,
        characterPlacement: 'left' as const,
        voiceId: parsed.data.voiceId || project.primaryVoiceId,
        voiceStatus: 'fallback' as const,
        voiceEnabled: true,
        higgsfield: {
          status: 'fallback' as const,
          provider: 'canvas-fallback' as const,
          renderNote: 'Live 60fps canvas ready.',
          updatedAt: new Date().toISOString(),
        },
        assetIds: attachedAssets.map((a) => a.id),
        ragContext: attachedAssets.map((a) => ({
          sourceType: 'asset' as const,
          id: a.id,
          name: a.name,
          category: a.category,
          score: 10,
          matchedTerms: ['timeline-drop'],
          snippet: a.technicalSpecs || a.description,
          mediaUrl: a.mediaUrls[0],
          mediaType: (a.sourceType === 'video' ? 'video' : 'image') as 'image' | 'video',
        })),
        keyPoints: [defaultTitle],
      };

      const insertIdx =
        parsed.data.insertAtIndex !== undefined
          ? Math.max(0, Math.min(project.scenes.length, parsed.data.insertAtIndex))
          : project.scenes.length;
      project.scenes.splice(insertIdx, 0, newScene);
      project.scenes.forEach((sc, idx) => {
        sc.order = idx;
      });

      const totalSec = project.scenes.reduce((acc, sc) => acc + sc.durationSec, 0);
      project.targetDurationMinutes = Math.max(1, Math.min(30, Math.round(totalSec / 60)));

      project.history.push({
        id: `hist-${crypto.randomUUID().slice(0, 6)}`,
        timestamp: new Date().toISOString(),
        prompt: `Add timeline scene "${newScene.title}"`,
        summary: `Added scene "${newScene.title}" (${durationSec}s) to timeline`,
        actions: [`Added scene ${newScene.title}`],
        projectState: extractProjectSnapshot(project),
      });
      project.redoStack = [];

      const saved = await store.saveProject(project);
      res.status(201).json({ project: saved, scene: newScene });
    } catch (err) {
      next(err);
    }
  });

  // Delete a scene from timeline
  router.delete('/projects/:id/scenes/:sceneId', async (req, res, next) => {
    try {
      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      if (project.scenes.length <= 1) {
        res.status(400).json({ error: 'Cannot delete the only remaining scene in a project.' });
        return;
      }
      const idx = project.scenes.findIndex((s) => s.id === req.params.sceneId);
      if (idx === -1) {
        res.status(404).json({ error: 'Scene not found.' });
        return;
      }
      const [removed] = project.scenes.splice(idx, 1);
      project.scenes.forEach((sc, i) => {
        sc.order = i;
      });

      const totalSec = project.scenes.reduce((acc, sc) => acc + sc.durationSec, 0);
      project.targetDurationMinutes = Math.max(1, Math.min(30, Math.round(totalSec / 60)));

      project.history.push({
        id: `hist-${crypto.randomUUID().slice(0, 6)}`,
        timestamp: new Date().toISOString(),
        prompt: `Delete scene "${removed.title}"`,
        summary: `Deleted scene "${removed.title}" from timeline`,
        actions: [`Deleted scene ${removed.title}`],
        projectState: extractProjectSnapshot(project),
      });
      project.redoStack = [];

      const saved = await store.saveProject(project);
      res.json({ project: saved });
    } catch (err) {
      next(err);
    }
  });

  // Scene direct update
  router.patch('/projects/:id/scenes/:sceneId', async (req, res, next) => {
    try {
      const parsed = UpdateSceneSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid scene update.', details: parsed.error.flatten() });
        return;
      }

      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }

      const scene = project.scenes.find((s) => s.id === req.params.sceneId);
      if (!scene) {
        res.status(404).json({ error: 'Scene not found.' });
        return;
      }

      const updates = parsed.data;
      if (updates.title !== undefined) scene.title = updates.title;
      if (updates.durationSec !== undefined) scene.durationSec = updates.durationSec;
      if (updates.trimStartSec !== undefined) scene.trimStartSec = updates.trimStartSec;
      if (updates.narration !== undefined) scene.narration = updates.narration;
      if (updates.visualPrompt !== undefined) scene.visualPrompt = updates.visualPrompt;
      if (updates.visualOverlay !== undefined) scene.visualOverlay = updates.visualOverlay;
      if (updates.animationPreset !== undefined) scene.animationPreset = updates.animationPreset;
      if (updates.generatedVisualUrl !== undefined) {
        scene.generatedVisualUrl = updates.generatedVisualUrl || undefined;
      }
      if (updates.cameraMotion !== undefined) scene.cameraMotion = updates.cameraMotion;
      if (updates.cinematicStyle !== undefined) scene.cinematicStyle = updates.cinematicStyle;
      if (updates.transitionIn !== undefined) scene.transitionIn = updates.transitionIn;
      if (updates.characterId !== undefined) {
        scene.characterId = updates.characterId || undefined;
        if (!updates.characterId) {
          scene.characterStartSec = undefined;
          scene.characterDurationSec = undefined;
        }
      }
      if (updates.characterPlacement !== undefined) scene.characterPlacement = updates.characterPlacement;
      if (updates.characterStartSec !== undefined) {
        scene.characterStartSec = updates.characterStartSec === null ? undefined : updates.characterStartSec;
      }
      if (updates.characterDurationSec !== undefined) {
        scene.characterDurationSec =
          updates.characterDurationSec === null ? undefined : updates.characterDurationSec;
      }
      if (updates.voiceId !== undefined) scene.voiceId = updates.voiceId;
      if (updates.voicePlaybackMode !== undefined) {
        scene.voicePlaybackMode = updates.voicePlaybackMode;
      }
      if (updates.voiceAudioUrl !== undefined) {
        scene.voiceAudioUrl = updates.voiceAudioUrl || undefined;
      }
      if (updates.voiceStartSec !== undefined) {
        scene.voiceStartSec = updates.voiceStartSec === null ? undefined : updates.voiceStartSec;
      }
      if (updates.voiceDurationSec !== undefined) {
        scene.voiceDurationSec =
          updates.voiceDurationSec === null ? undefined : updates.voiceDurationSec;
      }
      if (updates.voiceTrimStartSec !== undefined) {
        scene.voiceTrimStartSec = updates.voiceTrimStartSec;
      }
      if (updates.voiceEnabled !== undefined) {
        scene.voiceEnabled = updates.voiceEnabled;
      }
      if (updates.keyPoints !== undefined) {
        scene.keyPoints = updates.keyPoints;
      }
      if (updates.activeVideoProvider !== undefined) {
        scene.activeVideoProvider = updates.activeVideoProvider || undefined;
      }
      if (updates.assetIds !== undefined) {
        scene.assetIds = updates.assetIds;
        const allAssets = await assetLibrary.listAssets();
        const attachedAssets = allAssets.filter((a) => updates.assetIds!.includes(a.id));
        const existingNonAsset = (scene.ragContext || []).filter((r) => r.sourceType !== 'asset');
        scene.ragContext = [
          ...attachedAssets.map((a) => ({
            sourceType: 'asset' as const,
            id: a.id,
            name: a.name,
            category: a.category,
            score: 10,
            matchedTerms: ['attached'],
            snippet: a.technicalSpecs || a.description,
            mediaUrl: a.mediaUrls[0],
            mediaType: (a.sourceType === 'video' ? 'video' : 'image') as 'image' | 'video',
          })),
          ...existingNonAsset,
        ];
      }

      const totalSec = project.scenes.reduce((acc, sc) => acc + sc.durationSec, 0);
      project.targetDurationMinutes = Math.max(1, Math.min(30, Math.round(totalSec / 60)));

      project.history.push({
        id: `hist-${crypto.randomUUID().slice(0, 6)}`,
        timestamp: new Date().toISOString(),
        prompt: `Manual edit: ${scene.title}`,
        summary: `Updated properties on "${scene.title}"`,
        actions: [`Edited ${scene.title}`],
        projectState: extractProjectSnapshot(project),
      });
      project.redoStack = [];

      const saved = await store.saveProject(project);
      res.json({ project: saved, scene });
    } catch (err) {
      next(err);
    }
  });

  // Bind project primary voice & update all scenes atomically
  router.patch('/projects/:id/primary-voice', async (req, res, next) => {
    try {
      const parsed = PrimaryVoiceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid primary voice payload.', details: parsed.error.flatten() });
        return;
      }
      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      project.primaryVoiceId = parsed.data.voiceId;
      if (parsed.data.applyToAllScenes) {
        for (const sc of project.scenes) {
          sc.voiceId = parsed.data.voiceId;
        }
      }
      project.history.push({
        id: `hist-${crypto.randomUUID().slice(0, 6)}`,
        timestamp: new Date().toISOString(),
        prompt: `Set active explainer voice to ${parsed.data.voiceId}`,
        summary: `Activated voice "${parsed.data.voiceId}" across ${parsed.data.applyToAllScenes ? 'all scenes' : 'project primary voice'}`,
        actions: [`Activated explainer voice ${parsed.data.voiceId}`],
        projectState: extractProjectSnapshot(project),
      });
      project.redoStack = [];
      const saved = await store.saveProject(project);
      res.json({ project: saved });
    } catch (err) {
      next(err);
    }
  });

  // Per-scene Record Scene Take / Attach Recorded Audio Clip
  router.post(
    '/projects/:id/scenes/:sceneId/voice-take',
    (req, res, next) => {
      voiceUpload.fields([
        { name: 'audio', maxCount: 1 },
        { name: 'sample', maxCount: 1 },
      ])(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err.message || 'Scene voice take upload failed.' });
          return;
        }
        next();
      });
    },
    async (req, res, next) => {
      try {
        const project = await store.getProject(req.params.id);
        if (!project) {
          res.status(404).json({ error: 'Project not found.' });
          return;
        }
        const scene = project.scenes.find((s) => s.id === req.params.sceneId);
        if (!scene) {
          res.status(404).json({ error: 'Scene not found.' });
          return;
        }
        const filesMap = req.files as Record<string, Express.Multer.File[]> | undefined;
        const file = filesMap?.audio?.[0] || filesMap?.sample?.[0];
        if (!file) {
          res.status(400).json({ error: 'Audio clip file is required (field "audio" or "sample").' });
          return;
        }
        const voiceAudioUrl = `/uploads/voices/${path.basename(file.path)}`;
        scene.voiceAudioUrl = voiceAudioUrl;
        scene.voicePlaybackMode = 'direct-sample';
        scene.voiceStatus = 'synthesized';
        project.history.push({
          id: `hist-${crypto.randomUUID().slice(0, 6)}`,
          timestamp: new Date().toISOString(),
          prompt: `Record scene take for "${scene.title}"`,
          summary: `Attached recorded audio take to "${scene.title}"`,
          actions: [`Attached recorded audio take to ${scene.title}`],
          projectState: extractProjectSnapshot(project),
        });
        project.redoStack = [];
        const saved = await store.saveProject(project);
        res.status(201).json({ project: saved, scene, voiceAudioUrl });
      } catch (err) {
        next(err);
      }
    }
  );

  router.delete('/projects/:id/scenes/:sceneId/voice-take', async (req, res, next) => {
    try {
      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const scene = project.scenes.find((s) => s.id === req.params.sceneId);
      if (!scene) {
        res.status(404).json({ error: 'Scene not found.' });
        return;
      }
      scene.voiceAudioUrl = undefined;
      scene.voicePlaybackMode = 'speak-script';
      scene.voiceStatus = 'fallback';
      const saved = await store.saveProject(project);
      res.json({ project: saved, scene });
    } catch (err) {
      next(err);
    }
  });

  // Add music track directly
  router.post('/projects/:id/music', async (req, res, next) => {
    try {
      const parsed = AddMusicSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid music track payload.', details: parsed.error.flatten() });
        return;
      }
      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }

      const track = {
        id: `music-${crypto.randomUUID().slice(0, 6)}`,
        ...parsed.data,
        accentColor: parsed.data.accentColor || '#10b981',
      };
      project.musicTracks.push(track);
      project.history.push({
        id: `hist-${crypto.randomUUID().slice(0, 6)}`,
        timestamp: new Date().toISOString(),
        prompt: `Add music track "${track.title}"`,
        summary: `Added ${track.title} (${track.bpm} BPM)`,
        actions: [`Added music track "${track.title}"`],
        projectState: extractProjectSnapshot(project),
      });
      project.redoStack = [];

      const saved = await store.saveProject(project);
      res.status(201).json({ project: saved, track });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/projects/:id/music/:trackId', async (req, res, next) => {
    try {
      const parsed = UpdateMusicSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid music track update.', details: parsed.error.flatten() });
        return;
      }
      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const track = project.musicTracks.find((m) => m.id === req.params.trackId);
      if (!track) {
        res.status(404).json({ error: 'Music track not found.' });
        return;
      }
      const updates = parsed.data;
      if (updates.title !== undefined) track.title = updates.title;
      if (updates.mood !== undefined) track.mood = updates.mood;
      if (updates.bpm !== undefined) track.bpm = updates.bpm;
      if (updates.startTimeSec !== undefined) track.startTimeSec = updates.startTimeSec;
      if (updates.durationSec !== undefined) track.durationSec = updates.durationSec;
      if (updates.volumeDb !== undefined) track.volumeDb = updates.volumeDb;
      if (updates.duckUnderVoice !== undefined) track.duckUnderVoice = updates.duckUnderVoice;
      if (updates.accentColor !== undefined) track.accentColor = updates.accentColor;

      project.history.push({
        id: `hist-${crypto.randomUUID().slice(0, 6)}`,
        timestamp: new Date().toISOString(),
        prompt: `Update music track "${track.title}"`,
        summary: `Updated "${track.title}" (${track.startTimeSec}s, ${track.durationSec}s)`,
        actions: [`Updated music track "${track.title}"`],
        projectState: extractProjectSnapshot(project),
      });
      project.redoStack = [];

      const saved = await store.saveProject(project);
      res.json({ project: saved, track });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/projects/:id/music/:trackId', async (req, res, next) => {
    try {
      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const removed = project.musicTracks.find((m) => m.id === req.params.trackId);
      if (!removed) {
        res.status(404).json({ error: 'Music track not found.' });
        return;
      }
      project.musicTracks = project.musicTracks.filter((m) => m.id !== req.params.trackId);
      project.history.push({
        id: `hist-${crypto.randomUUID().slice(0, 6)}`,
        timestamp: new Date().toISOString(),
        prompt: `Delete music track "${removed.title}"`,
        summary: `Removed music bed "${removed.title}" from timeline`,
        actions: [`Deleted music track "${removed.title}"`],
        projectState: extractProjectSnapshot(project),
      });
      project.redoStack = [];
      const saved = await store.saveProject(project);
      res.json({ project: saved });
    } catch (err) {
      next(err);
    }
  });

  // Unified timeline drag-and-drop attach/create handler
  router.post('/projects/:id/timeline/drop', async (req, res, next) => {
    try {
      const parsed = TimelineDropSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid timeline drop payload.', details: parsed.error.flatten() });
        return;
      }

      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }

      const { track, dropSec, targetSceneId, payload } = parsed.data;
      const totalSec = project.scenes.reduce((s, sc) => s + sc.durationSec, 0);

      const resolveSceneAtSec = (sec: number) => {
        if (targetSceneId) {
          const explicit = project.scenes.find((s) => s.id === targetSceneId);
          if (explicit) return explicit;
        }
        let cursor = 0;
        for (const sc of project.scenes) {
          if (sec >= cursor && sec < cursor + sc.durationSec) {
            return sc;
          }
          cursor += sc.durationSec;
        }
        return project.scenes[project.scenes.length - 1] || project.scenes[0];
      };

      let actionSummary = '';

      if (payload.kind === 'music-preset') {
        const startSec = Math.max(0, Math.round(dropSec));
        const durationSec = Math.max(15, Math.min(180, Math.round((totalSec || 60) / 2)));
        const newTrack = {
          id: `music-${crypto.randomUUID().slice(0, 6)}`,
          title: payload.title,
          mood: payload.mood,
          bpm: payload.bpm,
          startTimeSec: startSec,
          durationSec,
          volumeDb: payload.volumeDb,
          duckUnderVoice: true,
          accentColor: payload.accentColor || '#10b981',
        };
        project.musicTracks.push(newTrack);
        actionSummary = `Dropped music bed "${newTrack.title}" at ${startSec}s`;
      } else if (payload.kind === 'character') {
        const [allChars] = await Promise.all([store.listCharacters()]);
        const charObj =
          project.characters.find((c) => c.id === payload.characterId) ||
          allChars.find((c) => c.id === payload.characterId);
        if (!charObj) {
          res.status(404).json({ error: 'Character not found.' });
          return;
        }
        if (!project.characters.some((c) => c.id === charObj.id)) {
          project.characters.push(charObj);
        }
        const targetScene = resolveSceneAtSec(dropSec);
        if (!targetScene) {
          res.status(400).json({ error: 'Project has no scenes.' });
          return;
        }
        targetScene.characterId = charObj.id;
        if (targetScene.characterPlacement === 'offscreen') {
          targetScene.characterPlacement = 'left';
        }
        if (track === 'character') {
          targetScene.characterStartSec = Math.max(0, Math.round(dropSec));
          targetScene.characterDurationSec =
            targetScene.characterDurationSec ?? targetScene.durationSec;
        }
        actionSummary = `Assigned character "${charObj.name}" at ${Math.round(dropSec)}s`;
      } else if (payload.kind === 'voice') {
        const targetScene = resolveSceneAtSec(dropSec);
        if (!targetScene) {
          res.status(400).json({ error: 'Project has no scenes.' });
          return;
        }
        targetScene.voiceId = payload.voiceId;
        targetScene.voiceEnabled = true;
        if (payload.playbackMode === 'direct-sample' && payload.sampleUrl) {
          targetScene.voicePlaybackMode = 'direct-sample';
        }
        if (track === 'voiceover') {
          targetScene.voiceStartSec = Math.max(0, Math.round(dropSec));
          targetScene.voiceDurationSec =
            targetScene.voiceDurationSec ?? targetScene.durationSec;
        }
        actionSummary = `Dropped voice "${payload.name || payload.voiceId}" onto "${targetScene.title}"`;
      } else if (payload.kind === 'asset') {
        const allAssets = await assetLibrary.listAssets();
        const asset = allAssets.find((a) => a.id === payload.assetId);
        if (!asset) {
          res.status(404).json({ error: 'Asset not found.' });
          return;
        }
        const shouldCreateNewScene =
          track === 'scene' && !targetSceneId && dropSec >= totalSec - 0.5;
        if (shouldCreateNewScene || project.scenes.length === 0) {
          const chapterId =
            project.chapters[project.chapters.length - 1]?.id ||
            `chap-${crypto.randomUUID().slice(0, 6)}`;
          const newScene = {
            id: `scene-${project.scenes.length + 1}-${crypto.randomUUID().slice(0, 6)}`,
            chapterId,
            order: project.scenes.length,
            title: asset.name,
            durationSec: 25,
            narration: `Examining ${asset.name}: ${asset.technicalSpecs || asset.description}`,
            visualPrompt: `${asset.name} technical visual — ${asset.description}`,
            visualOverlay: 'architecture-flow' as const,
            animationPreset: 'diagram-flow' as const,
            generatedVisualUrl:
              asset.sourceType === 'photos' && asset.mediaUrls[0] ? asset.mediaUrls[0] : undefined,
            cameraMotion: 'Slow Dolly In' as const,
            cinematicStyle: project.scenes[0]?.cinematicStyle || ('Neon Lab' as const),
            transitionIn: 'Cross Dissolve' as const,
            characterId: project.characters[0]?.id,
            characterPlacement: 'left' as const,
            voiceId: project.primaryVoiceId,
            voiceStatus: 'fallback' as const,
            voiceEnabled: true,
            higgsfield: {
              status: 'fallback' as const,
              provider: 'canvas-fallback' as const,
              renderNote: `Created from asset "${asset.name}".`,
              updatedAt: new Date().toISOString(),
            },
            assetIds: [asset.id],
            ragContext: [
              {
                sourceType: 'asset' as const,
                id: asset.id,
                name: asset.name,
                category: asset.category,
                score: 10,
                matchedTerms: ['timeline-drop'],
                snippet: asset.technicalSpecs || asset.description,
                mediaUrl: asset.mediaUrls[0],
                mediaType: (asset.sourceType === 'video' ? 'video' : 'image') as 'image' | 'video',
              },
            ],
            keyPoints: [asset.name],
          };
          project.scenes.push(newScene);
          actionSummary = `Created scene "${asset.name}" from dropped asset`;
        } else {
          const targetScene = resolveSceneAtSec(dropSec)!;
          targetScene.assetIds = Array.from(new Set([asset.id, ...(targetScene.assetIds || [])]));
          if (asset.sourceType === 'photos' && asset.mediaUrls[0] && asset.mediaUrls[0].endsWith('.svg')) {
            targetScene.generatedVisualUrl = asset.mediaUrls[0];
          }
          const newEntry = {
            sourceType: 'asset' as const,
            id: asset.id,
            name: asset.name,
            category: asset.category,
            score: 10,
            matchedTerms: ['timeline-drop'],
            snippet: asset.technicalSpecs || asset.description,
            mediaUrl: asset.mediaUrls[0],
            mediaType: (asset.sourceType === 'video' ? 'video' : 'image') as 'image' | 'video',
          };
          targetScene.ragContext = [
            newEntry,
            ...(targetScene.ragContext || []).filter((r) => r.id !== asset.id),
          ];
          actionSummary = `Attached asset "${asset.name}" to "${targetScene.title}"`;
        }
      } else if (payload.kind === 'source' || payload.kind === 'source-slide') {
        const source = await sourceStore.getSource(payload.sourceId);
        if (!source) {
          res.status(404).json({ error: 'Source not found.' });
          return;
        }
        if (source.audioUrl && (track === 'voiceover' || track === 'music')) {
          if (track === 'music') {
            project.musicTracks.push({
              id: `music-${crypto.randomUUID().slice(0, 6)}`,
              title: source.name,
              mood: 'NotebookLM Audio Overview',
              bpm: 105,
              startTimeSec: Math.max(0, Math.round(dropSec)),
              durationSec: Math.max(15, Math.round(source.audioDurationSec || 45)),
              volumeDb: -12,
              duckUnderVoice: true,
              accentColor: '#06b6d4',
            });
            actionSummary = `Dropped audio overview "${source.name}" onto Music track`;
          } else {
            const targetScene = resolveSceneAtSec(dropSec);
            if (targetScene) {
              targetScene.voiceAudioUrl = source.audioUrl;
              targetScene.voicePlaybackMode = 'direct-sample';
              targetScene.voiceEnabled = true;
              targetScene.voiceStartSec = Math.max(0, Math.round(dropSec));
              actionSummary = `Attached NotebookLM audio "${source.name}" to "${targetScene.title}"`;
            }
          }
        } else {
          const slidesToInsert =
            payload.kind === 'source-slide'
              ? source.slides.filter((sl) => sl.index === payload.slideIndex)
              : source.slides.slice(0, 4);
          const effectiveSlides = slidesToInsert.length > 0 ? slidesToInsert : source.slides.slice(0, 1);
          const chapterId =
            project.chapters[project.chapters.length - 1]?.id ||
            `chap-${crypto.randomUUID().slice(0, 6)}`;

          // Insert after target scene or at end
          let insertIdx = project.scenes.length;
          if (targetSceneId) {
            const idx = project.scenes.findIndex((s) => s.id === targetSceneId);
            if (idx >= 0) insertIdx = idx + 1;
          } else if (dropSec < totalSec) {
            let cursor = 0;
            for (let i = 0; i < project.scenes.length; i++) {
              cursor += project.scenes[i].durationSec;
              if (dropSec <= cursor) {
                insertIdx = i + 1;
                break;
              }
            }
          }

          const createdScenes = effectiveSlides.map((sl, offset) => ({
            id: `scene-${project.scenes.length + offset + 1}-${crypto.randomUUID().slice(0, 6)}`,
            chapterId,
            order: insertIdx + offset,
            title: sl.title || `${source.name} (${sl.index})`,
            durationSec: 24,
            narration:
              sl.speakerNotes ||
              (sl.bullets.length > 0 ? `${sl.title}: ${sl.bullets.join('; ')}.` : sl.rawText.slice(0, 260)) ||
              `Covering ${sl.title} from ${source.name}.`,
            visualPrompt: `${sl.title} (${source.name}) — ${sl.bullets.join(', ')}`,
            visualOverlay: 'architecture-flow' as const,
            animationPreset:
              sl.imageUrls.length > 0 ? ('slide-deck-reveal' as const) : ('kinetic-cards' as const),
            generatedVisualUrl: sl.imageUrls[0],
            sourceId: source.id,
            sourceSlideIndex: sl.index,
            cameraMotion: 'Slow Dolly In' as const,
            cinematicStyle: project.scenes[0]?.cinematicStyle || ('Neon Lab' as const),
            transitionIn: 'Match Cut' as const,
            characterId: project.characters[0]?.id,
            characterPlacement: 'left' as const,
            voiceId: project.primaryVoiceId,
            voiceStatus: 'fallback' as const,
            voiceEnabled: true,
            higgsfield: {
              status: 'fallback' as const,
              provider: 'canvas-fallback' as const,
              renderNote: `Created from source "${source.name}" slide ${sl.index}.`,
              updatedAt: new Date().toISOString(),
            },
            assetIds: source.assetIds.slice(0, 2),
            keyPoints: sl.bullets.length > 0 ? sl.bullets.slice(0, 3) : [sl.title],
          }));

          project.scenes.splice(insertIdx, 0, ...createdScenes);
          project.scenes.forEach((sc, idx) => {
            sc.order = idx;
          });
          actionSummary = `Inserted ${createdScenes.length} scene(s) from "${source.name}" onto timeline`;
        }
      }

      const recomputedSec = project.scenes.reduce((acc, sc) => acc + sc.durationSec, 0);
      project.targetDurationMinutes = Math.max(1, Math.min(30, Math.round(recomputedSec / 60)));

      project.history.push({
        id: `hist-${crypto.randomUUID().slice(0, 6)}`,
        timestamp: new Date().toISOString(),
        prompt: `Timeline Drop: ${actionSummary}`,
        summary: actionSummary || 'Dropped item onto timeline',
        actions: [actionSummary || 'Timeline drop'],
        projectState: extractProjectSnapshot(project),
      });
      project.redoStack = [];

      const saved = await store.saveProject(project);
      res.json({ project: saved, summary: actionSummary });
    } catch (err) {
      next(err);
    }
  });

  // Director Prompt iterative editing + RAG retrieval + Provider push + Undo / Redo / Restore
  router.post('/projects/:id/director', async (req, res, next) => {
    try {
      const parsed = DirectorPromptSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Prompt must be between 2 and 1000 characters.' });
        return;
      }
      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }

      const [allAssets, voiceRes] = await Promise.all([
        assetLibrary.listAssets(),
        listElevenLabsVoices(getHeaderKey(req, 'x-elevenlabs-key'), vault, voiceStore),
      ]);
      const result = applyDirectorPrompt(project, parsed.data.prompt, allAssets, voiceRes.voices);

      if (result.higgsfieldTargetSceneIds && result.higgsfieldTargetSceneIds.length > 0) {
        for (const targetSceneId of result.higgsfieldTargetSceneIds) {
          const targetScene = result.project.scenes.find((s) => s.id === targetSceneId);
          if (!targetScene) continue;
          const char = result.project.characters.find((c) => c.id === targetScene.characterId);
          const attachedAssets = allAssets.filter((a) => targetScene.assetIds?.includes(a.id));
          const jobState = await generateHiggsfieldScene({
            scene: targetScene,
            character: char,
            assets: attachedAssets,
            sessionHeaderKey: getHeaderKey(req, 'x-higgsfield-key'),
            sessionSecret: getHeaderKey(req, 'x-higgsfield-secret'),
            sessionEndpoint: getHeaderKey(req, 'x-higgsfield-endpoint'),
            sessionModel: getHeaderKey(req, 'x-higgsfield-model'),
            vault,
          });
          targetScene.higgsfield = jobState;
          targetScene.activeVideoProvider = 'higgsfield';
          result.actions.push(
            `Submitted Higgsfield render (${jobState.status}) for "${targetScene.title}"`
          );
        }
        result.summary = result.actions.join('; ');
      }

      if (result.veoTargetSceneIds && result.veoTargetSceneIds.length > 0) {
        for (const targetSceneId of result.veoTargetSceneIds) {
          const targetScene = result.project.scenes.find((s) => s.id === targetSceneId);
          if (!targetScene) continue;
          const char = result.project.characters.find((c) => c.id === targetScene.characterId);
          const attachedAssets = allAssets.filter((a) => targetScene.assetIds?.includes(a.id));
          const jobState = await generateGeminiVeoScene({
            scene: targetScene,
            character: char,
            assets: attachedAssets,
            uploadsRootDir: store.getUploadsDir(),
            sessionHeaderKey: getHeaderKey(req, 'x-gemini-veo-key'),
            sessionEndpoint: getHeaderKey(req, 'x-gemini-veo-endpoint'),
            sessionModel: getHeaderKey(req, 'x-gemini-veo-model'),
            vault,
          });
          targetScene.veo = jobState;
          targetScene.activeVideoProvider = 'gemini_veo';
          result.actions.push(
            `Pushed to Gemini Veo (${jobState.status}) for "${targetScene.title}"`
          );
        }
        result.summary = result.actions.join('; ');
      }

      const saved = await store.saveProject(result.project);
      res.json({
        project: saved,
        summary: result.summary,
        actions: result.actions,
        ragContextUsed: result.ragContextUsed,
        higgsfieldTargetSceneIds: result.higgsfieldTargetSceneIds,
        veoTargetSceneIds: result.veoTargetSceneIds,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/projects/:id/undo', async (req, res, next) => {
    try {
      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const undone = undoProjectIteration(project);
      const saved = await store.saveProject(undone);
      res.json({ project: saved });
    } catch (err) {
      next(err);
    }
  });

  router.post('/projects/:id/redo', async (req, res, next) => {
    try {
      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const redone = redoProjectIteration(project);
      const saved = await store.saveProject(redone);
      res.json({ project: saved });
    } catch (err) {
      next(err);
    }
  });

  router.post('/projects/:id/restore/:snapshotId', async (req, res, next) => {
    try {
      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const restored = restoreProjectSnapshot(project, req.params.snapshotId);
      if (!restored) {
        res.status(404).json({ error: 'Snapshot not found.' });
        return;
      }
      const saved = await store.saveProject(restored);
      res.json({ project: saved });
    } catch (err) {
      next(err);
    }
  });

  // Character Cloning (list, upload up to 5 photos or 1 video, or clone preset)
  router.get('/characters', async (_req, res, next) => {
    try {
      const characters = await store.listCharacters();
      res.json({ characters, presets: PRESET_CHARACTERS });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/characters/clone',
    (req, res, next) => {
      upload.array('media', 6)(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err.message || 'Upload validation failed.' });
          return;
        }
        next();
      });
    },
    async (req, res, next) => {
      try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (name.length < 2) {
          res.status(400).json({ error: 'Character name must be at least 2 characters.' });
          return;
        }

        const role = typeof req.body?.role === 'string' ? req.body.role : undefined;
        const stylePreset = typeof req.body?.stylePreset === 'string' ? req.body.stylePreset : undefined;
        const voiceId = typeof req.body?.voiceId === 'string' ? req.body.voiceId : undefined;
        const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
        const requestedSource = req.body?.sourceType as CharacterSourceType | undefined;

        let parsedTraits: Record<string, string> | undefined;
        if (typeof req.body?.traits === 'string' && req.body.traits.trim()) {
          try {
            parsedTraits = JSON.parse(req.body.traits) as Record<string, string>;
          } catch {
            parsedTraits = undefined;
          }
        }

        const files = ((req.files as Express.Multer.File[]) || []).map((f) => ({
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
          url: `/uploads/${path.basename(f.path)}`,
        }));

        if (requestedSource === 'preset' && files.length === 0) {
          const character = buildClonedCharacter({
            name,
            role,
            sourceType: 'preset',
            mediaUrls: [],
            stylePreset,
            voiceId,
            traits: parsedTraits,
          });
          const saved = await store.saveCharacter(character, projectId);
          res.status(201).json({ character: saved });
          return;
        }

        const validation = validateCharacterUpload(files, requestedSource);
        if (!validation.valid) {
          res.status(400).json({ error: validation.error });
          return;
        }

        const character = buildClonedCharacter({
          name,
          role,
          sourceType: validation.sourceType,
          mediaUrls: files.map((f) => f.url),
          stylePreset,
          voiceId,
          traits: parsedTraits,
        });

        const saved = await store.saveCharacter(character, projectId);
        res.status(201).json({ character: saved });
      } catch (err) {
        next(err);
      }
    }
  );

  // Native Voice Cloning, Listing, TTS & Optional ElevenLabs Push
  const handleListVoices = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await listElevenLabsVoices(
        getHeaderKey(req, 'x-elevenlabs-key'),
        vault,
        voiceStore
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  router.get('/voices', handleListVoices);
  router.get('/v1/voices', handleListVoices);

  router.post(
    '/voices/clone',
    (req, res, next) => {
      voiceUpload.single('sample')(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err.message || 'Voice sample upload failed.' });
          return;
        }
        next();
      });
    },
    async (req, res, next) => {
      try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (name.length < 2) {
          res.status(400).json({ error: 'Voice name must be at least 2 characters.' });
          return;
        }

        let rawTraits: Partial<VoiceTraits> = {};
        if (typeof req.body?.traits === 'string' && req.body.traits.trim()) {
          try {
            rawTraits = JSON.parse(req.body.traits) as Partial<VoiceTraits>;
          } catch {
            rawTraits = {};
          }
        }

        const traits: VoiceTraits = {
          tone:
            (typeof req.body?.tone === 'string' && req.body.tone.trim()) ||
            rawTraits.tone ||
            'Warm & Articulate',
          pitch:
            req.body?.pitch === 'low' || req.body?.pitch === 'high' || req.body?.pitch === 'medium'
              ? req.body.pitch
              : rawTraits.pitch === 'low' || rawTraits.pitch === 'high'
                ? rawTraits.pitch
                : 'medium',
          warmth: Math.max(
            0,
            Math.min(100, Number(req.body?.warmth ?? rawTraits.warmth ?? 70) || 70)
          ),
          cadence:
            req.body?.cadence === 'measured' ||
            req.body?.cadence === 'brisk' ||
            req.body?.cadence === 'conversational'
              ? req.body.cadence
              : rawTraits.cadence === 'measured' || rawTraits.cadence === 'brisk'
                ? rawTraits.cadence
                : 'conversational',
        };

        const file = req.file as Express.Multer.File | undefined;
        const sampleUrl = file ? `/uploads/voices/${path.basename(file.path)}` : undefined;
        const sampleMimeType = file
          ? resolveVoiceSampleMimeType(file.mimetype, file.originalname) ||
            normalizeMimeType(file.mimetype)
          : undefined;
        const description =
          typeof req.body?.description === 'string' ? req.body.description : undefined;
        const playbackMode =
          req.body?.playbackMode === 'direct-sample' && sampleUrl
            ? 'direct-sample'
            : 'speak-script';

        const acousticSignature = file
          ? await analyzeVoiceSampleFile({
              filePath: file.path,
              fallbackTraits: traits,
            })
          : deriveFallbackAcousticSignature(traits);

        const voice = await voiceStore.createClonedVoice({
          name,
          description,
          sampleUrl,
          sampleMimeType,
          playbackMode,
          traits,
          acousticSignature,
        });

        let updatedProject = null;
        const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId.trim() : '';
        const shouldActivate =
          req.body?.setAsActive === 'true' ||
          req.body?.setAsActiveExplainerVoice === 'true';
        if (projectId && shouldActivate) {
          const proj = await store.getProject(projectId);
          if (proj) {
            proj.primaryVoiceId = voice.voice_id;
            for (const sc of proj.scenes) {
              sc.voiceId = voice.voice_id;
            }
            proj.history.push({
              id: `hist-${crypto.randomUUID().slice(0, 6)}`,
              timestamp: new Date().toISOString(),
              prompt: `Activate cloned voice "${voice.name}"`,
              summary: `Bound "${voice.name}" as active explainer voice across all scenes`,
              actions: [`Activated cloned voice "${voice.name}"`],
              projectState: extractProjectSnapshot(proj),
            });
            proj.redoStack = [];
            updatedProject = await store.saveProject(proj);
          }
        }

        res.status(201).json({ voice, ...(updatedProject ? { project: updatedProject } : {}) });
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch('/voices/:id', async (req, res, next) => {
    try {
      const existing = await voiceStore.getVoice(req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Custom voice not found.' });
        return;
      }
      const patch: Partial<typeof existing> = {};
      if (req.body?.playbackMode === 'direct-sample' || req.body?.playbackMode === 'speak-script') {
        if (req.body.playbackMode === 'direct-sample' && !existing.sampleUrl) {
          res.status(400).json({ error: 'Cannot enable direct sample mode without an uploaded or recorded audio sample.' });
          return;
        }
        patch.playbackMode = req.body.playbackMode;
      }
      if (typeof req.body?.name === 'string' && req.body.name.trim().length >= 2) {
        patch.name = req.body.name.trim();
      }
      if (typeof req.body?.description === 'string') {
        patch.description = req.body.description.trim();
      }
      const updated = await voiceStore.updateVoice(req.params.id, patch);
      res.json({ voice: updated });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/voices/:id', async (req, res, next) => {
    try {
      const deleted = await voiceStore.deleteVoice(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Custom voice not found.' });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/voices/:id/push-elevenlabs', async (req, res, next) => {
    try {
      const voice = await voiceStore.getVoice(req.params.id);
      if (!voice) {
        res.status(404).json({ error: 'Custom voice not found.' });
        return;
      }

      const result = await pushVoiceToElevenLabs({
        voice,
        uploadsRootDir: store.getUploadsDir(),
        sessionHeaderKey: getHeaderKey(req, 'x-elevenlabs-key'),
        vault,
        voiceStore,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  const handleTts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const voiceIdParam = req.params.voiceId;
      const bodyPayload = {
        ...req.body,
        voiceId: voiceIdParam || req.body?.voiceId,
      };
      const parsed = TtsSchema.safeParse(bodyPayload);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid TTS request.', details: parsed.error.flatten() });
        return;
      }

      const project =
        parsed.data.projectId ? await store.getProject(parsed.data.projectId) : null;
      const targetScene =
        project && parsed.data.sceneId
          ? project.scenes.find((s) => s.id === parsed.data.sceneId)
          : undefined;

      const result = await synthesizeElevenLabsSpeech({
        voiceId: parsed.data.voiceId,
        text: parsed.data.text,
        playbackMode: parsed.data.playbackMode || targetScene?.voicePlaybackMode,
        sceneAudioUrl: targetScene?.voiceAudioUrl,
        uploadsRootDir: store.getUploadsDir(),
        sessionHeaderKey: getHeaderKey(req, 'x-elevenlabs-key'),
        vault,
        voiceStore,
      });

      if (project && targetScene) {
        targetScene.voiceId = parsed.data.voiceId;
        targetScene.voiceStatus =
          result.kind === 'audio' &&
          (result.source === 'elevenlabs' || result.source === 'native')
            ? 'synthesized'
            : 'fallback';
        await store.saveProject(project);
      }

      res.setHeader('X-Voice-Source', result.source);
      if (result.fallbackReason) {
        res.setHeader('X-Voice-Fallback-Reason', result.fallbackReason);
      }

      if (result.kind === 'audio') {
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('X-Voice-Synthesis-Mode', result.synthesisMode);
        if (result.dspShaped) {
          res.setHeader('X-Voice-Dsp-Shaped', 'true');
        }
        res.send(result.audioBuffer);
        return;
      }

      res.setHeader('X-Voice-Synthesis-Mode', result.fallback.mode);
      res.json(result.fallback);
    } catch (err) {
      next(err);
    }
  };

  router.post('/tts', handleTts);
  router.post('/v1/text-to-speech/:voiceId', handleTts);

  // Tech Asset Library & RAG Context Engine
  router.get('/assets', async (_req, res, next) => {
    try {
      const assets = await assetLibrary.listAssets();
      res.json({ assets });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/assets',
    (req, res, next) => {
      assetUpload.array('media', 6)(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err.message || 'Asset upload failed.' });
          return;
        }
        next();
      });
    },
    async (req, res, next) => {
      try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (name.length < 2) {
          res.status(400).json({ error: 'Asset name must be at least 2 characters.' });
          return;
        }

        const categoryRaw = typeof req.body?.category === 'string' ? req.body.category : 'hardware';
        const validCategories = new Set<TechAssetCategory>([
          'hardware',
          'server-rack',
          'architecture-diagram',
          'lab-environment',
          'product-demo',
          'reference-clip',
        ]);
        const category: TechAssetCategory = validCategories.has(categoryRaw as TechAssetCategory)
          ? (categoryRaw as TechAssetCategory)
          : 'hardware';

        const files = ((req.files as Express.Multer.File[]) || []).map((f) => ({
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
          url: `/uploads/assets/${path.basename(f.path)}`,
        }));

        const requestedSource =
          req.body?.sourceType === 'video'
            ? 'video'
            : req.body?.sourceType === 'photos'
              ? 'photos'
              : undefined;
        const validation = validateAssetUpload(files, requestedSource);
        if (!validation.valid) {
          res.status(400).json({ error: validation.error });
          return;
        }

        const description =
          typeof req.body?.description === 'string' && req.body.description.trim()
            ? req.body.description
            : `${name} reference media for technical explainer scenes.`;
        const technicalSpecs =
          typeof req.body?.technicalSpecs === 'string' ? req.body.technicalSpecs : '';
        const tagsRaw: string = typeof req.body?.tags === 'string' ? req.body.tags : '';
        const tags = tagsRaw
          .split(',')
          .map((t: string) => t.trim())
          .filter(Boolean);

        const asset = await assetLibrary.addAsset({
          name,
          category,
          sourceType: validation.sourceType,
          mediaUrls: files.map((f) => f.url),
          description,
          technicalSpecs,
          tags: tags.length > 0 ? tags : name.toLowerCase().split(/\s+/).slice(0, 5),
        });

        res.status(201).json({ asset });
      } catch (err) {
        next(err);
      }
    }
  );

  router.delete('/assets/:id', async (req, res, next) => {
    try {
      const deleted = await assetLibrary.deleteAsset(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Tech asset not found.' });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/assets/retrieve', async (req, res, next) => {
    try {
      const parsed = RagRetrieveSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid RAG query.' });
        return;
      }
      const [assets, characters, project] = await Promise.all([
        assetLibrary.listAssets(),
        store.listCharacters(),
        parsed.data.projectId ? store.getProject(parsed.data.projectId) : Promise.resolve(null),
      ]);
      const matches = retrieveRagContext({
        query: parsed.data.query,
        assets,
        characters: project ? project.characters : characters,
        scenes: project?.scenes,
        limit: parsed.data.limit ?? 5,
      });
      res.json({ matches });
    } catch (err) {
      next(err);
    }
  });

  // Native SVG Diagram & Technical Illustration Generator
  router.post('/assets/generate-visual', async (req, res, next) => {
    try {
      const parsed = GenerateVisualSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid visual generation request.', details: parsed.error.flatten() });
        return;
      }

      let targetProject = parsed.data.projectId
        ? await store.getProject(parsed.data.projectId)
        : null;
      const targetScene =
        targetProject && parsed.data.sceneId
          ? targetProject.scenes.find((s) => s.id === parsed.data.sceneId)
          : undefined;

      const generated = await generateNativeVisualAsset({
        prompt: parsed.data.prompt,
        title: parsed.data.title || targetScene?.title,
        keyPoints: parsed.data.keyPoints || targetScene?.keyPoints,
        style: parsed.data.style || targetScene?.cinematicStyle || 'Neon Lab',
        diagramType: parsed.data.diagramType || 'auto',
        uploadsRootDir: store.getUploadsDir(),
        assetLibrary,
      });

      if (targetProject && targetScene) {
        targetScene.generatedVisualUrl = generated.visualUrl;
        targetScene.assetIds = Array.from(
          new Set([generated.asset.id, ...(targetScene.assetIds || [])])
        );
        targetScene.ragContext = [
          {
            sourceType: 'asset',
            id: generated.asset.id,
            name: generated.asset.name,
            category: generated.asset.category,
            score: 10,
            matchedTerms: ['generated-visual'],
            snippet: generated.asset.technicalSpecs,
            mediaUrl: generated.visualUrl,
            mediaType: 'image',
          },
          ...(targetScene.ragContext || []).filter((r) => r.id !== generated.asset.id),
        ];
        targetProject = await store.saveProject(targetProject);
      }

      res.status(201).json({
        asset: generated.asset,
        visualUrl: generated.visualUrl,
        diagramType: generated.diagramType,
        ...(targetProject ? { project: targetProject } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  // Sources: PPTX Presentations & NotebookLM Docs / Audio Overviews
  router.get('/sources', async (_req, res, next) => {
    try {
      const sources = await sourceStore.listSources();
      res.json({ sources });
    } catch (err) {
      next(err);
    }
  });

  router.get('/sources/:id', async (req, res, next) => {
    try {
      const source = await sourceStore.getSource(req.params.id);
      if (!source) {
        res.status(404).json({ error: 'Source not found.' });
        return;
      }
      res.json({ source });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/sources/:id', async (req, res, next) => {
    try {
      const deleted = await sourceStore.deleteSource(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Source not found.' });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/sources/import-pptx',
    (req, res, next) => {
      sourceMemoryUpload.fields([
        { name: 'file', maxCount: 1 },
        { name: 'pptx', maxCount: 1 },
        { name: 'media', maxCount: 1 },
      ])(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err.message || 'PPTX upload failed.' });
          return;
        }
        next();
      });
    },
    async (req, res, next) => {
      try {
        const filesMap = req.files as Record<string, Express.Multer.File[]> | undefined;
        const file = filesMap?.file?.[0] || filesMap?.pptx?.[0] || filesMap?.media?.[0];
        if (!file) {
          res.status(400).json({ error: 'Upload a .pptx presentation file.' });
          return;
        }
        await sourceStore.ensureInitialized();
        await assetLibrary.ensureInitialized();
        const parsedSource = await parseAndImportPptx({
          buffer: file.buffer,
          filename: file.originalname,
          name: typeof req.body?.name === 'string' ? req.body.name : undefined,
          uploadsSourcesDir: sourceStore.getSourcesUploadDir(),
          assetLibrary,
        });
        const saved = await sourceStore.addSource(parsedSource);
        res.status(201).json({ source: saved });
      } catch (err) {
        if (err instanceof Error && err.message.includes('PPTX')) {
          res.status(400).json({ error: err.message });
          return;
        }
        next(err);
      }
    }
  );

  router.post(
    '/sources/import-notebooklm',
    (req, res, next) => {
      if (req.is('multipart/form-data')) {
        sourceMemoryUpload.fields([
          { name: 'file', maxCount: 1 },
          { name: 'media', maxCount: 1 },
        ])(req, res, (err) => {
          if (err) {
            res.status(400).json({ error: err.message || 'NotebookLM upload failed.' });
            return;
          }
          next();
        });
      } else {
        next();
      }
    },
    async (req, res, next) => {
      try {
        const filesMap = req.files as Record<string, Express.Multer.File[]> | undefined;
        const file = filesMap?.file?.[0] || filesMap?.media?.[0];
        const rawText =
          typeof req.body?.rawText === 'string'
            ? req.body.rawText
            : typeof req.body?.content === 'string'
              ? req.body.content
              : undefined;
        const name = typeof req.body?.name === 'string' ? req.body.name : undefined;

        await sourceStore.ensureInitialized();
        const parsedSource = await parseAndImportNotebookLm({
          file: file
            ? {
                buffer: file.buffer,
                originalname: file.originalname,
                mimetype: file.mimetype,
              }
            : undefined,
          rawText,
          name,
          uploadsSourcesDir: sourceStore.getSourcesUploadDir(),
        });
        const saved = await sourceStore.addSource(parsedSource);
        res.status(201).json({ source: saved });
      } catch (err) {
        if (err instanceof Error && err.message.includes('Provide NotebookLM')) {
          res.status(400).json({ error: err.message });
          return;
        }
        next(err);
      }
    }
  );

  router.post(
    '/sources/import',
    (req, res, next) => {
      if (req.is('multipart/form-data')) {
        sourceMemoryUpload.fields([
          { name: 'file', maxCount: 1 },
          { name: 'media', maxCount: 1 },
        ])(req, res, (err) => {
          if (err) {
            res.status(400).json({ error: err.message || 'Source upload failed.' });
            return;
          }
          next();
        });
      } else {
        next();
      }
    },
    async (req, res, next) => {
      try {
        const filesMap = req.files as Record<string, Express.Multer.File[]> | undefined;
        const file = filesMap?.file?.[0] || filesMap?.media?.[0];
        const rawText =
          typeof req.body?.rawText === 'string'
            ? req.body.rawText
            : typeof req.body?.content === 'string'
              ? req.body.content
              : undefined;
        const name = typeof req.body?.name === 'string' ? req.body.name : undefined;

        await sourceStore.ensureInitialized();
        await assetLibrary.ensureInitialized();

        const isPptx =
          Boolean(file) &&
          (file!.originalname.toLowerCase().endsWith('.pptx') ||
            file!.mimetype.includes('presentationml'));

        const parsedSource = isPptx && file
          ? await parseAndImportPptx({
              buffer: file.buffer,
              filename: file.originalname,
              name,
              uploadsSourcesDir: sourceStore.getSourcesUploadDir(),
              assetLibrary,
            })
          : await parseAndImportNotebookLm({
              file: file
                ? {
                    buffer: file.buffer,
                    originalname: file.originalname,
                    mimetype: file.mimetype,
                  }
                : undefined,
              rawText,
              name,
              uploadsSourcesDir: sourceStore.getSourcesUploadDir(),
            });

        const saved = await sourceStore.addSource(parsedSource);
        res.status(201).json({ source: saved });
      } catch (err) {
        if (err instanceof Error && (err.message.includes('PPTX') || err.message.includes('Provide NotebookLM'))) {
          res.status(400).json({ error: err.message });
          return;
        }
        next(err);
      }
    }
  );

  // Higgsfield Cinematic Scene generation & job status polling
  router.post('/higgsfield/generate', async (req, res, next) => {
    try {
      const parsed = HiggsfieldSceneSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid Higgsfield generate request.' });
        return;
      }
      const project = await store.getProject(parsed.data.projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const scene = project.scenes.find((s) => s.id === parsed.data.sceneId);
      if (!scene) {
        res.status(404).json({ error: 'Scene not found.' });
        return;
      }
      const character = project.characters.find((c) => c.id === scene.characterId);
      const allAssets = await assetLibrary.listAssets();
      const attachedAssets = allAssets.filter((a) => scene.assetIds?.includes(a.id));

      const jobState = await generateHiggsfieldScene({
        scene,
        character,
        assets: attachedAssets,
        sessionHeaderKey: getHeaderKey(req, 'x-higgsfield-key'),
        sessionSecret: getHeaderKey(req, 'x-higgsfield-secret'),
        sessionEndpoint: getHeaderKey(req, 'x-higgsfield-endpoint'),
        sessionModel: getHeaderKey(req, 'x-higgsfield-model'),
        vault,
      });

      scene.higgsfield = jobState;
      scene.activeVideoProvider = 'higgsfield';
      const saved = await store.saveProject(project);
      res.json({ project: saved, higgsfield: jobState });
    } catch (err) {
      next(err);
    }
  });

  router.get('/higgsfield/jobs/:projectId/:sceneId', async (req, res, next) => {
    try {
      const project = await store.getProject(req.params.projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const scene = project.scenes.find((s) => s.id === req.params.sceneId);
      if (!scene) {
        res.status(404).json({ error: 'Scene not found.' });
        return;
      }

      const jobState = await pollHiggsfieldJobStatus({
        scene,
        sessionHeaderKey: getHeaderKey(req, 'x-higgsfield-key'),
        sessionSecret: getHeaderKey(req, 'x-higgsfield-secret'),
        sessionEndpoint: getHeaderKey(req, 'x-higgsfield-endpoint'),
        sessionModel: getHeaderKey(req, 'x-higgsfield-model'),
        vault,
      });

      scene.higgsfield = jobState;
      const saved = await store.saveProject(project);
      res.json({ project: saved, higgsfield: jobState });
    } catch (err) {
      next(err);
    }
  });

  // Unified Advanced Push-Out (Higgsfield & Gemini Veo) with Reference Photos/Videos & RAG Assets
  router.post('/providers/push', async (req, res, next) => {
    try {
      const parsed = PushProviderSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid provider push request.', details: parsed.error.flatten() });
        return;
      }
      const project = await store.getProject(parsed.data.projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const scene = project.scenes.find((s) => s.id === parsed.data.sceneId);
      if (!scene) {
        res.status(404).json({ error: 'Scene not found.' });
        return;
      }

      const targetCharId = parsed.data.characterId || scene.characterId;
      const character = project.characters.find((c) => c.id === targetCharId);
      const allAssets = await assetLibrary.listAssets();
      const attachedAssets = allAssets.filter((a) => scene.assetIds?.includes(a.id));

      if (parsed.data.provider === 'gemini_veo') {
        const job = await generateGeminiVeoScene({
          scene,
          character,
          assets: attachedAssets,
          uploadsRootDir: store.getUploadsDir(),
          sessionHeaderKey: getHeaderKey(req, 'x-gemini-veo-key'),
          sessionEndpoint: getHeaderKey(req, 'x-gemini-veo-endpoint'),
          sessionModel: getHeaderKey(req, 'x-gemini-veo-model'),
          vault,
        });
        scene.veo = job;
        scene.activeVideoProvider = 'gemini_veo';
        const saved = await store.saveProject(project);
        res.json({ project: saved, job, provider: 'gemini_veo' });
        return;
      }

      const job = await generateHiggsfieldScene({
        scene,
        character,
        assets: attachedAssets,
        sessionHeaderKey: getHeaderKey(req, 'x-higgsfield-key'),
        sessionSecret: getHeaderKey(req, 'x-higgsfield-secret'),
        sessionEndpoint: getHeaderKey(req, 'x-higgsfield-endpoint'),
        sessionModel: getHeaderKey(req, 'x-higgsfield-model'),
        vault,
      });
      scene.higgsfield = job;
      scene.activeVideoProvider = 'higgsfield';
      const saved = await store.saveProject(project);
      res.json({ project: saved, job, provider: 'higgsfield' });
    } catch (err) {
      next(err);
    }
  });

  router.get('/providers/jobs/:projectId/:sceneId/:provider', async (req, res, next) => {
    try {
      const provider = req.params.provider;
      if (provider !== 'higgsfield' && provider !== 'gemini_veo') {
        res.status(400).json({ error: `Unsupported video provider "${provider}".` });
        return;
      }
      const project = await store.getProject(req.params.projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const scene = project.scenes.find((s) => s.id === req.params.sceneId);
      if (!scene) {
        res.status(404).json({ error: 'Scene not found.' });
        return;
      }

      if (provider === 'gemini_veo') {
        if (!scene.veo) {
          res.status(404).json({ error: 'No Gemini Veo job found for scene.' });
          return;
        }
        const job = await pollGeminiVeoJobStatus({
          job: scene.veo,
          sessionHeaderKey: getHeaderKey(req, 'x-gemini-veo-key'),
          sessionEndpoint: getHeaderKey(req, 'x-gemini-veo-endpoint'),
          sessionModel: getHeaderKey(req, 'x-gemini-veo-model'),
          vault,
        });
        scene.veo = job;
        const saved = await store.saveProject(project);
        res.json({ project: saved, job, provider: 'gemini_veo' });
        return;
      }

      const job = await pollHiggsfieldJobStatus({
        scene,
        sessionHeaderKey: getHeaderKey(req, 'x-higgsfield-key'),
        sessionSecret: getHeaderKey(req, 'x-higgsfield-secret'),
        sessionEndpoint: getHeaderKey(req, 'x-higgsfield-endpoint'),
        sessionModel: getHeaderKey(req, 'x-higgsfield-model'),
        vault,
      });
      scene.higgsfield = job;
      const saved = await store.saveProject(project);
      res.json({ project: saved, job, provider: 'higgsfield' });
    } catch (err) {
      next(err);
    }
  });

  // Authenticated Video Proxy for provider-generated videos (e.g. Gemini Veo download URIs requiring x-goog-api-key)
  router.get('/providers/video-proxy/:projectId/:sceneId/:provider', async (req, res, next) => {
    try {
      const provider = req.params.provider;
      if (provider !== 'higgsfield' && provider !== 'gemini_veo') {
        res.status(400).json({ error: `Unsupported video provider "${provider}".` });
        return;
      }
      const project = await store.getProject(req.params.projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const scene = project.scenes.find((s) => s.id === req.params.sceneId);
      if (!scene) {
        res.status(404).json({ error: 'Scene not found.' });
        return;
      }
      const job = provider === 'gemini_veo' ? scene.veo : scene.higgsfield;
      const videoUrl = job?.videoUrl;
      if (!videoUrl) {
        res.status(404).json({ error: 'No generated video URL for this scene.' });
        return;
      }

      const headers: Record<string, string> = {};
      if (req.headers.range) {
        headers.Range = req.headers.range;
      }
      if (provider === 'gemini_veo') {
        const veo = resolveGeminiVeoKey(getHeaderKey(req, 'x-gemini-veo-key'), vault, {
          sessionEndpoint: getHeaderKey(req, 'x-gemini-veo-endpoint'),
          sessionModel: getHeaderKey(req, 'x-gemini-veo-model'),
        });
        const endpointOrigin = (() => {
          try {
            return new URL(job.endpoint || veo.endpoint).origin;
          } catch {
            return '';
          }
        })();
        if (
          veo.key &&
          (videoUrl.includes('googleapis.com') ||
            (endpointOrigin && videoUrl.startsWith(endpointOrigin)))
        ) {
          headers['x-goog-api-key'] = veo.key;
        }
      }

      const upstream = await fetch(videoUrl, {
        headers,
        signal: AbortSignal.timeout(30000),
      });
      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).json({ error: `Upstream video fetch failed (HTTP ${upstream.status}).` });
        return;
      }

      res.status(upstream.status);
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);
      const acceptRanges = upstream.headers.get('accept-ranges');
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } catch (err) {
      next(err);
    }
  });

  // Error handler
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return router;
}
