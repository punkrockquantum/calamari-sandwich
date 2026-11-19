import crypto from 'node:crypto';
import type {
  AudienceLevel,
  CameraMotionPreset,
  ChapterItem,
  CharacterPlacement,
  CharacterProfile,
  CinematicStyle,
  ExplainerProject,
  ImportedSource,
  ImportedSourceSlide,
  MusicTrack,
  SceneAnimationPreset,
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

const STYLES: CinematicStyle[] = [
  'Anamorphic Studio',
  'Neon Lab',
  'Blueprint Isometric',
  'Editorial Documentary',
  'Quantum Noir',
];

const PLACEMENTS: CharacterPlacement[] = ['left', 'right', 'center', 'split', 'offscreen'];

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

function inferVisualOverlay(text: string, idx: number): SceneVisualOverlay {
  const lower = text.toLowerCase();
  if (/\b(code|api|sdk|function|syntax|script|cli|terminal|sql|query)\b/.test(lower)) {
    return 'code-terminal';
  }
  if (/\b(packet|network|http|tcp|quic|stream|kafka|queue|route|mesh|latency)\b/.test(lower)) {
    return 'packet-stream';
  }
  if (/\b(audio|voice|signal|spectrum|wave|frequency|metric|benchmark|pulse)\b/.test(lower)) {
    return 'wave-spectrum';
  }
  if (/\b(neural|graph|token|attention|embedding|agent|model|cluster|node)\b/.test(lower)) {
    return 'neural-graph';
  }
  const fallback: SceneVisualOverlay[] = [
    'architecture-flow',
    'neural-graph',
    'packet-stream',
    'code-terminal',
    'wave-spectrum',
  ];
  return fallback[idx % fallback.length];
}

export function inferAnimationPreset(
  text: string,
  hasSlideImage: boolean,
  idx: number
): SceneAnimationPreset {
  if (hasSlideImage) return 'slide-deck-reveal';
  const lower = text.toLowerCase();
  if (/\b(vs\.?|versus|compare|comparison|tradeoff|difference|contrast)\b/.test(lower)) {
    return 'split-comparison';
  }
  if (/\b(timeline|history|step|phase|milestone|evolution|roadmap|sequence)\b/.test(lower)) {
    return 'timeline-walkthrough';
  }
  if (/\b(\d+%|\d+ms|metric|benchmark|telemetry|throughput|signal|pulse|latency)\b/.test(lower)) {
    return 'data-pulse';
  }
  if (/\b(network|mesh|graph|distributed|cluster|node|particle|swarm)\b/.test(lower)) {
    return 'particle-network';
  }
  if (/\b(architecture|pipeline|flow|diagram|workflow|protocol|engine)\b/.test(lower)) {
    return 'diagram-flow';
  }
  const rotation: SceneAnimationPreset[] = [
    'diagram-flow',
    'kinetic-cards',
    'timeline-walkthrough',
    'data-pulse',
    'particle-network',
  ];
  return rotation[idx % rotation.length];
}

interface PromptConcept {
  label: string;
  angle: string;
  focus: string;
}

function extractPromptConcepts(topic: string, totalScenes: number): PromptConcept[] {
  const cleanTopic = topic.replace(/\s+/g, ' ').trim();
  const vsMatch = cleanTopic.match(/^(.+?)\s+(?:vs\.?|versus)\s+(.+?)(?:\s+(?:for|in|across|on)\s+(.+))?$/i);
  const commaParts = cleanTopic
    .split(/[,;•\n]+|\band\b/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3 && p.length <= 72);

  const extractedTerms: string[] = [];
  if (vsMatch) {
    extractedTerms.push(vsMatch[1].trim(), vsMatch[2].trim());
    if (vsMatch[3]) extractedTerms.push(vsMatch[3].trim());
  }
  for (const part of commaParts) {
    if (!extractedTerms.some((t) => t.toLowerCase() === part.toLowerCase())) {
      extractedTerms.push(part);
    }
  }

  const concepts: PromptConcept[] = [];
  if (vsMatch) {
    const left = vsMatch[1].trim();
    const right = vsMatch[2].trim();
    const context = vsMatch[3]?.trim();
    concepts.push({
      label: `Overview: ${left} vs ${right}`,
      angle: `Comparing ${left} and ${right}${context ? ` for ${context}` : ''}`,
      focus: `what separates ${left} from ${right}`,
    });
    concepts.push({
      label: `${left} Mechanics`,
      angle: `How ${left} works directly`,
      focus: `the core behavior and design of ${left}`,
    });
    concepts.push({
      label: `${right} Mechanics`,
      angle: `How ${right} operates in practice`,
      focus: `the strengths and execution model of ${right}`,
    });
    concepts.push({
      label: `Tradeoffs & Decision Guide`,
      angle: `Choosing between ${left} and ${right}`,
      focus: `when to pick ${left} versus ${right}${context ? ` in ${context}` : ''}`,
    });
  }

  // Add extracted sub-clauses as direct prompt concepts
  for (const term of extractedTerms) {
    if (concepts.some((c) => c.label.toLowerCase().includes(term.toLowerCase()))) continue;
    concepts.push({
      label: term,
      angle: `Focused breakdown of ${term}`,
      focus: `how ${term} contributes to ${cleanTopic}`,
    });
  }

  // Expand cleanly using topic-anchored angles without generic unrelated jargon
  const topicAngles = [
    {
      label: `${cleanTopic}: Core Problem & Goal`,
      angle: `Introducing ${cleanTopic}`,
      focus: `the exact problem ${cleanTopic} solves and how its primary components fit together`,
    },
    {
      label: `${cleanTopic}: Step-by-Step Execution`,
      angle: `Tracing ${cleanTopic} step by step`,
      focus: `each stage in ${cleanTopic} from initial input to final output`,
    },
    {
      label: `${cleanTopic}: Key Components & Interactions`,
      angle: `Inspecting the moving parts of ${cleanTopic}`,
      focus: `how the distinct building blocks of ${cleanTopic} exchange data and coordinate`,
    },
    {
      label: `${cleanTopic}: Practical Constraints & Edge Cases`,
      angle: `Handling real constraints in ${cleanTopic}`,
      focus: `where ${cleanTopic} excels, what limits it, and how teams tune it`,
    },
    {
      label: `${cleanTopic}: Applied Walkthrough`,
      angle: `Seeing ${cleanTopic} in action`,
      focus: `a concrete end-to-end example demonstrating ${cleanTopic}`,
    },
    {
      label: `${cleanTopic}: Summary & Actionable Takeaways`,
      angle: `Recap of ${cleanTopic}`,
      focus: `the essential takeaways to apply ${cleanTopic} immediately`,
    },
  ];

  for (const ta of topicAngles) {
    if (concepts.length >= totalScenes) break;
    concepts.push(ta);
  }

  while (concepts.length < totalScenes) {
    const idx = concepts.length + 1;
    concepts.push({
      label: `${cleanTopic} — Part ${idx}`,
      angle: `Deepening ${cleanTopic} (Part ${idx})`,
      focus: `further practical details of ${cleanTopic}`,
    });
  }

  return concepts.slice(0, totalScenes);
}

function buildAudienceFraming(audience: AudienceLevel, topic: string): {
  intro: string;
  styleNote: string;
} {
  switch (audience) {
    case 'beginner':
      return {
        intro: `Let us break down ${topic} clearly from first principles using direct visual intuition.`,
        styleNote: 'Keep terminology plain, concrete, and grounded in visual cause-and-effect.',
      };
    case 'executive':
      return {
        intro: `Here is a focused briefing on ${topic}, highlighting operational leverage, tradeoffs, and measurable outcomes.`,
        styleNote: 'Emphasize strategic impact, decision criteria, and system-wide economics.',
      };
    case 'engineering':
    default:
      return {
        intro: `Let us walk directly through ${topic}, examining how its components, interfaces, and execution steps fit together.`,
        styleNote: 'Highlight exact mechanisms, component boundaries, and practical engineering tradeoffs.',
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
  sources?: ImportedSource[];
}): ExplainerProject {
  const sources = params.sources || [];
  const sourceSlides: Array<{ source: ImportedSource; slide: ImportedSourceSlide }> = [];
  for (const src of sources) {
    for (const slide of src.slides) {
      sourceSlides.push({ source: src, slide });
    }
  }

  const defaultTopicFromSource =
    sources.length > 0 ? sources.map((s) => s.name).join(' + ') : '';
  const topic =
    params.topic.trim() ||
    defaultTopicFromSource ||
    'How Transformer Attention Powers Modern AI';
  const durationMinutes = Math.max(1, Math.min(30, Math.round(params.durationMinutes || 5)));
  const audience: AudienceLevel = params.audience || 'engineering';
  const explicitVoice = params.primaryVoiceId?.trim();
  const primaryVoiceId = explicitVoice || 'mock-rachel';
  const characters =
    params.characters && params.characters.length > 0
      ? params.characters
      : PRESET_CHARACTERS.map((c) => ({ ...c, traits: { ...c.traits } }));

  const totalTargetSec = durationMinutes * 60;
  const audienceFraming = buildAudienceFraming(audience, topic);

  let chapterCount: number;
  let sceneAssignments: Array<{
    chapterIdx: number;
    title: string;
    narration: string;
    keyPoints: string[];
    visualPrompt: string;
    slideImageUrls: string[];
    sourceId?: string;
    sourceSlideIndex?: number;
    sourceAssetIds: string[];
  }> = [];

  if (sourceSlides.length > 0) {
    // 1-to-1 source-exact scene mapping preserving slide/section order
    const targetChapters = Math.min(
      Math.max(1, Math.ceil(sourceSlides.length / 2)),
      10
    );
    chapterCount = targetChapters;

    sceneAssignments = sourceSlides.map((entry, idx) => {
      const { source, slide } = entry;
      const chapterIdx = Math.min(
        chapterCount - 1,
        Math.floor((idx * chapterCount) / sourceSlides.length)
      );
      const cleanTitle = slide.title.trim() || `Slide ${slide.index}`;
      const bullets = slide.bullets.filter(Boolean).slice(0, 4);

      const narrationParts: string[] = [];
      if (idx === 0) {
        narrationParts.push(
          `In this walkthrough of ${topic}, we start with ${cleanTitle}.`
        );
      }
      if (slide.speakerNotes && slide.speakerNotes.trim().length > 0) {
        narrationParts.push(slide.speakerNotes.trim());
      } else if (bullets.length > 0) {
        narrationParts.push(
          `${cleanTitle} covers ${bullets.join('; ')}.`
        );
      } else {
        narrationParts.push(slide.rawText.slice(0, 320));
      }

      const keyPoints =
        bullets.length > 0
          ? bullets.slice(0, 3)
          : [
              cleanTitle,
              ...(slide.speakerNotes
                ? [slide.speakerNotes.split(/[.!?]/)[0].trim().slice(0, 80)]
                : []),
            ].filter(Boolean);

      const matchedSourceAssets = (params.assets || [])
        .filter((a) => a.mediaUrls.some((u) => slide.imageUrls.includes(u)))
        .map((a) => a.id);

      const visualPrompt = [
        `${cleanTitle} (${source.sourceType === 'pptx' ? `Slide ${slide.index}` : source.name})`,
        bullets.length > 0 ? `Key elements: ${bullets.join(', ')}` : '',
        `Topic context: ${topic}. ${audienceFraming.styleNote}`,
      ]
        .filter(Boolean)
        .join('. ');

      return {
        chapterIdx,
        title: cleanTitle,
        narration: narrationParts.join(' '),
        keyPoints,
        visualPrompt,
        slideImageUrls: slide.imageUrls,
        sourceId: source.id,
        sourceSlideIndex: slide.index,
        sourceAssetIds: matchedSourceAssets,
      };
    });
  } else {
    const plan = computeChapterAndScenePlan(durationMinutes);
    chapterCount = plan.chapterCount;
    const totalScenes = plan.chapterCount * plan.scenesPerChapter;
    const concepts = extractPromptConcepts(topic, totalScenes);

    sceneAssignments = concepts.map((concept, idx) => {
      const chapterIdx = Math.floor(idx / plan.scenesPerChapter);
      const isOpening = idx === 0;
      const narration = isOpening
        ? `${audienceFraming.intro} First, we focus on ${concept.label}, exploring ${concept.focus}.`
        : `Moving to ${concept.label}: here we examine ${concept.focus}. Notice how every piece ties directly back to ${topic}.`;

      const keyPoints = [
        concept.label,
        concept.angle,
        `Applies directly to ${topic.split(/\s+/).slice(0, 6).join(' ')}`,
      ];

      const visualPrompt = `Visual scene illustrating "${concept.label}" for "${topic}" — ${concept.focus}. ${audienceFraming.styleNote}`;

      return {
        chapterIdx,
        title: concept.label,
        narration,
        keyPoints,
        visualPrompt,
        slideImageUrls: [],
        sourceAssetIds: [],
      };
    });
  }

  const totalScenes = sceneAssignments.length;
  const baseSceneSec = Math.floor(totalTargetSec / totalScenes);
  const remainderSec = totalTargetSec - baseSceneSec * totalScenes;

  const chapters: ChapterItem[] = [];
  const scenes: SceneItem[] = [];

  for (let c = 0; c < chapterCount; c++) {
    const chapterId = `chap-${c + 1}-${crypto.randomUUID().slice(0, 6)}`;
    const groupIndices = sceneAssignments
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.chapterIdx === c);

    const chapterScenes: SceneItem[] = [];

    groupIndices.forEach(({ item, idx: sceneIdx }, localIdx) => {
      const durationSec = baseSceneSec + (sceneIdx < remainderSec ? 1 : 0);
      const character = characters[sceneIdx % characters.length];
      const cameraMotion = CAMERA_MOTIONS[sceneIdx % CAMERA_MOTIONS.length];
      const transitionIn =
        sceneIdx === 0 ? 'Cross Dissolve' : TRANSITIONS[sceneIdx % TRANSITIONS.length];
      const placement = PLACEMENTS[sceneIdx % PLACEMENTS.length];
      const overlay = inferVisualOverlay(`${item.title} ${item.narration}`, sceneIdx);
      const cinematicStyle = STYLES[c % STYLES.length];
      const animationPreset = inferAnimationPreset(
        `${item.title} ${item.visualPrompt} ${item.keyPoints.join(' ')}`,
        item.slideImageUrls.length > 0,
        sceneIdx
      );

      const ragMatches = retrieveRagContext({
        query: `${topic} ${item.title} ${item.narration}`,
        assets: params.assets,
        characters,
        preferredAssetIds: [
          ...item.sourceAssetIds,
          ...(params.preferredAssetIds || []),
        ],
        limit: 2,
      });

      const matchedAssetIds = Array.from(
        new Set([
          ...item.sourceAssetIds,
          ...ragMatches.filter((m) => m.sourceType === 'asset').map((m) => m.id),
        ])
      );

      const ragVisualSuffix =
        ragMatches.length > 0
          ? ` Reference visual: ${ragMatches.map((m) => `${m.name} (${m.snippet})`).join('; ')}.`
          : '';

      const scene: SceneItem = {
        id: `scene-${sceneIdx + 1}-${crypto.randomUUID().slice(0, 6)}`,
        chapterId,
        order: sceneIdx,
        title: `${c + 1}.${localIdx + 1} ${item.title}`,
        durationSec,
        narration: item.narration,
        visualPrompt: `${item.visualPrompt}${ragVisualSuffix}`,
        visualOverlay: overlay,
        animationPreset,
        sourceId: item.sourceId,
        sourceSlideIndex: item.sourceSlideIndex,
        cameraMotion,
        cinematicStyle,
        transitionIn,
        characterId: character?.id,
        characterPlacement: placement,
        voiceId: explicitVoice ? primaryVoiceId : character?.voiceId || primaryVoiceId,
        voiceStatus: 'fallback',
        higgsfield: {
          status: 'fallback',
          provider: 'canvas-fallback',
          renderNote: `Live 60fps ${animationPreset} canvas ready; push to Higgsfield or Gemini Veo anytime.`,
          updatedAt: new Date().toISOString(),
        },
        assetIds: matchedAssetIds,
        ragContext: ragMatches,
        keyPoints: item.keyPoints,
      };

      chapterScenes.push(scene);
      scenes.push(scene);
    });

    const chapterDuration = chapterScenes.reduce((sum, sc) => sum + sc.durationSec, 0);
    const firstTitle = groupIndices[0]?.item.title || `${topic} Part ${c + 1}`;
    chapters.push({
      id: chapterId,
      order: c,
      title: `Chapter ${c + 1}: ${firstTitle.slice(0, 48)}`,
      summary: chapterScenes.map((s) => s.title).join(' • '),
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
    sourceIds: sources.map((s) => s.id),
  };

  return {
    id: `proj-${crypto.randomUUID().slice(0, 8)}`,
    ...snapshotState,
    history: [
      {
        id: `hist-${crypto.randomUUID().slice(0, 6)}`,
        timestamp: now,
        prompt: `Generate ${durationMinutes}-minute ${audience} explainer on "${topic}"`,
        summary: `Created ${chapters.length} chapters and ${scenes.length} prompt-exact scenes (${totalTargetSec}s total).`,
        actions: [
          `Structured ${chapters.length} chapters for ${durationMinutes}m target duration`,
          `Generated ${scenes.length} scenes mapped directly to ${sources.length > 0 ? `${sources.length} imported source(s)` : `"${topic}"`}`,
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
