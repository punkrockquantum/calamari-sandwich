import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/index.js';
import { validateCharacterUpload } from '../server/services/characterService.js';
import { generateExplainerProject } from '../server/services/scriptGenerator.js';

describe('Explainer Studio Full-Stack API & Core Services', () => {
  let tmpDir: string;
  let app: ReturnType<typeof createApp>['app'];

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'calamari-studio-test-'));
    const created = createApp({ dataDir: tmpDir });
    await created.store.ensureInitialized();
    app = created.app;
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('scales chapters and pacing accurately from 2 minutes up to 30 minutes', () => {
    const shortProj = generateExplainerProject({
      topic: 'TCP Congestion Control',
      durationMinutes: 2,
      audience: 'beginner',
    });
    const longProj = generateExplainerProject({
      topic: 'Distributed Consensus Algorithms',
      durationMinutes: 30,
      audience: 'engineering',
    });

    const shortSec = shortProj.scenes.reduce((s, sc) => s + sc.durationSec, 0);
    const longSec = longProj.scenes.reduce((s, sc) => s + sc.durationSec, 0);

    expect(shortSec).toBe(120);
    expect(shortProj.chapters.length).toBe(3);
    expect(longSec).toBe(1800);
    expect(longProj.chapters.length).toBe(10);
    expect(longProj.scenes.length).toBeGreaterThan(shortProj.scenes.length);
  });

  it('validates character cloning upload rules (max 5 photos or 1 video, no mixing)', () => {
    const validPhotos = Array.from({ length: 5 }, (_, i) => ({
      originalname: `face-${i}.png`,
      mimetype: 'image/png',
      size: 1024,
      url: `/uploads/face-${i}.png`,
    }));
    expect(validateCharacterUpload(validPhotos).valid).toBe(true);

    const tooManyPhotos = [
      ...validPhotos,
      { originalname: 'extra.png', mimetype: 'image/png', size: 1024, url: '/uploads/6.png' },
    ];
    const resTooMany = validateCharacterUpload(tooManyPhotos);
    expect(resTooMany.valid).toBe(false);

    const mixed = [
      validPhotos[0],
      { originalname: 'clip.mp4', mimetype: 'video/mp4', size: 2048, url: '/uploads/clip.mp4' },
    ];
    expect(validateCharacterUpload(mixed).valid).toBe(false);

    const singleVideo = [
      { originalname: 'clip.mp4', mimetype: 'video/mp4', size: 2048, url: '/uploads/clip.mp4' },
    ];
    const videoRes = validateCharacterUpload(singleVideo);
    expect(videoRes).toEqual({ valid: true, sourceType: 'video' });
  });

  it('generates and persists a multi-chapter explainer project across store reloads', async () => {
    const createRes = await request(app)
      .post('/api/projects/generate')
      .send({
        topic: 'Zero-Knowledge Proofs',
        durationMinutes: 10,
        audience: 'engineering',
      })
      .expect(201);

    const projectId = createRes.body.project.id as string;
    expect(createRes.body.project.chapters.length).toBe(6);

    // Reload from a fresh createApp pointing at the same dataDir
    const reloaded = createApp({ dataDir: tmpDir });
    const listRes = await request(reloaded.app).get('/api/projects').expect(200);
    expect(listRes.body.projects.some((p: { id: string }) => p.id === projectId)).toBe(true);
  });

  it('supports character photo upload cloning via multipart API', async () => {
    const listRes = await request(app).get('/api/projects').expect(200);
    const projectId = listRes.body.projects[0].id as string;

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = await request(app)
      .post('/api/characters/clone')
      .field('name', 'Elena Vance')
      .field('role', 'Cryptography Lead')
      .field('sourceType', 'photos')
      .field('stylePreset', 'Cyberpunk Architect')
      .field('projectId', projectId)
      .attach('media', pngHeader, { filename: 'elena1.png', contentType: 'image/png' })
      .attach('media', pngHeader, { filename: 'elena2.png', contentType: 'image/png' })
      .expect(201);

    expect(res.body.character.name).toBe('Elena Vance');
    expect(res.body.character.sourceType).toBe('photos');
    expect(res.body.character.mediaUrls).toHaveLength(2);
  });

  it('exposes ElevenLabs voices & TTS fallback without leaking server or session keys', async () => {
    const statusRes = await request(app)
      .get('/api/providers/status')
      .set('x-elevenlabs-key', 'sk-secret-test-key')
      .expect(200);

    expect(statusRes.body.elevenlabs).toEqual({ configured: true, source: 'session' });
    expect(JSON.stringify(statusRes.body)).not.toContain('sk-secret-test-key');

    const voicesRes = await request(app).get('/api/voices').expect(200);
    expect(voicesRes.body.voices.length).toBeGreaterThanOrEqual(4);
    expect(voicesRes.body.source).toBe('mock');

    const ttsRes = await request(app)
      .post('/api/tts')
      .send({ voiceId: 'mock-rachel', text: 'Explaining attention heads in 60 seconds.' })
      .expect(200);

    const ct = ttsRes.headers['content-type'] || '';
    if (ct.includes('audio/wav')) {
      expect(Buffer.isBuffer(ttsRes.body)).toBe(true);
      expect(ttsRes.body.subarray(0, 4).toString('ascii')).toBe('RIFF');
    } else {
      expect(ct).toContain('application/json');
      expect(ttsRes.body.mode).toBe('browser-speech-synthesis');
      expect(ttsRes.body.text).toBe('Explaining attention heads in 60 seconds.');
      expect(ttsRes.body.speechConfig.preferredVoices.length).toBeGreaterThan(0);
    }
  });

  it('supports Higgsfield scene generation fallback and Director Prompt iterative edits with undo/redo', async () => {
    const listRes = await request(app).get('/api/projects').expect(200);
    const project = listRes.body.projects[0];
    const initialSceneCount = project.scenes.length;

    const hfRes = await request(app)
      .post('/api/higgsfield/generate')
      .send({ projectId: project.id, sceneId: project.scenes[0].id })
      .expect(200);
    expect(hfRes.body.higgsfield.provider).toBe('canvas-fallback');

    const dirRes1 = await request(app)
      .post(`/api/projects/${project.id}/director`)
      .send({
        prompt: 'Add a new scene explaining speculative decoding with Neon Lab and Orbital Pan',
      })
      .expect(200);
    expect(dirRes1.body.project.scenes.length).toBe(initialSceneCount + 1);

    const dirRes2 = await request(app)
      .post(`/api/projects/${project.id}/director`)
      .send({
        prompt: 'Add synthwave soundtrack "Midnight Pulse" at -14dB',
      })
      .expect(200);
    expect(
      dirRes2.body.project.musicTracks.some(
        (m: { title: string }) => m.title === 'Midnight Pulse'
      )
    ).toBe(true);

    // Undo should revert soundtrack addition
    const undoRes = await request(app)
      .post(`/api/projects/${project.id}/undo`)
      .expect(200);
    expect(
      undoRes.body.project.musicTracks.some(
        (m: { title: string }) => m.title === 'Midnight Pulse'
      )
    ).toBe(false);
    expect(undoRes.body.project.scenes.length).toBe(initialSceneCount + 1);

    // Redo should restore soundtrack
    const redoRes = await request(app)
      .post(`/api/projects/${project.id}/redo`)
      .expect(200);
    expect(
      redoRes.body.project.musicTracks.some(
        (m: { title: string }) => m.title === 'Midnight Pulse'
      )
    ).toBe(true);
  });

  it('exposes all 6 API Connectors with Demo Mode, Connected, Not Configured statuses & live Test Connection', async () => {
    // 1. Default Demo Mode across all 6 connectors
    const listRes = await request(app).get('/api/connectors').expect(200);
    expect(listRes.body.connectors).toHaveLength(6);
    expect(listRes.body.connectors.map((c: { id: string }) => c.id)).toEqual([
      'elevenlabs',
      'higgsfield',
      'gemini_veo',
      'character_cloning',
      'script_director_llm',
      'music_soundtrack',
    ]);
    expect(
      listRes.body.connectors.every((c: { status: string }) => c.status === 'demo')
    ).toBe(true);

    // 2. Session key switches connector to Connected without ever echoing key
    const withKeyRes = await request(app)
      .get('/api/connectors')
      .set('x-character-clone-key', 'cc-secret-123456')
      .expect(200);
    const cloneConn = withKeyRes.body.connectors.find(
      (c: { id: string }) => c.id === 'character_cloning'
    );
    expect(cloneConn.status).toBe('connected');
    expect(cloneConn.keySource).toBe('session');
    expect(JSON.stringify(withKeyRes.body)).not.toContain('cc-secret-123456');

    // 3. Disabling demo fallback reports Not Configured
    const noDemoRes = await request(app)
      .get('/api/connectors')
      .set('x-connectors-demo-disabled', 'music_soundtrack')
      .expect(200);
    const musicConn = noDemoRes.body.connectors.find(
      (c: { id: string }) => c.id === 'music_soundtrack'
    );
    expect(musicConn.status).toBe('not_configured');

    // 4. Test Connection endpoint works in Demo Mode, Connected, and Not Configured
    const demoTest = await request(app)
      .post('/api/connectors/elevenlabs/test')
      .expect(200);
    expect(demoTest.body.ok).toBe(true);
    expect(demoTest.body.status).toBe('demo');

    const connectedTest = await request(app)
      .post('/api/connectors/character_cloning/test')
      .set('x-character-clone-key', 'cc-secret-123456')
      .expect(200);
    expect(connectedTest.body.ok).toBe(true);
    expect(connectedTest.body.status).toBe('connected');

    const unconfiguredTest = await request(app)
      .post('/api/connectors/music_soundtrack/test')
      .set('x-connectors-demo-disabled', 'music_soundtrack')
      .expect(200);
    expect(unconfiguredTest.body.ok).toBe(false);
    expect(unconfiguredTest.body.status).toBe('not_configured');
  });
});
