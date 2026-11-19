import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/index.js';
import { retrieveRagContext } from '../server/services/ragContext.js';
import { generateExplainerProject } from '../server/services/scriptGenerator.js';

interface MockServerHandle {
  url: string;
  close: () => Promise<void>;
}

async function startMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void
): Promise<MockServerHandle> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      handler(req, res, Buffer.concat(chunks).toString('utf-8'));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe('1–30m Builder, Native Voice Cloning, Gemini Veo Push & RAG Context Engine', () => {
  let tmpDir: string;
  let veoServer: MockServerHandle;
  let elevenServer: MockServerHandle;
  let lastVeoBody = '';

  const VALID_GEMINI_KEY = 'AIza-test-gemini-veo-4321';
  const VALID_EL_KEY = 'xi-test-eleven-push-5678';

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'calamari-m2-test-'));

    veoServer = await startMockServer((req, res, body) => {
      const apiKey = req.headers['x-goog-api-key'];
      if (apiKey !== VALID_GEMINI_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid Gemini API key' } }));
        return;
      }

      if (req.url === '/v1beta/models' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            models: [{ name: 'models/veo-2.0-generate-001' }],
          })
        );
        return;
      }

      if (req.url?.includes(':predictLongRunning') && req.method === 'POST') {
        lastVeoBody = body;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            name: 'operations/veo-op-101',
            done: false,
          })
        );
        return;
      }

      if (req.url === '/v1beta/operations/veo-op-101' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            name: 'operations/veo-op-101',
            done: true,
            response: {
              generateVideoResponse: {
                generatedSamples: [
                  { video: { uri: 'https://cdn.example.com/veo-scene-101.mp4' } },
                ],
              },
            },
          })
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    elevenServer = await startMockServer((req, res) => {
      if (req.headers['xi-api-key'] !== VALID_EL_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Unauthorized' }));
        return;
      }
      if (req.url === '/v1/voices') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ voices: [] }));
        return;
      }
      if (req.url === '/v1/user') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ first_name: 'Studio User' }));
        return;
      }
      if (req.url === '/v1/user/subscription') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tier: 'creator', character_count: 1000, character_limit: 100000 }));
        return;
      }
      if (req.url === '/v1/voices/add' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ voice_id: 'el-pushed-voice-99' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  afterAll(async () => {
    await veoServer.close();
    await elevenServer.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('supports 1-minute pacing (60s across 2 chapters / 4 scenes) up to 30 minutes', async () => {
    const oneMin = generateExplainerProject({
      topic: 'RDMA RoCEv2 Zero-Copy Networking',
      durationMinutes: 1,
      audience: 'engineering',
    });
    const totalSec = oneMin.scenes.reduce((s, sc) => s + sc.durationSec, 0);
    expect(totalSec).toBe(60);
    expect(oneMin.targetDurationMinutes).toBe(1);
    expect(oneMin.chapters).toHaveLength(2);
    expect(oneMin.scenes).toHaveLength(4);

    const appDir = path.join(tmpDir, 'one-min-app');
    const created = createApp({ dataDir: appDir });
    const genRes = await request(created.app)
      .post('/api/projects/generate')
      .send({
        topic: 'WebGPU Pipelines',
        durationMinutes: 1,
        audience: 'beginner',
      })
      .expect(201);

    expect(genRes.body.project.targetDurationMinutes).toBe(1);
    const apiTotal = genRes.body.project.scenes.reduce(
      (s: number, sc: { durationSec: number }) => s + sc.durationSec,
      0
    );
    expect(apiTotal).toBe(60);
  });

  it('clones native voices with audio samples & traits, synthesizes natively, and supports Push to ElevenLabs (export-ready & live push)', async () => {
    const appDir = path.join(tmpDir, 'voice-clone-app');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const fakeWav = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00data\x00\x00\x00\x00');
    const cloneRes = await request(created.app)
      .post('/api/voices/clone')
      .field('name', 'Dr. Lin Native')
      .field('tone', 'Crisp Technical')
      .field('pitch', 'low')
      .field('warmth', '82')
      .field('cadence', 'measured')
      .attach('sample', fakeWav, { filename: 'lin-sample.wav', contentType: 'audio/wav' })
      .expect(201);

    const voiceId = cloneRes.body.voice.voice_id as string;
    expect(cloneRes.body.voice.source).toBe('native');
    expect(cloneRes.body.voice.sampleUrl).toMatch(/^\/uploads\/voices\/voice-/);

    // Persists across app reload & shows up in /api/voices
    const reloaded = createApp({ dataDir: appDir });
    const listRes = await request(reloaded.app).get('/api/voices').expect(200);
    expect(listRes.body.voices.some((v: { voice_id: string }) => v.voice_id === voiceId)).toBe(true);

    // Native TTS synthesis uses system speech WAV when binary is present, or structured SpeechSynthesis fallback
    const ttsRes = await request(reloaded.app)
      .post('/api/tts')
      .send({ voiceId, text: 'Native cloned voice synthesis test.' })
      .expect(200);
    expect(ttsRes.headers['x-voice-source']).toBe('native');
    const ct = ttsRes.headers['content-type'] || '';
    if (ct.includes('audio/wav')) {
      expect(ttsRes.body.subarray(0, 4).toString('ascii')).toBe('RIFF');
    } else {
      expect(ct).toContain('application/json');
      expect(ttsRes.body.mode).toBe('browser-speech-synthesis');
      expect(ttsRes.body.source).toBe('native');
      expect(ttsRes.body.speechConfig.pitch).toBeLessThan(1);
    }

    // Push while disconnected returns ready workflow export
    const exportRes = await request(reloaded.app)
      .post(`/api/voices/${voiceId}/push-elevenlabs`)
      .expect(200);
    expect(exportRes.body.mode).toBe('export-ready');
    expect(exportRes.body.workflowExport.endpoint).toContain('/voices/add');

    // Connect ElevenLabs & push live
    await request(reloaded.app)
      .post('/api/connectors/elevenlabs/connect')
      .send({ apiKey: VALID_EL_KEY, endpoint: `${elevenServer.url}/v1` })
      .expect(200);

    const pushRes = await request(reloaded.app)
      .post(`/api/voices/${voiceId}/push-elevenlabs`)
      .expect(200);
    expect(pushRes.body.mode).toBe('pushed');
    expect(pushRes.body.elevenlabsVoiceId).toBe('el-pushed-voice-99');
  });

  it('connects Gemini Veo, pushes scene with character + RAG asset references, and polls job to ready videoUrl', async () => {
    const appDir = path.join(tmpDir, 'veo-app');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    // Invalid Gemini key fails
    await request(created.app)
      .post('/api/connectors/gemini_veo/connect')
      .send({ apiKey: 'bad-gemini-key', endpoint: `${veoServer.url}/v1beta` })
      .expect(400);

    // Valid Gemini key connects & saves to vault
    const connRes = await request(created.app)
      .post('/api/connectors/gemini_veo/connect')
      .send({
        apiKey: VALID_GEMINI_KEY,
        endpoint: `${veoServer.url}/v1beta`,
        model: 'veo-2.0-generate-001',
      })
      .expect(200);
    expect(connRes.body.ok).toBe(true);
    expect(connRes.body.connector.status).toBe('connected');
    expect(connRes.body.connector.maskedKey).toBe('...4321');
    expect(JSON.stringify(connRes.body)).not.toContain(VALID_GEMINI_KEY);

    // Upload a reference photo character & a tech asset to verify reference forwarding
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const projList = await request(created.app).get('/api/projects').expect(200);
    const project = projList.body.projects[0];
    const sceneId = project.scenes[0].id as string;

    const assetRes = await request(created.app)
      .post('/api/assets')
      .field('name', 'Blackwell GB200 NVL72 Cluster')
      .field('category', 'server-rack')
      .field('sourceType', 'photos')
      .field('technicalSpecs', '72 GPUs, 130 TB/s NVLink, liquid cooled')
      .field('tags', 'blackwell, gb200, rack, nvlink')
      .attach('media', pngBytes, { filename: 'gb200.png', contentType: 'image/png' })
      .expect(201);

    await request(created.app)
      .patch(`/api/projects/${project.id}/scenes/${sceneId}`)
      .send({ assetIds: [assetRes.body.asset.id] })
      .expect(200);

    // Push scene to Gemini Veo
    const pushRes = await request(created.app)
      .post('/api/providers/push')
      .send({ provider: 'gemini_veo', projectId: project.id, sceneId })
      .expect(200);
    expect(pushRes.body.job.provider).toBe('gemini_veo');
    expect(pushRes.body.job.status).toBe('queued');
    expect(pushRes.body.job.attachedMediaUrls).toContain(assetRes.body.asset.mediaUrls[0]);
    expect(lastVeoBody).toContain('Blackwell GB200 NVL72 Cluster');
    expect(lastVeoBody).toContain('bytesBase64Encoded');

    // Poll until ready
    const pollRes = await request(created.app)
      .get(`/api/providers/jobs/${project.id}/${sceneId}/gemini_veo`)
      .expect(200);
    expect(pollRes.body.job.status).toBe('ready');
    expect(pollRes.body.job.videoUrl).toBe('https://cdn.example.com/veo-scene-101.mp4');
  });

  it('indexes uploaded tech photos/videos in AssetLibrary and grounds Director Prompts & generation with RAG Context', async () => {
    const appDir = path.join(tmpDir, 'rag-app');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const uploadRes = await request(created.app)
      .post('/api/assets')
      .field('name', 'Cerebras Wafer-Scale Rack WSE-3')
      .field('category', 'hardware')
      .field('sourceType', 'photos')
      .field('description', 'Wafer-scale AI compute engine inside liquid-cooled chassis')
      .field('technicalSpecs', '4 trillion transistors, 900,000 AI cores, 44GB on-chip SRAM')
      .field('tags', 'wafer, cerebras, sram, hardware')
      .attach('media', pngBytes, { filename: 'wse3.png', contentType: 'image/png' })
      .expect(201);

    const assetId = uploadRes.body.asset.id as string;

    // Unit check retrieveRagContext
    const directMatches = retrieveRagContext({
      query: 'Explain wafer SRAM cores on Cerebras hardware',
      assets: [uploadRes.body.asset],
    });
    expect(directMatches[0].id).toBe(assetId);
    expect(directMatches[0].matchedTerms).toContain('wafer');

    // Director Prompt retrieves and attaches RAG context
    const projList = await request(created.app).get('/api/projects').expect(200);
    const projectId = projList.body.projects[0].id as string;

    const dirRes = await request(created.app)
      .post(`/api/projects/${projectId}/director`)
      .send({
        prompt: 'Add a new scene explaining wafer SRAM compute on Cerebras hardware',
      })
      .expect(200);

    expect(dirRes.body.ragContextUsed.some((r: { id: string }) => r.id === assetId)).toBe(true);
    const addedScene = dirRes.body.project.scenes[dirRes.body.project.scenes.length - 1];
    expect(addedScene.assetIds).toContain(assetId);
    expect(addedScene.visualPrompt).toContain('Cerebras Wafer-Scale Rack WSE-3');

    // Topic generation also grounds scenes with RAG Context
    const genRes = await request(created.app)
      .post('/api/projects/generate')
      .send({
        topic: 'Cerebras Wafer-Scale SRAM Architecture',
        durationMinutes: 1,
        audience: 'engineering',
      })
      .expect(201);
    expect(genRes.body.project.scenes[0].assetIds).toContain(assetId);
  });
});
