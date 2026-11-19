import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/index.js';
import { synthesizeElevenLabsSpeech } from '../server/services/elevenlabs.js';
import { buildNativeDiagramSvg } from '../server/services/nativeVisualGenerator.js';
import { generateExplainerProject } from '../server/services/scriptGenerator.js';
import {
  analyzePcmSamples,
  encodeMonoPcm16Wav,
  parsePcmWavMono,
  shapeVoiceWavBuffer,
} from '../server/services/voiceDsp.js';

function createVoicedHarmonicWav(f0Hz: number, durationSec = 1.2, sampleRate = 16000): Buffer {
  const n = Math.floor(durationSec * sampleRate);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // Syllable amplitude modulation (~3.5 Hz)
    const env = 0.35 + 0.55 * Math.max(0, Math.sin(2 * Math.PI * 3.5 * t));
    // Rich speech-band harmonic + formant waveform (fundamental + mid/high formants)
    const wave =
      0.48 * Math.sin(2 * Math.PI * f0Hz * t) +
      0.22 * Math.sin(2 * Math.PI * f0Hz * 2 * t) +
      0.16 * Math.sin(2 * Math.PI * 1450 * t) +
      0.14 * Math.sin(2 * Math.PI * 3600 * t);
    samples[i] = env * wave * 0.65;
  }
  return encodeMonoPcm16Wav(samples, sampleRate);
}

async function createRealPptxFixture(): Promise<Buffer> {
  const zip = new JSZip();
  const png1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  zip.file('ppt/media/image1.png', png1x1);

  const makeSlideXml = (title: string, bullets: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody>${bullets
      .map((b) => `<a:p><a:r><a:t>${b}</a:t></a:r></a:p>`)
      .join('')}</p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;

  const makeNotesXml = (note: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${note}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`;

  zip.file(
    'ppt/slides/slide1.xml',
    makeSlideXml('Zero-Trust Service Mesh Overview', [
      'Mutual TLS identity per workload',
      'Policy enforcement at Envoy sidecars',
    ])
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`
  );
  zip.file(
    'ppt/notesSlides/notesSlide1.xml',
    makeNotesXml('Start by explaining why workload-level mTLS replaces perimeter trust.')
  );

  zip.file(
    'ppt/slides/slide2.xml',
    makeSlideXml('SPIFFE Identity Issuance Flow', [
      'Node attestation via cloud metadata',
      'Short-lived X.509 SVID rotation every 15 minutes',
    ])
  );
  zip.file(
    'ppt/notesSlides/notesSlide2.xml',
    makeNotesXml('Walk through how SPIRE agents rotate X.509 SVID certificates automatically.')
  );

  zip.file(
    'ppt/slides/slide3.xml',
    makeSlideXml('Authorization Policy Benchmarks', [
      'Sub-millisecond L7 RBAC evaluation',
      '99.99% control plane availability',
    ])
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('Milestone 1 Studio Upgrade: Voice DSP & Activation, PPTX & NotebookLM Sources, Prompt-Exact Scripts & Native Visuals', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'calamari-m1-upgrade-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('analyzes uploaded WAV acoustic signature (f0Hz, warmth/brightness, cadence) and binds cloned voice as active explainer voice across all scenes', async () => {
    const appDir = path.join(tmpDir, 'voice-dsp-app');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const listRes = await request(created.app).get('/api/projects').expect(200);
    const project = listRes.body.projects[0];

    const sampleWav = createVoicedHarmonicWav(122, 1.2, 16000);
    const cloneRes = await request(created.app)
      .post('/api/voices/clone')
      .field('name', 'Alex Deep Clone')
      .field('tone', 'Deep Documentary')
      .field('pitch', 'low')
      .field('warmth', '82')
      .field('cadence', 'measured')
      .field('projectId', project.id)
      .field('setAsActiveExplainerVoice', 'true')
      .attach('sample', sampleWav, { filename: 'alex-122hz.wav', contentType: 'audio/wav' })
      .expect(201);

    const voice = cloneRes.body.voice;
    expect(voice.acousticSignature).toBeDefined();
    expect(voice.acousticSignature.analyzedFromSample).toBe(true);
    expect(voice.acousticSignature.f0Hz).toBeGreaterThanOrEqual(105);
    expect(voice.acousticSignature.f0Hz).toBeLessThanOrEqual(140);
    expect(voice.acousticSignature.speakingRateWpm).toBeGreaterThanOrEqual(125);

    // Project primaryVoiceId AND every scene's voiceId updated immediately & persisted
    expect(cloneRes.body.project.primaryVoiceId).toBe(voice.voice_id);
    expect(
      cloneRes.body.project.scenes.every((s: { voiceId: string }) => s.voiceId === voice.voice_id)
    ).toBe(true);

    const reloaded = createApp({ dataDir: appDir });
    const reloadedProj = await request(reloaded.app).get(`/api/projects/${project.id}`).expect(200);
    expect(reloadedProj.body.project.primaryVoiceId).toBe(voice.voice_id);
    expect(
      reloadedProj.body.project.scenes.every((s: { voiceId: string }) => s.voiceId === voice.voice_id)
    ).toBe(true);

    // Verify shapeVoiceWavBuffer transforms PCM WAV pitch & spectral profile cleanly
    const neutralWav = createVoicedHarmonicWav(165, 0.8, 22050);
    const lowWarmWav = shapeVoiceWavBuffer(neutralWav, {
      traits: { tone: 'Deep Documentary', pitch: 'low', warmth: 90, cadence: 'measured' },
      acousticSignature: { f0Hz: 118, brightness: 30, warmth: 90, speakingRateWpm: 150, analyzedFromSample: true },
    });
    const highBrightWav = shapeVoiceWavBuffer(neutralWav, {
      traits: { tone: 'Crisp Technical', pitch: 'high', warmth: 25, cadence: 'brisk' },
      acousticSignature: { f0Hz: 215, brightness: 88, warmth: 25, speakingRateWpm: 205, analyzedFromSample: true },
    });

    const parsedLow = parsePcmWavMono(lowWarmWav);
    const parsedHigh = parsePcmWavMono(highBrightWav);
    expect(parsedLow).not.toBeNull();
    expect(parsedHigh).not.toBeNull();
    const sigLow = analyzePcmSamples(parsedLow!.samples, parsedLow!.sampleRate);
    const sigHigh = analyzePcmSamples(parsedHigh!.samples, parsedHigh!.sampleRate);
    expect(sigLow.f0Hz).toBeLessThan(sigHigh.f0Hz);
    expect(sigLow.brightness).toBeLessThan(sigHigh.brightness);
    expect(parsedLow!.samples.length).toBeGreaterThan(parsedHigh!.samples.length);

    // End-to-end TTS with mocked espeak-ng verifies DSP-shaped WAV response
    const ttsRes = await synthesizeElevenLabsSpeech({
      voiceId: voice.voice_id,
      text: 'Testing DSP voice shaping.',
      voiceStore: reloaded.voiceStore,
      platform: 'linux',
      execFileFn: async (bin, args) => {
        if (bin === 'espeak-ng') {
          const outIdx = args.indexOf('-w');
          await fs.writeFile(args[outIdx + 1], neutralWav);
          return { stdout: '', stderr: '' };
        }
        throw new Error('ENOENT');
      },
    });
    expect(ttsRes.kind).toBe('audio');
    if (ttsRes.kind === 'audio') {
      expect(ttsRes.dspShaped).toBe(true);
      expect(ttsRes.audioBuffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    }
  });

  it('supports per-scene Record Scene Take / Attach Audio Clip and serves it in /api/tts', async () => {
    const appDir = path.join(tmpDir, 'scene-take-app');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const listRes = await request(created.app).get('/api/projects').expect(200);
    const project = listRes.body.projects[0];
    const sceneId = project.scenes[0].id as string;

    const takeWav = createVoicedHarmonicWav(185, 0.5, 16000);
    const takeRes = await request(created.app)
      .post(`/api/projects/${project.id}/scenes/${sceneId}/voice-take`)
      .attach('audio', takeWav, { filename: 'scene1-take.wav', contentType: 'audio/wav' })
      .expect(201);

    expect(takeRes.body.voiceAudioUrl).toMatch(/^\/uploads\/voices\/voice-.*\.wav$/);
    expect(takeRes.body.scene.voicePlaybackMode).toBe('direct-sample');

    const ttsRes = await request(created.app)
      .post('/api/tts')
      .send({
        voiceId: project.scenes[0].voiceId,
        text: project.scenes[0].narration,
        projectId: project.id,
        sceneId,
      })
      .expect(200);
    expect(ttsRes.headers['x-voice-synthesis-mode']).toBe('direct-sample');
    expect(Buffer.from(ttsRes.body)).toEqual(takeWav);

    const delRes = await request(created.app)
      .delete(`/api/projects/${project.id}/scenes/${sceneId}/voice-take`)
      .expect(200);
    expect(delRes.body.scene.voiceAudioUrl).toBeUndefined();
  });

  it('parses real PPTX decks (slides in order, speaker notes, embedded images) and generates 1-to-1 source-exact explainers', async () => {
    const appDir = path.join(tmpDir, 'pptx-app');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const pptxBuf = await createRealPptxFixture();
    const importRes = await request(created.app)
      .post('/api/sources/import-pptx')
      .field('name', 'Zero-Trust Service Mesh Deck')
      .attach('file', pptxBuf, {
        filename: 'zero-trust-mesh.pptx',
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      })
      .expect(201);

    const source = importRes.body.source;
    expect(source.sourceType).toBe('pptx');
    expect(source.slides).toHaveLength(3);
    expect(source.slides[0].title).toBe('Zero-Trust Service Mesh Overview');
    expect(source.slides[0].bullets).toContain('Mutual TLS identity per workload');
    expect(source.slides[0].speakerNotes).toContain('workload-level mTLS');
    expect(source.slides[0].imageUrls).toHaveLength(1);
    expect(source.slides[1].title).toBe('SPIFFE Identity Issuance Flow');
    expect(source.slides[2].title).toBe('Authorization Policy Benchmarks');

    // Extracted PPTX image is served over HTTP
    await request(created.app).get(source.slides[0].imageUrls[0]).expect(200);

    // Generate explainer directly from PPTX source
    const genRes = await request(created.app)
      .post('/api/projects/generate')
      .send({
        topic: 'Zero-Trust Service Mesh',
        durationMinutes: 2,
        audience: 'engineering',
        sourceIds: [source.id],
      })
      .expect(201);

    const proj = genRes.body.project;
    expect(proj.scenes).toHaveLength(3);
    expect(proj.scenes[0].title).toContain('Zero-Trust Service Mesh Overview');
    expect(proj.scenes[0].narration).toContain('workload-level mTLS');
    expect(proj.scenes[1].title).toContain('SPIFFE Identity Issuance Flow');
    expect(proj.scenes[2].title).toContain('Authorization Policy Benchmarks');
    expect(proj.scenes[0].generatedVisualUrl).toMatch(/^\/uploads\/generated\/visual-.*\.svg$/);

    // Generated SVG is served over HTTP
    const svgRes = await request(created.app).get(proj.scenes[0].generatedVisualUrl).expect(200);
    const svgText = svgRes.text || Buffer.from(svgRes.body).toString('utf-8');
    expect(svgText).toContain('<svg');
  });

  it('ingests NotebookLM Briefing Docs and Audio Overviews and produces prompt-exact scripts without unrelated boilerplate', async () => {
    const appDir = path.join(tmpDir, 'notebooklm-app');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const mdDoc = `# Sourdough Starter Microbiology
- Wild yeast (Saccharomyces) produces CO2 for oven spring
- Lactic acid bacteria create tangy organic acids
Notes: Explain how hydration temperature shifts yeast versus bacterial fermentation balance.

# Autolyse & Gluten Network
- Flour and water rest 45 minutes before salt
- Hydrated gliadin and glutenin form elastic sheets`;

    const docRes = await request(created.app)
      .post('/api/sources/import-notebooklm')
      .field('name', 'Sourdough NotebookLM Briefing')
      .attach('file', Buffer.from(mdDoc, 'utf-8'), {
        filename: 'sourdough-briefing.md',
        contentType: 'text/markdown',
      })
      .expect(201);

    expect(docRes.body.source.sourceType).toBe('notebooklm-doc');
    expect(docRes.body.source.slides).toHaveLength(2);
    expect(docRes.body.source.slides[0].title).toBe('Sourdough Starter Microbiology');
    expect(docRes.body.source.slides[0].speakerNotes).toContain('hydration temperature');

    // Audio Overview ingestion via unified /api/sources/import
    const overviewWav = createVoicedHarmonicWav(150, 0.8, 16000);
    const audioRes = await request(created.app)
      .post('/api/sources/import')
      .field('name', 'NotebookLM Audio Overview')
      .attach('file', overviewWav, {
        filename: 'notebooklm-overview.wav',
        contentType: 'audio/wav',
      })
      .expect(201);

    expect(audioRes.body.source.sourceType).toBe('notebooklm-audio');
    expect(audioRes.body.source.audioUrl).toMatch(/^\/uploads\/sources\/nlm-audio-/);
    expect(audioRes.body.source.audioDurationSec).toBeCloseTo(0.8, 1);

    // Prompt-exact generation without unrelated tech boilerplate
    const promptProj = generateExplainerProject({
      topic: 'Compare Raft Leader Election vs Paxos Quorum Leases',
      durationMinutes: 2,
      audience: 'engineering',
    });
    const combinedNarration = promptProj.scenes.map((s) => s.narration).join(' ');
    expect(combinedNarration).toContain('Raft Leader Election');
    expect(combinedNarration).toContain('Paxos Quorum Leases');
    expect(combinedNarration).not.toContain('air traffic control');
    expect(combinedNarration).not.toContain('Runtime invariants & predictable tail latency');
  });

  it('generates prompt-tailored native SVG visuals via POST /api/assets/generate-visual and attaches to scenes', async () => {
    const appDir = path.join(tmpDir, 'native-visual-app');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const builtComp = buildNativeDiagramSvg({
      prompt: 'Compare gRPC HTTP/2 Multiplexing vs REST JSON Polling',
      title: 'gRPC vs REST',
      style: 'Neon Lab',
    });
    expect(builtComp.diagramType).toBe('comparison');
    expect(builtComp.svg).toContain('gRPC HTTP/2 Multiplexing');
    expect(builtComp.svg).toContain('REST JSON Polling');

    const projList = await request(created.app).get('/api/projects').expect(200);
    const project = projList.body.projects[0];
    const sceneId = project.scenes[0].id as string;

    const genVisRes = await request(created.app)
      .post('/api/assets/generate-visual')
      .send({
        prompt: 'Token Ingress -> KV Block Allocator -> PagedAttention Kernel -> Detokenizer',
        title: 'PagedAttention Pipeline',
        diagramType: 'flow',
        projectId: project.id,
        sceneId,
      })
      .expect(201);

    expect(genVisRes.body.diagramType).toBe('flow');
    expect(genVisRes.body.visualUrl).toMatch(/^\/uploads\/generated\/visual-.*\.svg$/);
    expect(genVisRes.body.project.scenes[0].generatedVisualUrl).toBe(genVisRes.body.visualUrl);
    expect(genVisRes.body.project.scenes[0].assetIds).toContain(genVisRes.body.asset.id);

    const svgFetch = await request(created.app).get(genVisRes.body.visualUrl).expect(200);
    const svgFetchText = svgFetch.text || Buffer.from(svgFetch.body).toString('utf-8');
    expect(svgFetchText).toContain('PagedAttention Pipeline');
  });
});
