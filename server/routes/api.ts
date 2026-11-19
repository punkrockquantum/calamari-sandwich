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
import { generateExplainerProject } from '../services/scriptGenerator.js';
import { AssetLibrary, validateAssetUpload } from '../store/assetLibrary.js';
import type { CredentialVault } from '../store/credentialVault.js';
import type { ProjectStore } from '../store/projectStore.js';
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
  narration: z.string().min(1).max(5000).optional(),
  visualPrompt: z.string().min(1).max(2000).optional(),
  visualOverlay: z
    .enum(['neural-graph', 'architecture-flow', 'code-terminal', 'packet-stream', 'wave-spectrum'])
    .optional(),
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
  voiceId: z.string().min(1).max(120).optional(),
  voicePlaybackMode: z.enum(['auto', 'speak-script', 'direct-sample']).optional(),
  assetIds: z.array(z.string()).optional(),
  activeVideoProvider: z.enum(['higgsfield', 'gemini_veo']).optional().nullable(),
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
  assetLibraryArg?: AssetLibrary
): express.Router {
  const router = express.Router();
  const baseDataDir = path.dirname(store.getUploadsDir());
  const voiceStore = voiceStoreArg || new VoiceStore(baseDataDir);
  const assetLibrary = assetLibraryArg || new AssetLibrary(baseDataDir);

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

      const [allChars, allAssets] = await Promise.all([
        store.listCharacters(),
        assetLibrary.listAssets(),
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
      });

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
      if (updates.narration !== undefined) scene.narration = updates.narration;
      if (updates.visualPrompt !== undefined) scene.visualPrompt = updates.visualPrompt;
      if (updates.visualOverlay !== undefined) scene.visualOverlay = updates.visualOverlay;
      if (updates.cameraMotion !== undefined) scene.cameraMotion = updates.cameraMotion;
      if (updates.cinematicStyle !== undefined) scene.cinematicStyle = updates.cinematicStyle;
      if (updates.transitionIn !== undefined) scene.transitionIn = updates.transitionIn;
      if (updates.characterId !== undefined) scene.characterId = updates.characterId || undefined;
      if (updates.characterPlacement !== undefined) scene.characterPlacement = updates.characterPlacement;
      if (updates.voiceId !== undefined) scene.voiceId = updates.voiceId;
      if (updates.voicePlaybackMode !== undefined) {
        scene.voicePlaybackMode = updates.voicePlaybackMode;
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

  router.delete('/projects/:id/music/:trackId', async (req, res, next) => {
    try {
      const project = await store.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      project.musicTracks = project.musicTracks.filter((m) => m.id !== req.params.trackId);
      const saved = await store.saveProject(project);
      res.json({ project: saved });
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

        const voice = await voiceStore.createClonedVoice({
          name,
          description,
          sampleUrl,
          sampleMimeType,
          playbackMode,
          traits,
        });

        res.status(201).json({ voice });
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
