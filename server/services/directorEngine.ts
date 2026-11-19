import crypto from 'node:crypto';
import type {
  CameraMotionPreset,
  CharacterPlacement,
  CinematicStyle,
  DirectorPromptResult,
  ExplainerProject,
  IterationSnapshot,
  MusicTrack,
  ProjectStateSnapshot,
  SceneItem,
  TransitionType,
} from '../../shared/types.js';
import { buildClonedCharacter } from './characterService.js';
import { generateExplainerProject } from './scriptGenerator.js';

export function extractProjectSnapshot(project: ExplainerProject): ProjectStateSnapshot {
  return structuredClone({
    title: project.title,
    topic: project.topic,
    audience: project.audience,
    targetDurationMinutes: project.targetDurationMinutes,
    primaryVoiceId: project.primaryVoiceId,
    chapters: project.chapters,
    scenes: project.scenes,
    characters: project.characters,
    musicTracks: project.musicTracks,
  });
}

function applySnapshotState(
  project: ExplainerProject,
  snapshotState: ProjectStateSnapshot
): ExplainerProject {
  const cloned = structuredClone(snapshotState);
  return {
    ...project,
    ...cloned,
    updatedAt: new Date().toISOString(),
  };
}

function matchCameraMotion(prompt: string): CameraMotionPreset | undefined {
  const p = prompt.toLowerCase();
  if (p.includes('dolly')) return 'Slow Dolly In';
  if (p.includes('orbital') || p.includes('orbit')) return 'Orbital Pan';
  if (p.includes('crane') || p.includes('pullback')) return 'Crane Pullback';
  if (p.includes('handheld')) return 'Handheld Micro';
  if (p.includes('rack focus') || p.includes('focus')) return 'Rack Focus';
  if (p.includes('static') || p.includes('tripod')) return 'Static Tripod';
  return undefined;
}

function matchCinematicStyle(prompt: string): CinematicStyle | undefined {
  const p = prompt.toLowerCase();
  if (p.includes('neon') || p.includes('cyberpunk')) return 'Neon Lab';
  if (p.includes('anamorphic') || p.includes('studio')) return 'Anamorphic Studio';
  if (p.includes('blueprint') || p.includes('isometric')) return 'Blueprint Isometric';
  if (p.includes('documentary') || p.includes('editorial')) return 'Editorial Documentary';
  if (p.includes('quantum') || p.includes('noir') || p.includes('dark')) return 'Quantum Noir';
  return undefined;
}

function matchTransition(prompt: string): TransitionType | undefined {
  const p = prompt.toLowerCase();
  if (p.includes('whip pan') || p.includes('whip')) return 'Whip Pan';
  if (p.includes('glitch')) return 'Glitch Cut';
  if (p.includes('iris')) return 'Iris Wipe';
  if (p.includes('match cut') || p.includes('match')) return 'Match Cut';
  if (p.includes('dissolve') || p.includes('fade')) return 'Cross Dissolve';
  return undefined;
}

function matchPlacement(prompt: string): CharacterPlacement | undefined {
  const p = prompt.toLowerCase();
  if (p.includes('left')) return 'left';
  if (p.includes('right')) return 'right';
  if (p.includes('center') || p.includes('centre')) return 'center';
  if (p.includes('split')) return 'split';
  if (p.includes('offscreen') || p.includes('voiceover only')) return 'offscreen';
  return undefined;
}

function extractQuotedText(prompt: string): string | undefined {
  const match = prompt.match(/["']([^"']{2,120})["']/);
  return match?.[1]?.trim();
}

function extractTargetSceneIndex(prompt: string, totalScenes: number): number | undefined {
  const match = prompt.match(/scene\s*#?(\d+)/i);
  if (!match) return undefined;
  const idx = Number.parseInt(match[1], 10) - 1;
  if (idx >= 0 && idx < totalScenes) return idx;
  return undefined;
}

export function applyDirectorPrompt(
  project: ExplainerProject,
  rawPrompt: string
): DirectorPromptResult {
  const prompt = rawPrompt.trim();
  if (!prompt) {
    throw new Error('Director prompt cannot be empty.');
  }

  const lower = prompt.toLowerCase();
  const next = structuredClone(project);
  const actions: string[] = [];

  // 1. Duration change (2-30 min)
  const durationMatch = lower.match(/(?:duration|make it|set.*to|expand to|trim to)\s*(\d+)\s*(?:min|minute|minutes|m\b)/i);
  if (durationMatch) {
    const requestedMin = Math.max(2, Math.min(30, Number.parseInt(durationMatch[1], 10)));
    const regenerated = generateExplainerProject({
      topic: next.topic,
      durationMinutes: requestedMin,
      audience: next.audience,
      title: `${next.topic} — ${requestedMin}m Explainer`,
      primaryVoiceId: next.primaryVoiceId,
      characters: next.characters,
    });
    next.targetDurationMinutes = requestedMin;
    next.title = regenerated.title;
    next.chapters = regenerated.chapters;
    next.scenes = regenerated.scenes;
    next.musicTracks = regenerated.musicTracks;
    actions.push(`Re-paced explainer to ${requestedMin} minutes (${next.chapters.length} chapters, ${next.scenes.length} scenes)`);
  }

  // 2. Add new character
  if (
    /\b(add|create|clone|introduce)\b.*\b(character|host|narrator|avatar|presenter)\b/i.test(lower)
  ) {
    const quotedName = extractQuotedText(prompt);
    const namedMatch = prompt.match(/(?:character|host|presenter|named|called)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/);
    const charName = quotedName || namedMatch?.[1] || `Studio Host ${next.characters.length + 1}`;
    const style =
      lower.includes('cyberpunk') || lower.includes('neon')
        ? 'Cyberpunk Architect'
        : lower.includes('educator')
          ? 'Studio Educator'
          : lower.includes('quantum')
            ? 'Quantum Minimalist'
            : 'Tech Founder';

    const newChar = buildClonedCharacter({
      name: charName,
      role: lower.includes('engineer')
        ? 'Staff ML Engineer'
        : lower.includes('architect')
          ? 'Cloud Architect'
          : 'Featured Explainer Host',
      sourceType: 'preset',
      mediaUrls: [],
      stylePreset: style,
      voiceId: next.primaryVoiceId,
    });

    next.characters.push(newChar);
    const targetIdx = extractTargetSceneIndex(prompt, next.scenes.length);
    if (targetIdx !== undefined) {
      next.scenes[targetIdx].characterId = newChar.id;
      const placement = matchPlacement(prompt);
      if (placement) next.scenes[targetIdx].characterPlacement = placement;
    } else if (next.scenes.length > 0) {
      const last = next.scenes[next.scenes.length - 1];
      last.characterId = newChar.id;
      const placement = matchPlacement(prompt);
      if (placement) last.characterPlacement = placement;
    }
    actions.push(`Added character "${newChar.name}" (${style}) and assigned to stage`);
  }

  // 3. Add music / soundtrack track
  if (/\b(music|soundtrack|score|beat|audio track|synthwave|ambient)\b/i.test(lower)) {
    const quotedTitle = extractQuotedText(prompt);
    const dbMatch = lower.match(/(-\d+)\s*db/i);
    const bpmMatch = lower.match(/(\d{2,3})\s*bpm/i);
    const totalTimelineSec = next.scenes.reduce((s, sc) => s + sc.durationSec, 0);
    const existingEnd = next.musicTracks.reduce(
      (max, m) => Math.max(max, m.startTimeSec + m.durationSec),
      0
    );
    const startSec = existingEnd >= totalTimelineSec ? 0 : existingEnd;
    const durationSec = Math.max(20, totalTimelineSec - startSec);

    const newTrack: MusicTrack = {
      id: `music-${crypto.randomUUID().slice(0, 6)}`,
      title: quotedTitle || (lower.includes('synth') ? 'Midnight Synthwave Bed' : 'Cinematic Focus Pulse'),
      mood: lower.includes('upbeat')
        ? 'Upbeat Electronic'
        : lower.includes('minimal')
          ? 'Minimalist Pluck'
          : 'Ambient Tech Score',
      bpm: bpmMatch ? Math.min(180, Math.max(60, Number.parseInt(bpmMatch[1], 10))) : 112,
      startTimeSec: startSec,
      durationSec,
      volumeDb: dbMatch ? Number.parseInt(dbMatch[1], 10) : -14,
      duckUnderVoice: !lower.includes('no duck'),
      accentColor: '#a855f7',
    };
    next.musicTracks.push(newTrack);
    actions.push(`Added soundtrack "${newTrack.title}" (${newTrack.bpm} BPM, ${newTrack.volumeDb} dB)`);
  }

  // 4. Add a new scene
  if (/\b(add|insert|append|create)\b.*\b(scene|chapter|segment|outro|intro)\b/i.test(lower)) {
    const quotedTopic = extractQuotedText(prompt);
    const explainingMatch = prompt.match(/(?:explaining|about|on|for)\s+([^,.]+)/i);
    const sceneSubject = quotedTopic || explainingMatch?.[1]?.trim() || 'Key System Architecture Insight';
    const cameraMotion = matchCameraMotion(prompt) || 'Orbital Pan';
    const cinematicStyle = matchCinematicStyle(prompt) || 'Neon Lab';
    const transitionIn = matchTransition(prompt) || 'Match Cut';
    const placement = matchPlacement(prompt) || 'right';
    const secMatch = lower.match(/(\d+)\s*(?:s|sec|seconds)\b/i);
    const durationSec = secMatch ? Math.max(8, Math.min(180, Number.parseInt(secMatch[1], 10))) : 28;
    const lastChapter = next.chapters[next.chapters.length - 1] || {
      id: `chap-extra-${crypto.randomUUID().slice(0, 4)}`,
      order: 0,
      title: 'Chapter 1: Core Concepts',
      summary: sceneSubject,
      targetDurationSec: durationSec,
    };

    const newScene: SceneItem = {
      id: `scene-${next.scenes.length + 1}-${crypto.randomUUID().slice(0, 6)}`,
      chapterId: lastChapter.id,
      order: next.scenes.length,
      title: `${next.chapters.length}.${next.scenes.length + 1} ${sceneSubject.slice(0, 42)}`,
      durationSec,
      narration: `Let us zoom in on ${sceneSubject}. By breaking this down visually, we can immediately see how each layer transforms inputs cleanly while keeping system invariants intact.`,
      visualPrompt: `Higgsfield ${cinematicStyle} scene showcasing ${sceneSubject}, ${cameraMotion} camera move, glowing telemetry nodes, sharp 16:9 framing.`,
      visualOverlay: lower.includes('code')
        ? 'code-terminal'
        : lower.includes('packet') || lower.includes('network')
          ? 'packet-stream'
          : 'neural-graph',
      cameraMotion,
      cinematicStyle,
      transitionIn,
      characterId: next.characters[0]?.id,
      characterPlacement: placement,
      voiceId: next.primaryVoiceId,
      voiceStatus: 'fallback',
      higgsfield: {
        status: 'fallback',
        provider: 'canvas-fallback',
        renderNote: `Director-added scene (${cameraMotion} • ${cinematicStyle}).`,
        updatedAt: new Date().toISOString(),
      },
      keyPoints: [
        sceneSubject,
        `Camera: ${cameraMotion}`,
        `Style: ${cinematicStyle}`,
      ],
    };

    next.scenes.push(newScene);
    lastChapter.targetDurationSec += durationSec;
    actions.push(`Added Scene ${next.scenes.length}: "${newScene.title}" (${durationSec}s, ${cameraMotion}, ${cinematicStyle})`);
  }

  // 5. Remove scene
  if (/\b(remove|delete)\b.*\bscene\s*#?(\d+)/i.test(lower)) {
    const idx = extractTargetSceneIndex(prompt, next.scenes.length);
    if (idx !== undefined && next.scenes.length > 1) {
      const [removed] = next.scenes.splice(idx, 1);
      next.scenes.forEach((sc, i) => {
        sc.order = i;
      });
      actions.push(`Removed Scene ${idx + 1} ("${removed.title}")`);
    }
  }

  // 6. Modify existing scene or global visual/script properties
  const targetIdx = extractTargetSceneIndex(prompt, next.scenes.length);
  const cameraUpdate = matchCameraMotion(prompt);
  const styleUpdate = matchCinematicStyle(prompt);
  const transitionUpdate = matchTransition(prompt);
  const placementUpdate = matchPlacement(prompt);
  const isAddingScene = actions.some((a) => a.startsWith('Added Scene'));
  const wantsHiggsfieldRender = /\b(higgsfield|render|generate.*video|generate.*cinematic|cinematic render)\b/i.test(
    lower
  );
  const higgsfieldTargetSceneIds: string[] = [];
  if (wantsHiggsfieldRender) {
    if (isAddingScene && next.scenes.length > 0) {
      higgsfieldTargetSceneIds.push(next.scenes[next.scenes.length - 1].id);
    } else if (targetIdx !== undefined && next.scenes[targetIdx]) {
      higgsfieldTargetSceneIds.push(next.scenes[targetIdx].id);
    } else if (next.scenes[0]) {
      higgsfieldTargetSceneIds.push(next.scenes[0].id);
    }
  }

  if (!isAddingScene && (cameraUpdate || styleUpdate || transitionUpdate || placementUpdate || targetIdx !== undefined)) {
    const targets = targetIdx !== undefined ? [next.scenes[targetIdx]] : next.scenes;
    const scopeLabel = targetIdx !== undefined ? `Scene ${targetIdx + 1}` : 'all scenes';

    if (cameraUpdate) {
      targets.forEach((sc) => {
        sc.cameraMotion = cameraUpdate;
      });
      actions.push(`Updated camera motion to "${cameraUpdate}" on ${scopeLabel}`);
    }
    if (styleUpdate) {
      targets.forEach((sc) => {
        sc.cinematicStyle = styleUpdate;
      });
      actions.push(`Applied "${styleUpdate}" cinematic look to ${scopeLabel}`);
    }
    if (transitionUpdate) {
      targets.forEach((sc) => {
        sc.transitionIn = transitionUpdate;
      });
      actions.push(`Set transition to "${transitionUpdate}" on ${scopeLabel}`);
    }
    if (placementUpdate) {
      targets.forEach((sc) => {
        sc.characterPlacement = placementUpdate;
      });
      actions.push(`Positioned character "${placementUpdate}" on ${scopeLabel}`);
    }

    if (lower.includes('shorter') && targetIdx !== undefined) {
      next.scenes[targetIdx].durationSec = Math.max(8, Math.round(next.scenes[targetIdx].durationSec * 0.7));
      actions.push(`Trimmed Scene ${targetIdx + 1} duration to ${next.scenes[targetIdx].durationSec}s`);
    } else if (lower.includes('longer') && targetIdx !== undefined) {
      next.scenes[targetIdx].durationSec = Math.min(180, Math.round(next.scenes[targetIdx].durationSec * 1.35));
      actions.push(`Extended Scene ${targetIdx + 1} duration to ${next.scenes[targetIdx].durationSec}s`);
    }
  }

  // 7. Rewrite / simplify narration
  if (/\b(rewrite|simplify|simpler|analogy|punchier|technical|script|narration)\b/i.test(lower)) {
    const scopeIdx = targetIdx !== undefined ? targetIdx : 0;
    const targetScene = next.scenes[scopeIdx];
    if (targetScene) {
      if (lower.includes('analogy') || lower.includes('simpler') || lower.includes('simplify')) {
        targetScene.narration = `Picture a bustling express highway with smart lane controllers: instead of every packet waiting in one queue, ${next.topic} routes critical signals straight to the front in microseconds.`;
        actions.push(`Rewrote Scene ${scopeIdx + 1} narration with a clear everyday analogy`);
      } else if (lower.includes('technical')) {
        targetScene.narration = `Under the hood, ${next.topic} bounds tail latency via deterministic state partitioning, zero-copy buffer handoffs, and vectorized batch execution across worker threads.`;
        actions.push(`Upgraded Scene ${scopeIdx + 1} narration to deeper technical precision`);
      } else {
        targetScene.narration = `Here is the breakthrough behind ${next.topic}: ${targetScene.narration.split('.')[0]}. Watch how the pipeline locks into sync right on screen.`;
        actions.push(`Polished Scene ${scopeIdx + 1} narration pacing`);
      }
    }
  }

  // 8. Catch-all creative director pass if none of the specific rules fired
  if (actions.length === 0) {
    const focusIdx = Math.min(1, next.scenes.length - 1);
    const sc = next.scenes[focusIdx];
    if (sc) {
      sc.visualPrompt = `${sc.visualPrompt} Creative note: ${prompt}`;
      sc.narration = `${sc.narration} (${prompt})`;
      sc.higgsfield = {
        ...sc.higgsfield,
        renderNote: `Updated per Director Prompt: "${prompt.slice(0, 80)}"`,
        updatedAt: new Date().toISOString(),
      };
    }
    actions.push(`Applied creative direction "${prompt.slice(0, 64)}" to Scene ${focusIdx + 1}`);
  }

  // Recompute total target minutes roughly if scenes changed
  const totalSec = next.scenes.reduce((acc, sc) => acc + sc.durationSec, 0);
  next.targetDurationMinutes = Math.max(2, Math.min(30, Math.round(totalSec / 60)));

  const summary = actions.join('; ');
  const now = new Date().toISOString();

  const snapshot: IterationSnapshot = {
    id: `hist-${crypto.randomUUID().slice(0, 6)}`,
    timestamp: now,
    prompt,
    summary,
    actions,
    projectState: extractProjectSnapshot(next),
  };

  next.history = [...next.history, snapshot];
  next.redoStack = [];
  next.updatedAt = now;

  return {
    project: next,
    summary,
    actions,
    higgsfieldTargetSceneIds,
  };
}

export function undoProjectIteration(project: ExplainerProject): ExplainerProject {
  if (project.history.length <= 1) {
    return project;
  }
  const history = [...project.history];
  const popped = history.pop()!;
  const previous = history[history.length - 1];
  const restored = applySnapshotState(project, previous.projectState);
  restored.history = history;
  restored.redoStack = [...project.redoStack, popped];
  return restored;
}

export function redoProjectIteration(project: ExplainerProject): ExplainerProject {
  if (project.redoStack.length === 0) {
    return project;
  }
  const redoStack = [...project.redoStack];
  const nextSnap = redoStack.pop()!;
  const restored = applySnapshotState(project, nextSnap.projectState);
  restored.history = [...project.history, nextSnap];
  restored.redoStack = redoStack;
  return restored;
}

export function restoreProjectSnapshot(
  project: ExplainerProject,
  snapshotId: string
): ExplainerProject | null {
  const idx = project.history.findIndex((h) => h.id === snapshotId);
  if (idx === -1) return null;
  const targetSnap = project.history[idx];
  const now = new Date().toISOString();
  const restored = applySnapshotState(project, targetSnap.projectState);
  const newSnap: IterationSnapshot = {
    id: `hist-${crypto.randomUUID().slice(0, 6)}`,
    timestamp: now,
    prompt: `Restore: "${targetSnap.prompt.slice(0, 48)}"`,
    summary: `Restored timeline & script state from ${targetSnap.timestamp}`,
    actions: [`Restored snapshot ${targetSnap.id}`],
    projectState: extractProjectSnapshot(restored),
  };
  restored.history = [...project.history, newSnap];
  restored.redoStack = [];
  return restored;
}
