import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/index.js';
import {
  CredentialVault,
  formatHiggsfieldAuth,
  maskCredential,
} from '../server/store/credentialVault.js';

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

describe('Credential Vault, Connect/Disconnect Flows & Live Provider Clients', () => {
  let tmpDir: string;
  let elevenServer: MockServerHandle;
  let higgsfieldServer: MockServerHandle;
  let higgsfieldPollCount = 0;
  let higgsfieldForceError = false;
  let lastHiggsfieldAuthHeader = '';

  const VALID_EL_KEY = 'xi-live-secret-key-9876';
  const VALID_HF_KEY_ID = 'hf_id_1234';
  const VALID_HF_SECRET = 'hf_sec_abcd';

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'calamari-vault-test-'));

    elevenServer = await startMockServer((req, res) => {
      const apiKey = req.headers['xi-api-key'];
      if (apiKey !== VALID_EL_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Invalid ElevenLabs API key' }));
        return;
      }

      if (req.url === '/v1/voices') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            voices: [
              {
                voice_id: 'el-voice-001',
                name: 'Calamari Pro Narrator',
                category: 'cloned',
                labels: { accent: 'American', tone: 'studio' },
              },
            ],
          })
        );
        return;
      }

      if (req.url === '/v1/user') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            first_name: 'Ada Lovelace',
            email: 'ada@calamari.studio',
          })
        );
        return;
      }

      if (req.url === '/v1/user/subscription') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            tier: 'pro',
            character_count: 8000,
            character_limit: 50000,
          })
        );
        return;
      }

      if (req.url?.startsWith('/v1/text-to-speech/') && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        res.end(Buffer.from('ID3-FAKE-MP3-STREAM'));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    higgsfieldServer = await startMockServer((req, res) => {
      const auth = String(req.headers['authorization'] || '');
      lastHiggsfieldAuthHeader = auth;
      const expectedKeyAuth = `Key ${VALID_HF_KEY_ID}:${VALID_HF_SECRET}`;
      const expectedBearer = 'Bearer hf-bearer-token-5555';

      if (auth !== expectedKeyAuth && auth !== expectedBearer) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized Higgsfield credentials' }));
        return;
      }

      if (req.method === 'HEAD') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.url === '/v1/motions/generate' && req.method === 'POST') {
        if (higgsfieldForceError) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Upstream GPU cluster busy' }));
          return;
        }
        higgsfieldPollCount = 0;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            job_id: 'hf-job-777',
            status: 'queued',
            status_url: `${higgsfieldServer.url}/v1/jobs/hf-job-777`,
          })
        );
        return;
      }

      if (req.url === '/v1/jobs/hf-job-777' && req.method === 'GET') {
        higgsfieldPollCount += 1;
        if (higgsfieldPollCount === 1) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ job_id: 'hf-job-777', status: 'in_progress' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            job_id: 'hf-job-777',
            status: 'completed',
            video_url: 'https://cdn.example.com/calamari-scene.mp4',
          })
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  afterAll(async () => {
    await elevenServer.close();
    await higgsfieldServer.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('masks credentials safely and formats Higgsfield Key ID + Secret vs Bearer tokens', () => {
    expect(maskCredential('sk_12345678abcd')).toBe('...abcd');
    expect(maskCredential('Key id123:secret9999')).toBe('...9999');
    expect(maskCredential('tiny')).toBe('***');

    expect(formatHiggsfieldAuth('id1', 'sec2')).toMatchObject({
      authHeader: 'Key id1:sec2',
      scheme: 'Key',
      keyId: 'id1',
      keySecret: 'sec2',
    });
    expect(formatHiggsfieldAuth('Key id1:sec2')).toMatchObject({
      authHeader: 'Key id1:sec2',
      scheme: 'Key',
    });
    expect(formatHiggsfieldAuth('tok_single_99')).toMatchObject({
      authHeader: 'Bearer tok_single_99',
      scheme: 'Bearer',
    });
  });

  it('persists vault entries in dataDir/credentials.json and never leaks raw keys', async () => {
    const vaultDir = path.join(tmpDir, 'unit-vault');
    const vault1 = new CredentialVault(vaultDir);
    await vault1.set('elevenlabs', {
      apiKey: 'xi-super-secret-value',
      endpoint: `${elevenServer.url}/v1`,
    });

    const vault2 = new CredentialVault(vaultDir);
    expect(vault2.has('elevenlabs')).toBe(true);
    expect(vault2.get('elevenlabs')?.apiKey).toBe('xi-super-secret-value');

    const rawDisk = await fs.readFile(path.join(vaultDir, 'credentials.json'), 'utf-8');
    expect(rawDisk).toContain('xi-super-secret-value');

    const deleted = await vault2.delete('elevenlabs');
    expect(deleted).toBe(true);
    expect(new CredentialVault(vaultDir).has('elevenlabs')).toBe(false);
  });

  it('rejects invalid ElevenLabs keys, saves verified keys to vault, imports voices, synthesizes TTS, and disconnects cleanly', async () => {
    const appDir = path.join(tmpDir, 'el-flow');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    // 1. Invalid key must fail and NOT persist
    const badRes = await request(created.app)
      .post('/api/connectors/elevenlabs/connect')
      .send({
        apiKey: 'wrong-key',
        endpoint: `${elevenServer.url}/v1`,
      })
      .expect(400);

    expect(badRes.body.ok).toBe(false);
    expect(created.vault.has('elevenlabs')).toBe(false);

    // 2. Valid key verifies user + subscription + voices and persists to vault
    const okRes = await request(created.app)
      .post('/api/connectors/elevenlabs/connect')
      .send({
        apiKey: VALID_EL_KEY,
        endpoint: `${elevenServer.url}/v1`,
      })
      .expect(200);

    expect(okRes.body.ok).toBe(true);
    expect(okRes.body.connector.status).toBe('connected');
    expect(okRes.body.connector.keySource).toBe('vault');
    expect(okRes.body.connector.maskedKey).toBe('...9876');
    expect(okRes.body.connector.account).toMatchObject({
      label: 'Ada Lovelace',
      tier: 'pro',
      characterCount: 8000,
      characterLimit: 50000,
      remainingCharacters: 42000,
      voiceCount: 1,
    });
    expect(JSON.stringify(okRes.body)).not.toContain(VALID_EL_KEY);

    // 3. Survives app reload (page refresh simulation)
    const reloaded = createApp({ dataDir: appDir });
    const listRes = await request(reloaded.app).get('/api/connectors').expect(200);
    const elConn = listRes.body.connectors.find((c: { id: string }) => c.id === 'elevenlabs');
    expect(elConn.status).toBe('connected');
    expect(elConn.keySource).toBe('vault');
    expect(elConn.maskedKey).toBe('...9876');
    expect(JSON.stringify(listRes.body)).not.toContain(VALID_EL_KEY);

    // 4. Imports real voices & synthesizes real MP3 TTS
    const voicesRes = await request(reloaded.app).get('/api/voices').expect(200);
    expect(voicesRes.body.source).toBe('vault');
    expect(voicesRes.body.voices[0].voice_id).toBe('el-voice-001');

    const ttsRes = await request(reloaded.app)
      .post('/api/tts')
      .send({ voiceId: 'el-voice-001', text: 'Real ElevenLabs timeline audio.' })
      .expect(200);
    expect(ttsRes.headers['x-voice-source']).toBe('elevenlabs');
    expect(ttsRes.headers['content-type']).toContain('audio/mpeg');

    // 5. Explicit request header takes priority over saved local vault
    const headerOverride = await request(reloaded.app)
      .get('/api/connectors')
      .set('x-elevenlabs-key', 'xi-header-override-1111')
      .expect(200);
    const overriddenEl = headerOverride.body.connectors.find(
      (c: { id: string }) => c.id === 'elevenlabs'
    );
    expect(overriddenEl.keySource).toBe('session');
    expect(overriddenEl.maskedKey).toBe('...1111');
    expect(JSON.stringify(headerOverride.body)).not.toContain('xi-header-override-1111');

    // 6. Disconnect clears vault and restores Demo Mode
    const discRes = await request(reloaded.app)
      .post('/api/connectors/elevenlabs/disconnect')
      .expect(200);
    expect(discRes.body.ok).toBe(true);
    expect(discRes.body.connector.status).toBe('demo');
    expect(discRes.body.connector.savedInVault).toBe(false);

    const mockVoicesAgain = await request(reloaded.app).get('/api/voices').expect(200);
    expect(mockVoicesAgain.body.source).toBe('mock');
  });

  it('connects Higgsfield with Key ID + Secret, runs generate + status polling + Director Prompt, and reports errors cleanly', async () => {
    const appDir = path.join(tmpDir, 'hf-flow');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const hfEndpoint = `${higgsfieldServer.url}/v1/motions/generate`;

    // 1. Connect with Key ID + Key Secret
    const connectRes = await request(created.app)
      .post('/api/connectors/higgsfield/connect')
      .send({
        apiKey: VALID_HF_KEY_ID,
        apiSecret: VALID_HF_SECRET,
        endpoint: hfEndpoint,
        model: 'higgsfield-dop-pro',
      })
      .expect(200);

    expect(connectRes.body.ok).toBe(true);
    expect(connectRes.body.connector.status).toBe('connected');
    expect(connectRes.body.connector.maskedKey).toBe('...abcd');
    expect(lastHiggsfieldAuthHeader).toBe(`Key ${VALID_HF_KEY_ID}:${VALID_HF_SECRET}`);
    expect(JSON.stringify(connectRes.body)).not.toContain(VALID_HF_KEY_ID);
    expect(JSON.stringify(connectRes.body)).not.toContain(VALID_HF_SECRET);

    // 2. Generate scene -> queued -> poll -> generating -> poll -> ready with videoUrl
    const projectsRes = await request(created.app).get('/api/projects').expect(200);
    const project = projectsRes.body.projects[0];
    const sceneId = project.scenes[0].id as string;

    const genRes = await request(created.app)
      .post('/api/higgsfield/generate')
      .send({ projectId: project.id, sceneId })
      .expect(200);
    expect(genRes.body.higgsfield.provider).toBe('higgsfield');
    expect(genRes.body.higgsfield.status).toBe('queued');
    expect(genRes.body.higgsfield.jobId).toBe('hf-job-777');

    const poll1 = await request(created.app)
      .get(`/api/higgsfield/jobs/${project.id}/${sceneId}`)
      .expect(200);
    expect(poll1.body.higgsfield.status).toBe('generating');

    const poll2 = await request(created.app)
      .get(`/api/higgsfield/jobs/${project.id}/${sceneId}`)
      .expect(200);
    expect(poll2.body.higgsfield.status).toBe('ready');
    expect(poll2.body.higgsfield.videoUrl).toBe('https://cdn.example.com/calamari-scene.mp4');

    // 3. Director Prompt triggers Higgsfield generation automatically when requested
    const dirRes = await request(created.app)
      .post(`/api/projects/${project.id}/director`)
      .send({
        prompt: 'Add a new scene explaining tensor parallelism and render with Higgsfield',
      })
      .expect(200);
    const addedScene = dirRes.body.project.scenes[dirRes.body.project.scenes.length - 1];
    expect(addedScene.higgsfield.provider).toBe('higgsfield');
    expect(addedScene.higgsfield.status).toBe('queued');

    // 4. Upstream error reports failed status cleanly with errorMessage
    higgsfieldForceError = true;
    const errRes = await request(created.app)
      .post('/api/higgsfield/generate')
      .send({ projectId: project.id, sceneId })
      .expect(200);
    higgsfieldForceError = false;
    expect(errRes.body.higgsfield.status).toBe('failed');
    expect(errRes.body.higgsfield.errorMessage).toContain('Upstream GPU cluster busy');
  });
});
