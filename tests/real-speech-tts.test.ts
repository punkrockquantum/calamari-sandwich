import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/index.js';
import {
  aiffToWav,
  buildEspeakArgs,
  buildMacOsSayArgs,
  createPcmWavHeader,
  resolveSpeechProfile,
  sanitizeSpeechText,
  synthesizeElevenLabsSpeech,
  synthesizeSystemSpeechWav,
} from '../server/services/elevenlabs.js';
import type { VoiceProfile } from '../shared/types.js';

function encodeExtended80For22050(): Buffer {
  // 22050 = 1.3458251953125 * 2^14 -> exponent 16383 + 14 = 0x400D, mantissaHigh = 0xAC440000
  const buf = Buffer.alloc(10);
  buf.writeUInt16BE(0x400d, 0);
  buf.writeUInt32BE(0xac440000, 2);
  buf.writeUInt32BE(0, 6);
  return buf;
}

function buildTestAiff(samples: number[], compression: 'NONE' | 'sowt'): Buffer {
  const sampleBytes = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => {
    if (compression === 'sowt') {
      sampleBytes.writeInt16LE(s, i * 2);
    } else {
      sampleBytes.writeInt16BE(s, i * 2);
    }
  });

  const commData = Buffer.alloc(compression === 'sowt' ? 22 : 18);
  commData.writeInt16BE(1, 0); // channels
  commData.writeUInt32BE(samples.length, 2); // frames
  commData.writeInt16BE(16, 6); // bitsPerSample
  encodeExtended80For22050().copy(commData, 8);
  if (compression === 'sowt') {
    commData.write('sowt', 18, 'ascii');
  }

  const commHeader = Buffer.alloc(8);
  commHeader.write('COMM', 0, 'ascii');
  commHeader.writeUInt32BE(commData.length, 4);

  const ssndBody = Buffer.alloc(8 + sampleBytes.length);
  ssndBody.writeUInt32BE(0, 0); // offset
  ssndBody.writeUInt32BE(0, 4); // blockSize
  sampleBytes.copy(ssndBody, 8);

  const ssndHeader = Buffer.alloc(8);
  ssndHeader.write('SSND', 0, 'ascii');
  ssndHeader.writeUInt32BE(ssndBody.length, 4);

  const formType = Buffer.from(compression === 'sowt' ? 'AIFC' : 'AIFF', 'ascii');
  const inner = Buffer.concat([formType, commHeader, commData, ssndHeader, ssndBody]);
  const formHeader = Buffer.alloc(8);
  formHeader.write('FORM', 0, 'ascii');
  formHeader.writeUInt32BE(inner.length, 4);
  return Buffer.concat([formHeader, inner]);
}

describe('Real Spoken TTS Pipeline, macOS say/AIFF Handling, Fallback & Direct Recorded Clip Playback', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'calamari-real-tts-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('sanitizes CLI speech text and builds safe execFile arguments for macOS say and espeak-ng', () => {
    expect(sanitizeSpeechText('  -dangerous\n\x00flag  text\t')).toBe(' -dangerous flag text');
    expect(sanitizeSpeechText('   ')).toBe('Narration ready.');

    const sayArgs = buildMacOsSayArgs({
      voice: 'Daniel',
      wpm: 152,
      outputPath: '/tmp/out.wav',
      text: '-leading dash; $(rm -rf /)',
      fileFormat: 'WAVE',
    });
    expect(sayArgs).toEqual([
      '-v',
      'Daniel',
      '-r',
      '152',
      '-o',
      '/tmp/out.wav',
      '--file-format=WAVE',
      '--data-format=LEI16@22050',
      ' -leading dash; $(rm -rf /)',
    ]);

    const espeakArgs = buildEspeakArgs({
      voice: 'en-us+f3',
      wpm: 176,
      pitch: 50,
      outputPath: '/tmp/out.wav',
      text: 'Hello world',
    });
    expect(espeakArgs).toEqual([
      '-v',
      'en-us+f3',
      '-s',
      '176',
      '-p',
      '50',
      '-w',
      '/tmp/out.wav',
      '--',
      'Hello world',
    ]);
  });

  it('maps mock studio voices and native cloned traits to real macOS voices, WPM, and SpeechSynthesis configs', () => {
    expect(resolveSpeechProfile('mock-rachel').macOsVoice).toBe('Samantha');
    expect(resolveSpeechProfile('mock-adam').macOsVoice).toBe('Daniel');
    expect(resolveSpeechProfile('mock-bella').macOsVoice).toBe('Karen');
    expect(resolveSpeechProfile('mock-antoni').macOsVoice).toBe('Alex');
    expect(resolveSpeechProfile('mock-matilda').macOsVoice).toBe('Ava');

    const deepNative: VoiceProfile = {
      voice_id: 'native-deep',
      name: 'Deep Host',
      category: 'cloned-native',
      source: 'native',
      labels: {},
      traits: {
        tone: 'Calm Analyst',
        pitch: 'low',
        warmth: 85,
        cadence: 'measured',
      },
    };
    const mapped = resolveSpeechProfile('native-deep', deepNative);
    expect(mapped.macOsVoice).toBe('Rishi');
    expect(mapped.wpm).toBe(152);
    expect(mapped.browserSpeechConfig.rate).toBe(0.88);
    expect(mapped.browserSpeechConfig.pitch).toBeLessThan(0.9);
  });

  it('converts both big-endian AIFF (NONE) and little-endian AIFC (sowt) into valid PCM WAV buffers', () => {
    const samples = [1000, -1000, 16384, -16384];
    const beAiff = buildTestAiff(samples, 'NONE');
    const wavFromBe = aiffToWav(beAiff);

    expect(wavFromBe.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wavFromBe.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wavFromBe.readUInt32LE(24)).toBe(22050);
    expect(wavFromBe.readInt16LE(44)).toBe(1000);
    expect(wavFromBe.readInt16LE(46)).toBe(-1000);

    const sowtAiff = buildTestAiff(samples, 'sowt');
    const wavFromSowt = aiffToWav(sowtAiff);
    expect(wavFromSowt.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wavFromSowt.readInt16LE(44)).toBe(1000);
    expect(wavFromSowt.readInt16LE(48)).toBe(16384);
  });

  it('synthesizes WAV via macOS /usr/bin/say (WAVE and AIFF fallback), espeak-ng, and returns null when no binary exists', async () => {
    // 1. macOS direct WAVE output
    const fakePcm = Buffer.alloc(64, 0x11);
    const validWav = Buffer.concat([createPcmWavHeader(fakePcm.length, 22050), fakePcm]);
    const calls: string[][] = [];

    const macDirect = await synthesizeSystemSpeechWav({
      text: 'Testing macOS say synthesis.',
      voiceId: 'mock-rachel',
      platform: 'darwin',
      execFileFn: async (bin, args) => {
        expect(bin).toBe('/usr/bin/say');
        calls.push([...args]);
        const outIdx = args.indexOf('-o');
        await fs.writeFile(args[outIdx + 1], validWav);
        return { stdout: '', stderr: '' };
      },
    });
    expect(macDirect?.engine).toBe('macos-say');
    expect(macDirect?.audioBuffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(calls[0]).toContain('--file-format=WAVE');

    // 2. macOS AIFF fallback when --file-format=WAVE fails
    const sowtAiff = buildTestAiff([500, -500, 1200, -1200], 'sowt');
    const macAiffFallback = await synthesizeSystemSpeechWav({
      text: 'Testing AIFF conversion.',
      voiceId: 'mock-adam',
      platform: 'darwin',
      execFileFn: async (_bin, args) => {
        if (args.includes('--file-format=WAVE')) {
          throw new Error('WAVE format rejected');
        }
        const outIdx = args.indexOf('-o');
        await fs.writeFile(args[outIdx + 1], sowtAiff);
        return { stdout: '', stderr: '' };
      },
    });
    expect(macAiffFallback?.engine).toBe('macos-say');
    expect(macAiffFallback?.audioBuffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(macAiffFallback?.audioBuffer.readInt16LE(44)).toBe(500);

    // 3. Linux espeak-ng fallback to espeak
    const linuxEspeak = await synthesizeSystemSpeechWav({
      text: 'Testing Linux espeak fallback.',
      voiceId: 'mock-bella',
      platform: 'linux',
      execFileFn: async (bin, args) => {
        if (bin === 'espeak-ng') {
          throw new Error('ENOENT');
        }
        expect(bin).toBe('espeak');
        const outIdx = args.indexOf('-w');
        await fs.writeFile(args[outIdx + 1], validWav);
        return { stdout: '', stderr: '' };
      },
    });
    expect(linuxEspeak?.engine).toBe('espeak');

    // 4. Minimal container with no speech binary returns null (never sine-wave bleeps)
    const missingBin = await synthesizeSystemSpeechWav({
      text: 'No binary available.',
      voiceId: 'mock-rachel',
      platform: 'linux',
      execFileFn: async () => {
        throw new Error('ENOENT');
      },
    });
    expect(missingBin).toBeNull();
  });

  it('returns structured browser-speech-synthesis fallback instead of sine-wave bleeps when no binary or API key exists', async () => {
    const res = await synthesizeElevenLabsSpeech({
      voiceId: 'mock-adam',
      text: 'Spoken narration text.',
      platform: 'linux',
      execFileFn: async () => {
        throw new Error('ENOENT');
      },
    });
    expect(res.kind).toBe('speech-synthesis');
    if (res.kind === 'speech-synthesis') {
      expect(res.fallback.mode).toBe('browser-speech-synthesis');
      expect(res.fallback.text).toBe('Spoken narration text.');
      expect(res.fallback.speechConfig.preferredVoices[0]).toBe('Daniel');
    }
  });

  it('supports direct recorded-clip playback mode on native cloned voices and per-scene routing', async () => {
    const appDir = path.join(tmpDir, 'direct-clip-app');
    const created = createApp({ dataDir: appDir });
    await created.store.ensureInitialized();

    const pcm = Buffer.alloc(128, 0x2a);
    const realRecordedWav = Buffer.concat([createPcmWavHeader(pcm.length, 22050), pcm]);

    const cloneRes = await request(created.app)
      .post('/api/voices/clone')
      .field('name', 'My Recorded Mic Voice')
      .field('tone', 'Warm & Articulate')
      .field('pitch', 'medium')
      .field('warmth', '78')
      .field('cadence', 'conversational')
      .field('playbackMode', 'direct-sample')
      .attach('sample', realRecordedWav, {
        filename: 'my-voice.wav',
        contentType: 'audio/wav',
      })
      .expect(201);

    const voiceId = cloneRes.body.voice.voice_id as string;
    expect(cloneRes.body.voice.playbackMode).toBe('direct-sample');

    const projList = await request(created.app).get('/api/projects').expect(200);
    const project = projList.body.projects[0];
    const sceneId = project.scenes[0].id as string;

    // Assign cloned voice to scene 1 and request TTS -> serves the recorded clip directly
    await request(created.app)
      .patch(`/api/projects/${project.id}/scenes/${sceneId}`)
      .send({ voiceId })
      .expect(200);

    const directTts = await request(created.app)
      .post('/api/tts')
      .send({
        voiceId,
        text: project.scenes[0].narration,
        projectId: project.id,
        sceneId,
      })
      .expect(200);

    expect(directTts.headers['x-voice-source']).toBe('native');
    expect(directTts.headers['x-voice-synthesis-mode']).toBe('direct-sample');
    expect(directTts.headers['content-type']).toContain('audio/wav');
    expect(Buffer.from(directTts.body)).toEqual(realRecordedWav);

    // Override per-scene mode back to speak-script -> uses speech synthesis / fallback instead of clip
    await request(created.app)
      .patch(`/api/projects/${project.id}/scenes/${sceneId}`)
      .send({ voicePlaybackMode: 'speak-script' })
      .expect(200);

    const scriptTts = await request(created.app)
      .post('/api/tts')
      .send({
        voiceId,
        text: project.scenes[0].narration,
        projectId: project.id,
        sceneId,
      })
      .expect(200);

    expect(scriptTts.headers['x-voice-synthesis-mode']).not.toBe('direct-sample');

    // PATCH /api/voices/:id toggles voice-level playbackMode
    const patchVoice = await request(created.app)
      .patch(`/api/voices/${voiceId}`)
      .send({ playbackMode: 'speak-script' })
      .expect(200);
    expect(patchVoice.body.voice.playbackMode).toBe('speak-script');
  });
});
