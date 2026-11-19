import crypto from 'node:crypto';
import type {
  AudienceLevel,
  CameraMotionPreset,
  ChapterItem,
  CharacterPlacement,
  CharacterProfile,
  CinematicStyle,
  ExplainerProject,
  MusicTrack,
  SceneItem,
  SceneVisualOverlay,
  TechAsset,
  TransitionType,
} from '../../shared/types.js';
import { PRESET_CHARACTERS } from './characterService.js';
import { retrieveRagContext } from './ragContext.js';

const CAMERA_MOTIONS: CameraMotionPreset[] = [
  'Slow Dolly In',
  'Orbital Pan',
  'Crane Pullback',
  'Rack Focus',
  'Handheld Micro',
  'Static Tripod',
];

const TRANSITIONS: TransitionType[] = [
  'Cross Dissolve',
  'Match Cut',
  'Whip Pan',
  'Iris Wipe',
  'Glitch Cut',
];

const OVERLAYS: SceneVisualOverlay[] = [
  'architecture-flow',
  'neural-graph',
  'packet-stream',
  'code-terminal',
  'wave-spectrum',
];

const PLACEMENTS: CharacterPlacement[] = ['left', 'right', 'center', 'split', 'offscreen'];

interface ChapterTemplate {
  phase: string;
  focus: string;
  overlay: SceneVisualOverlay;
  style: CinematicStyle;
}

const CHAPTER_TEMPLATES: ChapterTemplate[] = [
  {
    phase: 'The Core Intuition',
    focus: 'why this problem matters and the mental model behind',
    overlay: 'architecture-flow',
    style: 'Anamorphic Studio',
  },
  {
    phase: 'Under the Hood',
    focus: 'the internal building blocks, state transitions, and mechanics of',
    overlay: 'neural-graph',
    style: 'Neon Lab',
  },
  {
    phase: 'Data & Control Flow',
    focus: 'how requests, tensors, or packets actually travel through',
    overlay: 'packet-stream',
    style: 'Blueprint Isometric',
  },
  {
    phase: 'Implementation Walkthrough',
    focus: 'concrete interfaces, invariants, and real-world code patterns for',
    overlay: 'code-terminal',
    style: 'Editorial Documentary',
  },
  {
    phase: 'Bottlenecks & Failure Modes',
    focus: 'latency cliffs, edge cases, and subtle pitfalls when scaling',
    overlay: 'wave-spectrum',
    style: 'Quantum Noir',
  },
  {
    phase: 'Optimization & Tradeoffs',
    focus: 'throughput vs. accuracy tradeoffs and engineering levers inside',
    overlay: 'architecture-flow',
    style: 'Neon Lab',
  },
  {
    phase: 'Production Architecture',
    focus: 'observability, reliability guardrails, and deployment topology for',
    overlay: 'packet-stream',
    style: 'Blueprint Isometric',
  },
  {
    phase: 'Real-World Benchmarks',
    focus: 'measurable latency, memory footprint, and cost impact of',
    overlay: 'wave-spectrum',
    style: 'Editorial Documentary',
  },
  {
    phase: 'Future Trajectory',
    focus: 'emerging standards and next-generation architectures shaping',
    overlay: 'neural-graph',
    style: 'Quantum Noir',
  },
  {
    phase: 'Key Takeaways & Recap',
    focus: 'a crisp visual synthesis and actionable checklist for',
    overlay: 'architecture-flow',
    style: 'Anamorphic Studio',
  },
];

export function computeChapterAndScenePlan(durationMinutes: number): {
  chapterCount: number;
  scenesPerChapter: number;
} {
  const clamped = Math.max(1, Math.min(30, Math.round(durationMinutes)));
  if (clamped === 1) return { chapterCount: 2, scenesPerChapter: 2 };
  if (clamped <= 3) return { chapterCount: 3, scenesPerChapter: 2 };
  if (clamped <= 6) return { chapterCount: 4, scenesPerChapter: 2 };
  if (clamped <= 12) return { chapterCount: 6, scenesPerChapter: 2 };
  if (clamped <= 20) return { chapterCount: 8, scenesPerChapter: 2 };
  return { chapterCount: 10, scenesPerChapter: 2 };
}

function buildAudienceTone(audience: AudienceLevel): {
  hook: string;
  depthClause: string;
  pacingLabel: string;
} {
  switch (audience) {
    case 'beginner':
      return {
        hook: 'Think of this like a high-speed air traffic control tower coordinating thousands of signals in real time.',
        depthClause: 'without drowning in jargon, focusing on clear everyday analogies and visual cause-and-effect.',
        pacingLabel: 'accessible intuition',
      };
    case 'executive':
      return {
        hook: 'Every architectural choice here directly drives unit economics, latency SLAs, and engineering velocity.',
        depthClause: 'highlighting strategic leverage, risk mitigation, and system-level ROI.',
        pacingLabel: 'executive clarity',
      };
    case 'engineering':
    default:
      return {
        hook: 'Let us trace the exact execution path from memory layout and protocol framing down to runtime scheduling.',
        depthClause: 'examining concrete invariants, complexity bounds, and production failure modes.',
        pacingLabel: 'systems deep dive',
      };
  }
}

export function generateExplainerProject(params: {
  topic: string;
  durationMinutes: number;
  audience?: AudienceLevel;
  title?: string;
  primaryVoiceId?: string;
  characters?: CharacterProfile[];
  assets?: TechAsset[];
  preferredAssetIds?: string[];
}): ExplainerProject {
  const topic = params.topic.trim() || 'How Transformer Attention Powers Modern AI';
  const durationMinutes = Math.max(1, Math.min(30, Math.round(params.durationMinutes || 5)));
  const audience: AudienceLevel = params.audience || 'engineering';
  const explicitVoice = params.primaryVoiceId?.trim();
  const primaryVoiceId = explicitVoice || 'mock-rachel';
  const characters =
    params.characters && params.characters.length > 0
      ? params.characters
      : PRESET_CHARACTERS.map((c) => ({ ...c, traits: { ...c.traits } }));

  const totalTargetSec = durationMinutes * 60;
  const { chapterCount, scenesPerChapter } = computeChapterAndScenePlan(durationMinutes);
  const totalScenes = chapterCount * scenesPerChapter;
  const baseSceneSec = Math.floor(totalTargetSec / totalScenes);
  const remainderSec = totalTargetSec - baseSceneSec * totalScenes;

  const tone = buildAudienceTone(audience);
  const chapters: ChapterItem[] = [];
  const scenes: SceneItem[] = [];

  let sceneIdx = 0;
  for (let c = 0; c < chapterCount; c++) {
    const template = CHAPTER_TEMPLATES[c % CHAPTER_TEMPLATES.length];
    const chapterId = `chap-${c + 1}-${crypto.randomUUID().slice(0, 6)}`;
    const chapterScenes: SceneItem[] = [];

    for (let s = 0; s < scenesPerChapter; s++) {
      const durationSec = baseSceneSec + (sceneIdx < remainderSec ? 1 : 0);
      const character = characters[sceneIdx % characters.length];
      const cameraMotion = CAMERA_MOTIONS[sceneIdx % CAMERA_MOTIONS.length];
      const transitionIn = sceneIdx === 0 ? 'Cross Dissolve' : TRANSITIONS[sceneIdx % TRANSITIONS.length];
      const placement = PLACEMENTS[sceneIdx % PLACEMENTS.length];
      const overlay = s === 0 ? template.overlay : OVERLAYS[(sceneIdx + 2) % OVERLAYS.length];

      const subAngle =
        s === 0
          ? `Visual Overview: ${template.phase}`
          : `Deep Dive: ${template.phase} in Action`;

      const narration =
        sceneIdx === 0
          ? `Welcome to our ${durationMinutes}-minute deep dive into ${topic}. ${tone.hook} In this opening chapter on ${template.phase}, we unpack ${template.focus} ${topic} ${tone.depthClause}`
          : `In this segment (${subAngle}), notice how ${topic} coordinates state across components. Specifically, we explore ${template.focus} ${topic} with ${tone.pacingLabel}, keeping latency predictable and abstractions clean.`;

      const ragMatches = retrieveRagContext({
        query: `${topic} ${template.phase} ${subAngle} ${narration}`,
        assets: params.assets,
        characters,
        preferredAssetIds: params.preferredAssetIds,
        limit: 2,
      });
      const matchedAssetIds = ragMatches
        .filter((m) => m.sourceType === 'asset')
        .map((m) => m.id);
      const ragVisualSuffix =
        ragMatches.length > 0
          ? ` Grounded with reference context: ${ragMatches.map((m) => `${m.name} (${m.snippet})`).join('; ')}.`
          : '';

      const scene: SceneItem = {
        id: `scene-${sceneIdx + 1}-${crypto.randomUUID().slice(0, 6)}`,
        chapterId,
        order: sceneIdx,
        title: `${c + 1}.${s + 1} ${template.phase}${s === 1 ? ' — Applied View' : ''}`,
        durationSec,
        narration,
        visualPrompt: `Cinematic ${template.style} scene illustrating "${topic}" (${template.phase}), animated ${overlay} telemetry overlay, ${cameraMotion} camera movement, crisp depth-of-field.${ragVisualSuffix}`,
        visualOverlay: overlay,
        cameraMotion,
        cinematicStyle: template.style,
        transitionIn,
        characterId: character?.id,
        characterPlacement: placement,
        voiceId: explicitVoice ? primaryVoiceId : character?.voiceId || primaryVoiceId,
        voiceStatus: 'fallback',
        higgsfield: {
          status: 'fallback',
          provider: 'canvas-fallback',
          renderNote: 'Live procedural 16:9 canvas preview ready; push to Higgsfield or Gemini Veo anytime.',
          updatedAt: new Date().toISOString(),
        },
        assetIds: matchedAssetIds,
        ragContext: ragMatches,
        keyPoints: [
          `${template.phase}: ${topic.split(' ').slice(0, 4).join(' ')}`,
          `Pacing: ~${Math.round((durationSec / 60) * 145)} spoken words (${durationSec}s)`,
          `Stage: ${cameraMotion} • ${template.style}`,
          ...(ragMatches[0] ? [`RAG Context: ${ragMatches[0].name}`] : []),
        ],
      };

      chapterScenes.push(scene);
      scenes.push(scene);
      sceneIdx++;
    }

    const chapterDuration = chapterScenes.reduce((sum, sc) => sum + sc.durationSec, 0);
    chapters.push({
      id: chapterId,
      order: c,
      title: `Chapter ${c + 1}: ${template.phase}`,
      summary: `Covers ${template.focus} ${topic}.`,
      targetDurationSec: chapterDuration,
    });
  }

  const musicTracks: MusicTrack[] = [
    {
      id: `music-${crypto.randomUUID().slice(0, 6)}`,
      title: 'Silicon Horizon (Ambient Pulse)',
      mood: 'Focused Tech Ambient',
      bpm: 108,
      startTimeSec: 0,
      durationSec: Math.min(totalTargetSec, Math.ceil(totalTargetSec * 0.6)),
      volumeDb: -16,
      duckUnderVoice: true,
      accentColor: '#10b981',
    },
    {
      id: `music-${crypto.randomUUID().slice(0, 6)}`,
      title: 'Telemetry Rising (Resolution)',
      mood: 'Inspiring Synth',
      bpm: 116,
      startTimeSec: Math.ceil(totalTargetSec * 0.6),
      durationSec: totalTargetSec - Math.ceil(totalTargetSec * 0.6),
      volumeDb: -15,
      duckUnderVoice: true,
      accentColor: '#06b6d4',
    },
  ];

  const now = new Date().toISOString();
  const projectTitle = params.title?.trim() || `${topic} — ${durationMinutes}m Explainer`;

  const snapshotState = {
    title: projectTitle,
    topic,
    audience,
    targetDurationMinutes: durationMinutes,
    primaryVoiceId,
    chapters,
    scenes,
    characters,
    musicTracks,
  };

  return {
    id: `proj-${crypto.randomUUID().slice(0, 8)}`,
    ...snapshotState,
    history: [
      {
        id: `hist-${crypto.randomUUID().slice(0, 6)}`,
        timestamp: now,
        prompt: `Generate ${durationMinutes}-minute ${audience} explainer on "${topic}"`,
        summary: `Created ${chapters.length} chapters and ${scenes.length} cinematic scenes (${totalTargetSec}s total).`,
        actions: [
          `Structured ${chapters.length} chapters for ${durationMinutes}m target duration`,
          `Generated ${scenes.length} scenes with Higgsfield camera presets & character staging`,
          `Added ${musicTracks.length} adaptive soundtrack beds`,
        ],
        projectState: structuredClone(snapshotState),
      },
    ],
    redoStack: [],
    createdAt: now,
    updatedAt: now,
  };
}
