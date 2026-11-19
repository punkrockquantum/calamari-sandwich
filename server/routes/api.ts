import crypto from 'node:crypto';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type {
  CharacterSourceType,
  ProviderStatus,
} from '../../shared/types.js';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  MAX_FILE_BYTES,
  PRESET_CHARACTERS,
  buildClonedCharacter,
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
  resolveElevenLabsKey,
  synthesizeElevenLabsSpeech,
} from '../services/elevenlabs.js';
import {
  generateHiggsfieldScene,
  pollHiggsfieldJobStatus,
  resolveHiggsfieldKey,
} from '../services/higgsfield.js';
import {
  connectConnector,
  disconnectConnector,
  getConnectorDefinition,
  listConnectors,
  testConnectorConnection,
} from '../connectors/registry.js';
import { generateExplainerProject } from '../services/scriptGenerator.js';
import type { CredentialVault } from '../store/credentialVault.js';
import type { ProjectStore } from '../store/projectStore.js';

const GenerateProjectSchema = z.object({
  topic: z.string().min(2).max(300),
  durationMinutes: z.number().min(2).max(30),
  audience: z.enum(['beginner', 'engineering', 'executive']).default('engineering'),
  title: z.string().max(160).optional(),
  primaryVoiceId: z.string().max(120).optional(),
  characterIds: z.array(z.string()).optional(),
});

const DirectorPromptSchema = z.object({
  prompt: z.string().min(2).max(1000),
});

const TtsSchema = z.object({
  voiceId: z.string().min(1).max(120),
  text: z.string().min(1).max(5000),
  projectId: z.string().optional(),
  sceneId: z.string().optional(),
});

const HiggsfieldSceneSchema = z.object({
  projectId: z.string().min(1),
  sceneId: z.string().min(1),
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

const ConnectConnectorSchema = z.object({
  apiKey: z.string().trim().min(1, 'API key or Key ID is required').max(512),
  apiSecret: z.string().trim().max(512).optional(),
  endpoint: z.string().trim().max(512).optional(),
  model: z.string().trim().max(160).optional(),
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

export function createApiRouter(store: ProjectStore, vault?: CredentialVault): express.Router {
  const router = express.Router();

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
        const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.bin';
        cb(null, `char-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
      },
    }),
    limits: {
      fileSize: MAX_FILE_BYTES,
      files: 6,
    },
    fileFilter: (_req, file, cb) => {
      if (
        ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype) ||
        ALLOWED_VIDEO_MIME_TYPES.has(file.mimetype)
      ) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type "${file.mimetype}".`));
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
    const status: ProviderStatus = {
      elevenlabs: {
        configured: Boolean(el.key),
        source: el.source,
      },
      higgsfield: {
        configured: Boolean(hf.key),
        source: hf.source,
      },
    };
    res.json(status);
  });

  // Dedicated 5-slot API Connectors Registry
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

  // Projects CRUD & Generation
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

      const allChars = await store.listCharacters();
      const selectedChars =
        parsed.data.characterIds && parsed.data.characterIds.length > 0
          ? allChars.filter((c) => parsed.data.characterIds!.includes(c.id))
          : allChars.slice(0, 3);

      const project = generateExplainerProject({
        topic: parsed.data.topic,
        durationMinutes: parsed.data.durationMinutes,
        audience: parsed.data.audience,
        title: parsed.data.title,
        primaryVoiceId: parsed.data.primaryVoiceId,
        characters: selectedChars.length > 0 ? selectedChars : PRESET_CHARACTERS,
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

      const totalSec = project.scenes.reduce((acc, sc) => acc + sc.durationSec, 0);
      project.targetDurationMinutes = Math.max(2, Math.min(30, Math.round(totalSec / 60)));

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

  // Director Prompt iterative editing + Undo / Redo / Restore
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

      const result = applyDirectorPrompt(project, parsed.data.prompt);

      if (result.higgsfieldTargetSceneIds && result.higgsfieldTargetSceneIds.length > 0) {
        const hfKey = resolveHiggsfieldKey(getHeaderKey(req, 'x-higgsfield-key'), vault, {
          sessionSecret: getHeaderKey(req, 'x-higgsfield-secret'),
          sessionEndpoint: getHeaderKey(req, 'x-higgsfield-endpoint'),
          sessionModel: getHeaderKey(req, 'x-higgsfield-model'),
        });
        if (hfKey.key) {
          for (const targetSceneId of result.higgsfieldTargetSceneIds) {
            const targetScene = result.project.scenes.find((s) => s.id === targetSceneId);
            if (!targetScene) continue;
            const char = result.project.characters.find((c) => c.id === targetScene.characterId);
            const jobState = await generateHiggsfieldScene({
              scene: targetScene,
              character: char,
              sessionHeaderKey: getHeaderKey(req, 'x-higgsfield-key'),
              sessionSecret: getHeaderKey(req, 'x-higgsfield-secret'),
              sessionEndpoint: getHeaderKey(req, 'x-higgsfield-endpoint'),
              sessionModel: getHeaderKey(req, 'x-higgsfield-model'),
              vault,
            });
            targetScene.higgsfield = jobState;
            result.actions.push(
              `Submitted Higgsfield render (${jobState.status}) for "${targetScene.title}"`
            );
          }
          result.summary = result.actions.join('; ');
        }
      }

      const saved = await store.saveProject(result.project);
      res.json({
        project: saved,
        summary: result.summary,
        actions: result.actions,
        higgsfieldTargetSceneIds: result.higgsfieldTargetSceneIds,
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

  // ElevenLabs Voice Import & TTS (/api/voices, /api/tts, plus /v1 mirror endpoints)
  const handleListVoices = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await listElevenLabsVoices(getHeaderKey(req, 'x-elevenlabs-key'), vault);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  router.get('/voices', handleListVoices);
  router.get('/v1/voices', handleListVoices);

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

      const result = await synthesizeElevenLabsSpeech({
        voiceId: parsed.data.voiceId,
        text: parsed.data.text,
        sessionHeaderKey: getHeaderKey(req, 'x-elevenlabs-key'),
        vault,
      });

      if (parsed.data.projectId && parsed.data.sceneId) {
        const project = await store.getProject(parsed.data.projectId);
        if (project) {
          const sc = project.scenes.find((s) => s.id === parsed.data.sceneId);
          if (sc) {
            sc.voiceId = parsed.data.voiceId;
            sc.voiceStatus = result.source === 'elevenlabs' ? 'synthesized' : 'fallback';
            await store.saveProject(project);
          }
        }
      }

      res.setHeader('Content-Type', result.contentType);
      res.setHeader('X-Voice-Source', result.source);
      if (result.fallbackReason) {
        res.setHeader('X-Voice-Fallback-Reason', result.fallbackReason);
      }
      res.send(result.audioBuffer);
    } catch (err) {
      next(err);
    }
  };

  router.post('/tts', handleTts);
  router.post('/v1/text-to-speech/:voiceId', handleTts);

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
      const jobState = await generateHiggsfieldScene({
        scene,
        character,
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

  // Error handler
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return router;
}
