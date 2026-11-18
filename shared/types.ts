export type AudienceLevel = 'beginner' | 'engineering' | 'executive';

export type CameraMotionPreset =
  | 'Slow Dolly In'
  | 'Orbital Pan'
  | 'Crane Pullback'
  | 'Handheld Micro'
  | 'Rack Focus'
  | 'Static Tripod';

export type CinematicStyle =
  | 'Neon Lab'
  | 'Anamorphic Studio'
  | 'Blueprint Isometric'
  | 'Editorial Documentary'
  | 'Quantum Noir';

export type TransitionType =
  | 'Cross Dissolve'
  | 'Whip Pan'
  | 'Glitch Cut'
  | 'Iris Wipe'
  | 'Match Cut';

export type CharacterPlacement = 'left' | 'center' | 'right' | 'split' | 'offscreen';

export type CharacterSourceType = 'photos' | 'video' | 'preset';

export type SceneVisualOverlay =
  | 'neural-graph'
  | 'architecture-flow'
  | 'code-terminal'
  | 'packet-stream'
  | 'wave-spectrum';

export interface CharacterTraits {
  wardrobe: string;
  lighting: string;
  archetype: string;
  expression: string;
  accentColor: string;
}

export interface CharacterProfile {
  id: string;
  name: string;
  role: string;
  sourceType: CharacterSourceType;
  mediaUrls: string[];
  previewColor: string;
  stylePreset: string;
  traits: CharacterTraits;
  voiceId?: string;
  isPreset?: boolean;
  createdAt: string;
}

export interface VoiceProfile {
  voice_id: string;
  name: string;
  category: string;
  source: 'elevenlabs' | 'mock';
  labels: Record<string, string>;
  preview_url?: string;
  description?: string;
}

export interface MusicTrack {
  id: string;
  title: string;
  mood: string;
  bpm: number;
  startTimeSec: number;
  durationSec: number;
  volumeDb: number;
  duckUnderVoice: boolean;
  accentColor: string;
}

export interface HiggsfieldJobState {
  status: 'idle' | 'queued' | 'rendering' | 'ready' | 'fallback';
  provider: 'higgsfield' | 'canvas-fallback';
  jobId?: string;
  videoUrl?: string;
  renderNote?: string;
  updatedAt: string;
}

export interface SceneItem {
  id: string;
  chapterId: string;
  order: number;
  title: string;
  durationSec: number;
  narration: string;
  visualPrompt: string;
  visualOverlay: SceneVisualOverlay;
  cameraMotion: CameraMotionPreset;
  cinematicStyle: CinematicStyle;
  transitionIn: TransitionType;
  characterId?: string;
  characterPlacement: CharacterPlacement;
  voiceId: string;
  voiceAudioUrl?: string;
  voiceStatus: 'pending' | 'synthesized' | 'fallback';
  higgsfield: HiggsfieldJobState;
  keyPoints: string[];
}

export interface ChapterItem {
  id: string;
  order: number;
  title: string;
  summary: string;
  targetDurationSec: number;
}

export interface ProjectStateSnapshot {
  title: string;
  topic: string;
  audience: AudienceLevel;
  targetDurationMinutes: number;
  primaryVoiceId: string;
  chapters: ChapterItem[];
  scenes: SceneItem[];
  characters: CharacterProfile[];
  musicTracks: MusicTrack[];
}

export interface IterationSnapshot {
  id: string;
  timestamp: string;
  prompt: string;
  summary: string;
  actions: string[];
  projectState: ProjectStateSnapshot;
}

export interface ExplainerProject extends ProjectStateSnapshot {
  id: string;
  history: IterationSnapshot[];
  redoStack: IterationSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface ProviderStatus {
  elevenlabs: {
    configured: boolean;
    source: 'env' | 'session' | 'mock';
  };
  higgsfield: {
    configured: boolean;
    source: 'env' | 'session' | 'fallback';
  };
}

export type ConnectorId =
  | 'elevenlabs'
  | 'higgsfield'
  | 'character_cloning'
  | 'script_director_llm'
  | 'music_soundtrack';

export type ConnectorStatusLevel = 'connected' | 'demo' | 'not_configured';

export type ConnectorKeySource = 'env' | 'session' | 'none';

export interface ConnectorDescriptor {
  id: ConnectorId;
  name: string;
  category: string;
  description: string;
  envVar: string;
  sessionHeader: string;
  endpointEnvVar?: string;
  defaultEndpoint: string;
  status: ConnectorStatusLevel;
  keySource: ConnectorKeySource;
  demoFallbackEnabled: boolean;
  capabilities: string[];
}

export interface ConnectorTestResult {
  connectorId: ConnectorId;
  ok: boolean;
  status: ConnectorStatusLevel;
  keySource: ConnectorKeySource;
  message: string;
  latencyMs: number;
  checkedAt: string;
  details?: Record<string, string | number | boolean>;
}

export interface GenerateProjectRequest {
  topic: string;
  durationMinutes: number;
  audience: AudienceLevel;
  title?: string;
  primaryVoiceId?: string;
  characterIds?: string[];
}

export interface DirectorPromptRequest {
  prompt: string;
}

export interface DirectorPromptResult {
  project: ExplainerProject;
  summary: string;
  actions: string[];
}
