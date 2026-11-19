import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/index.js';

describe('Milestone 2: Interactive Multi-Track Timeline, DnD Drop Handling & Guided Wizard Assembly', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'calamari-m2-timeline-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('supports timeline move/reorder and trimming across Scenes, Characters, Voiceover, and Music with Undo/Redo', async () => {
    const appDir = path.join(tmpDir, 'reorder-trim-app');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const listRes = await request(created.app).get('/api/projects').expect(200);
    const project = listRes.body.projects[0];
    expect(project.scenes.length).toBeGreaterThanOrEqual(3);
    const originalOrder = project.scenes.map((s: { id: string }) => s.id);

    // 1. Reorder scenes (move first scene to last)
    const reorderedIds = [...originalOrder.slice(1), originalOrder[0]];
    const reorderRes = await request(created.app)
      .patch(`/api/projects/${project.id}/scenes/reorder`)
      .send({ sceneIds: reorderedIds })
      .expect(200);

    expect(reorderRes.body.project.scenes.map((s: { id: string }) => s.id)).toEqual(reorderedIds);
    expect(reorderRes.body.project.scenes[0].order).toBe(0);

    // Undo restores original order
    const undoReorder = await request(created.app)
      .post(`/api/projects/${project.id}/undo`)
      .expect(200);
    expect(undoReorder.body.project.scenes.map((s: { id: string }) => s.id)).toEqual(originalOrder);

    // Redo reapplies reorder
    const redoReorder = await request(created.app)
      .post(`/api/projects/${project.id}/redo`)
      .expect(200);
    expect(redoReorder.body.project.scenes.map((s: { id: string }) => s.id)).toEqual(reorderedIds);

    // 2. Trim scene duration & trimStartSec, plus Character & Voiceover start/duration
    const targetSceneId = reorderedIds[0];
    const trimRes = await request(created.app)
      .patch(`/api/projects/${project.id}/scenes/${targetSceneId}`)
      .send({
        durationSec: 42,
        trimStartSec: 4,
        characterStartSec: 6,
        characterDurationSec: 18,
        voiceStartSec: 3,
        voiceDurationSec: 22,
        voiceTrimStartSec: 2,
      })
      .expect(200);

    expect(trimRes.body.scene.durationSec).toBe(42);
    expect(trimRes.body.scene.trimStartSec).toBe(4);
    expect(trimRes.body.scene.characterStartSec).toBe(6);
    expect(trimRes.body.scene.characterDurationSec).toBe(18);
    expect(trimRes.body.scene.voiceStartSec).toBe(3);
    expect(trimRes.body.scene.voiceDurationSec).toBe(22);
    expect(trimRes.body.scene.voiceTrimStartSec).toBe(2);

    // 3. Trim & reposition Music track
    const musicId = project.musicTracks[0].id as string;
    const musicPatchRes = await request(created.app)
      .patch(`/api/projects/${project.id}/music/${musicId}`)
      .send({
        startTimeSec: 12,
        durationSec: 65,
        bpm: 120,
        volumeDb: -12,
      })
      .expect(200);

    expect(musicPatchRes.body.track.startTimeSec).toBe(12);
    expect(musicPatchRes.body.track.durationSec).toBe(65);
    expect(musicPatchRes.body.track.bpm).toBe(120);
    expect(musicPatchRes.body.track.volumeDb).toBe(-12);

    // Persists across reload
    const reloaded = createApp({ dataDir: appDir });
    const reloadedProj = await request(reloaded.app).get(`/api/projects/${project.id}`).expect(200);
    expect(reloadedProj.body.project.scenes[0].durationSec).toBe(42);
    expect(reloadedProj.body.project.musicTracks[0].startTimeSec).toBe(12);
  });

  it('deletes individual Music beds, Voiceover clips, Character appearances, and Scenes with Undo restoration', async () => {
    const appDir = path.join(tmpDir, 'delete-tracks-app');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const genRes = await request(created.app)
      .post('/api/projects/generate')
      .send({
        topic: 'Distributed Consensus Raft Protocol',
        durationMinutes: 1,
        audience: 'engineering',
      })
      .expect(201);

    const project = genRes.body.project;
    expect(project.scenes.length).toBe(4);
    const scene0 = project.scenes[0];
    const scene1 = project.scenes[1];
    const music0 = project.musicTracks[0];

    // 1. Delete Music track -> Undo restores
    const delMusic = await request(created.app)
      .delete(`/api/projects/${project.id}/music/${music0.id}`)
      .expect(200);
    expect(delMusic.body.project.musicTracks.some((m: { id: string }) => m.id === music0.id)).toBe(false);

    const undoMusic = await request(created.app)
      .post(`/api/projects/${project.id}/undo`)
      .expect(200);
    expect(undoMusic.body.project.musicTracks.some((m: { id: string }) => m.id === music0.id)).toBe(true);

    // 2. Delete Voiceover clip -> Undo restores
    const delVo = await request(created.app)
      .patch(`/api/projects/${project.id}/scenes/${scene0.id}`)
      .send({ voiceEnabled: false })
      .expect(200);
    expect(delVo.body.scene.voiceEnabled).toBe(false);

    const undoVo = await request(created.app)
      .post(`/api/projects/${project.id}/undo`)
      .expect(200);
    expect(undoVo.body.project.scenes[0].voiceEnabled).not.toBe(false);

    // 3. Delete Character appearance -> Undo restores
    const delChar = await request(created.app)
      .patch(`/api/projects/${project.id}/scenes/${scene0.id}`)
      .send({
        characterId: null,
        characterPlacement: 'offscreen',
        characterStartSec: null,
        characterDurationSec: null,
      })
      .expect(200);
    expect(delChar.body.scene.characterId).toBeUndefined();
    expect(delChar.body.scene.characterPlacement).toBe('offscreen');

    const undoChar = await request(created.app)
      .post(`/api/projects/${project.id}/undo`)
      .expect(200);
    expect(undoChar.body.project.scenes[0].characterId).toBe(scene0.characterId);

    // 4. Delete Scene -> Undo restores
    const delScene = await request(created.app)
      .delete(`/api/projects/${project.id}/scenes/${scene1.id}`)
      .expect(200);
    expect(delScene.body.project.scenes).toHaveLength(3);
    expect(delScene.body.project.scenes.some((s: { id: string }) => s.id === scene1.id)).toBe(false);

    const undoScene = await request(created.app)
      .post(`/api/projects/${project.id}/undo`)
      .expect(200);
    expect(undoScene.body.project.scenes).toHaveLength(4);
    expect(undoScene.body.project.scenes.some((s: { id: string }) => s.id === scene1.id)).toBe(true);
  });

  it('handles drag-and-drop items (Assets, Sources, Characters, Voices, Music presets) onto timeline tracks', async () => {
    const appDir = path.join(tmpDir, 'dnd-app');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const listRes = await request(created.app).get('/api/projects').expect(200);
    const project = listRes.body.projects[0];
    const scene0 = project.scenes[0];

    // Upload an asset, import a NotebookLM source, and clone a voice
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const assetRes = await request(created.app)
      .post('/api/assets')
      .field('name', 'NVLink Switch Board')
      .field('category', 'hardware')
      .field('sourceType', 'photos')
      .attach('media', pngBytes, { filename: 'nvlink.png', contentType: 'image/png' })
      .expect(201);

    const sourceRes = await request(created.app)
      .post('/api/sources/import-notebooklm')
      .send({
        name: 'NVLink Architecture Notes',
        rawText: '# NVLink Topology\n- All-to-all GPU fabric\n- 900 GB/s per GPU',
      })
      .expect(201);

    const voiceRes = await request(created.app)
      .post('/api/voices/clone')
      .field('name', 'Aria Host')
      .field('tone', 'Crisp Technical')
      .expect(201);

    // 1. Drop Asset onto existing Scene
    const dropAssetExisting = await request(created.app)
      .post(`/api/projects/${project.id}/timeline/drop`)
      .send({
        track: 'scene',
        dropSec: 5,
        targetSceneId: scene0.id,
        payload: { kind: 'asset', assetId: assetRes.body.asset.id, name: 'NVLink Switch Board' },
      })
      .expect(200);
    expect(dropAssetExisting.body.project.scenes[0].assetIds).toContain(assetRes.body.asset.id);

    // 2. Drop Asset past end of Scenes track -> creates new scene
    const totalSec = dropAssetExisting.body.project.scenes.reduce(
      (s: number, sc: { durationSec: number }) => s + sc.durationSec,
      0
    );
    const dropAssetNew = await request(created.app)
      .post(`/api/projects/${project.id}/timeline/drop`)
      .send({
        track: 'scene',
        dropSec: totalSec + 5,
        payload: { kind: 'asset', assetId: assetRes.body.asset.id, name: 'NVLink Switch Board' },
      })
      .expect(200);
    expect(dropAssetNew.body.project.scenes.length).toBe(project.scenes.length + 1);

    // 3. Drop Source onto Scenes track -> inserts scene from source
    const dropSource = await request(created.app)
      .post(`/api/projects/${project.id}/timeline/drop`)
      .send({
        track: 'scene',
        dropSec: 15,
        targetSceneId: scene0.id,
        payload: { kind: 'source', sourceId: sourceRes.body.source.id, name: 'NVLink Architecture Notes' },
      })
      .expect(200);
    expect(
      dropSource.body.project.scenes.some((s: { title: string }) => s.title.includes('NVLink Topology'))
    ).toBe(true);

    // 4. Drop Character onto Characters track
    const charId = project.characters[1]?.id || project.characters[0].id;
    const dropChar = await request(created.app)
      .post(`/api/projects/${project.id}/timeline/drop`)
      .send({
        track: 'character',
        dropSec: 8,
        targetSceneId: scene0.id,
        payload: { kind: 'character', characterId: charId },
      })
      .expect(200);
    const updatedScene0 = dropChar.body.project.scenes.find((s: { id: string }) => s.id === scene0.id);
    expect(updatedScene0.characterId).toBe(charId);
    expect(updatedScene0.characterStartSec).toBe(8);

    // 5. Drop Voice onto Voiceover track
    const dropVoice = await request(created.app)
      .post(`/api/projects/${project.id}/timeline/drop`)
      .send({
        track: 'voiceover',
        dropSec: 4,
        targetSceneId: scene0.id,
        payload: { kind: 'voice', voiceId: voiceRes.body.voice.voice_id, name: 'Aria Host' },
      })
      .expect(200);
    const voicedScene0 = dropVoice.body.project.scenes.find((s: { id: string }) => s.id === scene0.id);
    expect(voicedScene0.voiceId).toBe(voiceRes.body.voice.voice_id);
    expect(voicedScene0.voiceStartSec).toBe(4);
    expect(voicedScene0.voiceEnabled).toBe(true);

    // 6. Drop Music preset onto Music track
    const dropMusic = await request(created.app)
      .post(`/api/projects/${project.id}/timeline/drop`)
      .send({
        track: 'music',
        dropSec: 22,
        payload: {
          kind: 'music-preset',
          title: 'Midnight Synthwave',
          mood: 'Upbeat Electronic',
          bpm: 118,
          volumeDb: -15,
          accentColor: '#a855f7',
        },
      })
      .expect(200);
    expect(
      dropMusic.body.project.musicTracks.some(
        (m: { title: string; startTimeSec: number }) =>
          m.title === 'Midnight Synthwave' && m.startTimeSec === 22
      )
    ).toBe(true);
  });

  it('assembles a full 4-track project from Guided Wizard configuration (style, animation preset, voice, cast, sources, SVG visuals, music)', async () => {
    const appDir = path.join(tmpDir, 'wizard-app');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const voiceRes = await request(created.app)
      .post('/api/voices/clone')
      .field('name', 'Wizard Narrator')
      .field('tone', 'Energetic Educator')
      .expect(201);

    const srcRes = await request(created.app)
      .post('/api/sources/import-notebooklm')
      .send({
        name: 'Wizard Source Brief',
        rawText: '# Step A: Ingestion\n- Tokenize prompt\n# Step B: Attention\n- Query-Key dot product',
      })
      .expect(201);

    const charRes = await request(created.app).get('/api/characters').expect(200);
    const selectedCharId = charRes.body.characters[0].id as string;

    const assembleRes = await request(created.app)
      .post('/api/projects/generate')
      .send({
        topic: 'Transformer Attention Pipeline',
        durationMinutes: 2,
        audience: 'engineering',
        primaryVoiceId: voiceRes.body.voice.voice_id,
        characterIds: [selectedCharId],
        sourceIds: [srcRes.body.source.id],
        autoGenerateVisuals: true,
        cinematicStyle: 'Blueprint Isometric',
        animationPreset: 'timeline-walkthrough',
        diagramType: 'flow',
        musicPreset: {
          title: 'Quantum Minimalist',
          mood: 'Minimalist Pluck',
          bpm: 96,
          volumeDb: -18,
          accentColor: '#06b6d4',
        },
      })
      .expect(201);

    const proj = assembleRes.body.project;
    expect(proj.primaryVoiceId).toBe(voiceRes.body.voice.voice_id);
    expect(proj.scenes).toHaveLength(2);
    expect(proj.scenes[0].cinematicStyle).toBe('Blueprint Isometric');
    expect(proj.scenes[0].animationPreset).toBe('timeline-walkthrough');
    expect(proj.scenes[0].characterId).toBe(selectedCharId);
    expect(proj.scenes[0].voiceId).toBe(voiceRes.body.voice.voice_id);
    expect(proj.scenes[0].generatedVisualUrl).toMatch(/^\/uploads\/generated\/visual-.*\.svg$/);
    expect(proj.musicTracks).toHaveLength(1);
    expect(proj.musicTracks[0].title).toBe('Quantum Minimalist');
    expect(proj.musicTracks[0].bpm).toBe(96);
  });
});
