import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/index.js';
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

describe('Cloned Voice Usage, MIME Normalization, Director Voice Routing & Video Proxy', () => {
  let tmpDir: string;
  let veoMock: MockServerHandle;
  let lastVeoRequestJson: Record<string, unknown> | null = null;
  const GEMINI_KEY = 'AIza-proxy-test-key-9999';

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'calamari-voice-media-test-'));

    veoMock = await startMockServer((req, res, body) => {
      if (req.headers['x-goog-api-key'] !== GEMINI_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Missing x-goog-api-key' } }));
        return;
      }
      if (req.url === '/v1beta/models' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'models/veo-2.0-generate-001' }] }));
        return;
      }
      if (req.url?.includes(':predictLongRunning') && req.method === 'POST') {
        lastVeoRequestJson = JSON.parse(body) as Record<string, unknown>;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            name: 'operations/veo-proxy-op-1',
            done: true,
            response: {
              generateVideoResponse: {
                generatedSamples: [
                  { video: { uri: `${veoMock.url}/v1beta/files/veo-output.mp4?alt=media` } },
                ],
              },
            },
          })
        );
        return;
      }
      if (req.url?.startsWith('/v1beta/files/veo-output.mp4') && req.method === 'GET') {
        const fakeMp4 = Buffer.from('00000018ftypmp4200000000mp42isom');
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': String(fakeMp4.length),
        });
        res.end(fakeMp4);
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  afterAll(async () => {
    await veoMock.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('accepts MediaRecorder codec MIME types (audio/webm;codecs=opus), serves uploaded sample, and deletes cleanly', async () => {
    const appDir = path.join(tmpDir, 'mime-test');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const webmBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
    const cloneRes = await request(created.app)
      .post('/api/voices/clone')
      .field('name', 'Mic Opus Clone')
      .field('tone', 'Crisp Technical')
      .field('pitch', 'medium')
      .field('warmth', '75')
      .field('cadence', 'conversational')
      .attach('sample', webmBytes, {
        filename: 'mic-recording.webm',
        contentType: 'audio/webm;codecs=opus',
      })
      .expect(201);

    const voice = cloneRes.body.voice;
    expect(voice.source).toBe('native');
    expect(voice.sampleMimeType).toBe('audio/webm');
    expect(voice.sampleUrl).toMatch(/^\/uploads\/voices\/voice-.*\.webm$/);

    // Uploaded sample is actually served by /uploads static middleware
    const sampleFetch = await request(created.app).get(voice.sampleUrl).expect(200);
    expect(Buffer.from(sampleFetch.body)).toEqual(webmBytes);

    // Extension fallback when mimetype is application/octet-stream
    const m4aRes = await request(created.app)
      .post('/api/voices/clone')
      .field('name', 'M4A Fallback Clone')
      .attach('sample', Buffer.from('FAKE-M4A'), {
        filename: 'sample.m4a',
        contentType: 'application/octet-stream',
      })
      .expect(201);
    expect(m4aRes.body.voice.sampleMimeType).toBe('audio/mp4');

    // Delete works
    await request(created.app).delete(`/api/voices/${m4aRes.body.voice.voice_id}`).expect(200);
    const voicesAfter = await request(created.app).get('/api/voices').expect(200);
    expect(
      voicesAfter.body.voices.some((v: { voice_id: string }) => v.voice_id === m4aRes.body.voice.voice_id)
    ).toBe(false);
  });

  it('applies explicit primaryVoiceId to all generated scenes even with preset characters, and supports Director Prompt voice switching', async () => {
    const appDir = path.join(tmpDir, 'voice-assign-test');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    // Unit check generateExplainerProject respects explicit primaryVoiceId
    const directProj = generateExplainerProject({
      topic: 'QUIC Multiplexing',
      durationMinutes: 1,
      primaryVoiceId: 'native-custom-123',
    });
    expect(directProj.scenes.every((s) => s.voiceId === 'native-custom-123')).toBe(true);

    // Clone a native voice via API
    const cloneRes = await request(created.app)
      .post('/api/voices/clone')
      .field('name', 'Elena Custom Clone')
      .field('pitch', 'low')
      .field('cadence', 'measured')
      .expect(201);
    const clonedVoiceId = cloneRes.body.voice.voice_id as string;

    // Generate project selecting cloned voice
    const genRes = await request(created.app)
      .post('/api/projects/generate')
      .send({
        topic: 'Distributed Raft',
        durationMinutes: 1,
        audience: 'engineering',
        primaryVoiceId: clonedVoiceId,
      })
      .expect(201);

    const project = genRes.body.project;
    expect(project.scenes.every((s: { voiceId: string }) => s.voiceId === clonedVoiceId)).toBe(true);

    // Synthesize TTS with cloned voice on scene 1
    const ttsRes = await request(created.app)
      .post('/api/tts')
      .send({
        voiceId: clonedVoiceId,
        text: project.scenes[0].narration,
        projectId: project.id,
        sceneId: project.scenes[0].id,
      })
      .expect(200);
    expect(ttsRes.headers['x-voice-source']).toBe('native');
    expect(ttsRes.headers['content-type']).toContain('audio/wav');

    // Director Prompt can switch voice back and then to cloned voice
    const dirSwitch = await request(created.app)
      .post(`/api/projects/${project.id}/director`)
      .send({ prompt: 'Switch voice to Adam on scene 1' })
      .expect(200);
    expect(dirSwitch.body.project.scenes[0].voiceId).toBe('mock-adam');

    const dirCloned = await request(created.app)
      .post(`/api/projects/${project.id}/director`)
      .send({ prompt: 'Use my cloned voice on all scenes' })
      .expect(200);
    expect(
      dirCloned.body.project.scenes.every((s: { voiceId: string }) => s.voiceId === clonedVoiceId)
    ).toBe(true);
  });

  it('handles Director Veo push in demo mode without corrupting narration and proxies authenticated Gemini Veo videos', async () => {
    const appDir = path.join(tmpDir, 'veo-proxy-test');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const listRes = await request(created.app).get('/api/projects').expect(200);
    const project = listRes.body.projects[0];
    const sceneId = project.scenes[0].id as string;
    const originalNarration = project.scenes[0].narration as string;

    // 1. Disconnected Director Veo push sets canvas-fallback without appending prompt to narration
    const dirDemo = await request(created.app)
      .post(`/api/projects/${project.id}/director`)
      .send({ prompt: 'Push scene 1 to Gemini Veo' })
      .expect(200);
    expect(dirDemo.body.project.scenes[0].veo.provider).toBe('canvas-fallback');
    expect(dirDemo.body.project.scenes[0].narration).toBe(originalNarration);

    // 2. Connected Gemini Veo omits invalid referenceAssetUrls from parameters & proxies video bytes
    await request(created.app)
      .post('/api/connectors/gemini_veo/connect')
      .send({
        apiKey: GEMINI_KEY,
        endpoint: `${veoMock.url}/v1beta`,
        model: 'veo-2.0-generate-001',
      })
      .expect(200);

    const pushRes = await request(created.app)
      .post('/api/providers/push')
      .send({ provider: 'gemini_veo', projectId: project.id, sceneId })
      .expect(200);

    expect(pushRes.body.job.status).toBe('ready');
    expect(pushRes.body.job.videoUrl).toContain('/v1beta/files/veo-output.mp4');
    expect((lastVeoRequestJson?.parameters as Record<string, unknown>)?.referenceAssetUrls).toBeUndefined();

    // Direct video proxy returns playable video/mp4
    const proxyRes = await request(created.app)
      .get(`/api/providers/video-proxy/${project.id}/${sceneId}/gemini_veo`)
      .set('x-gemini-veo-key', GEMINI_KEY)
      .expect(200);
    expect(proxyRes.headers['content-type']).toContain('video/mp4');
    expect(Buffer.from(proxyRes.body).toString('ascii')).toContain('ftypmp42');
  });
});
