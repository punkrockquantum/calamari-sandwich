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

export type SceneAnimationPreset =
  | 'diagram-flow'
  | 'kinetic-cards'
  | 'slide-deck-reveal'
  | 'data-pulse'
  | 'split-comparison'
  | 'timeline-walkthrough'
  | 'particle-network';

export type NativeVisualDiagramType =
  | 'auto'
  | 'architecture'
  | 'flow'
  | 'comparison'
  | 'infographic'
  | 'hardware';

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

export type VoicePlaybackMode = 'speak-script' | 'direct-sample';

export interface VoiceTraits {
  tone: string;
  pitch: 'low' | 'medium' | 'high';
  warmth: number;
  cadence: 'measured' | 'conversational' | 'brisk';
}

export interface VoiceAcousticSignature {
  f0Hz: number;
  brightness: number;
  warmth: number;
  speakingRateWpm: number;
  energyRms?: number;
  durationSec?: number;
  analyzedFromSample: boolean;
}

export interface TtsSpeechConfig {
  rate: number;
  pitch: number;
  lang: string;
  gender?: 'female' | 'male' | 'neutral';
  preferredVoices: string[];
  tone?: string;
  warmth?: number;
  brightness?: number;
  f0Hz?: number;
  cadence?: VoiceTraits['cadence'];
}

export interface TtsBrowserFallback {
  mode: 'browser-speech-synthesis';
  source: 'native' | 'mock';
  text: string;
  voiceId: string;
  voiceName: string;
  speechConfig: TtsSpeechConfig;
  sampleUrl?: string;
  fallbackReason: string;
}

export interface VoiceProfile {
  voice_id: string;
  name: string;
  category: string;
  source: 'elevenlabs' | 'native' | 'mock';
  labels: Record<string, string>;
  preview_url?: string;
  description?: string;
  sampleUrl?: string;
  sampleMimeType?: string;
  playbackMode?: VoicePlaybackMode;
  traits?: VoiceTraits;
  acousticSignature?: VoiceAcousticSignature;
  elevenlabsVoiceId?: string;
  pushStatus?: 'local' | 'pushed' | 'export-ready';
  createdAt?: string;
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
  status: 'idle' | 'queued' | 'generating' | 'rendering' | 'ready' | 'failed' | 'fallback';
  provider: 'higgsfield' | 'gemini_veo' | 'canvas-fallback';
  jobId?: string;
  statusUrl?: string;
  videoUrl?: string;
  model?: string;
  endpoint?: string;
  attachedMediaUrls?: string[];
  errorMessage?: string;
  renderNote?: string;
  updatedAt: string;
}

export type TechAssetCategory =
  | 'hardware'
  | 'server-rack'
  | 'architecture-diagram'
  | 'lab-environment'
  | 'product-demo'
  | 'reference-clip';

export interface TechAsset {
  id: string;
  name: string;
  category: TechAssetCategory;
  sourceType: 'photos' | 'video';
  mediaUrls: string[];
  description: string;
  technicalSpecs: string;
  tags: string[];
  createdAt: string;
}

export interface RagContextMatch {
  sourceType: 'asset' | 'character' | 'scene';
  id: string;
  name: string;
  category: string;
  score: number;
  matchedTerms: string[];
  snippet: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
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
  animationPreset?: SceneAnimationPreset;
  generatedVisualUrl?: string;
  sourceId?: string;
  sourceSlideIndex?: number;
  cameraMotion: CameraMotionPreset;
  cinematicStyle: CinematicStyle;
  transitionIn: TransitionType;
  characterId?: string;
  characterPlacement: CharacterPlacement;
  voiceId: string;
  voicePlaybackMode?: 'auto' | VoicePlaybackMode;
  voiceAudioUrl?: string;
  voiceStatus: 'pending' | 'synthesized' | 'fallback';
  higgsfield: HiggsfieldJobState;
  veo?: HiggsfieldJobState;
  activeVideoProvider?: 'higgsfield' | 'gemini_veo';
  assetIds?: string[];
  ragContext?: RagContextMatch[];
  keyPoints: string[];
}

export type ImportedSourceType = 'pptx' | 'notebooklm-doc' | 'notebooklm-audio' | 'notes';

export interface ImportedSourceSlide {
  index: number;
  title: string;
  bullets: string[];
  speakerNotes?: string;
  imageUrls: string[];
  rawText: string;
}

export interface ImportedSource {
  id: string;
  name: string;
  sourceType: ImportedSourceType;
  createdAt: string;
  summary: string;
  rawText: string;
  slides: ImportedSourceSlide[];
  mediaUrls: string[];
  assetIds: string[];
  audioUrl?: string;
  audioDurationSec?: number;
  tags: string[];
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
  assetIds?: string[];
  sourceIds?: string[];
}

export interface IterationSnapshot {
  id: string;
  timestamp: string;
  prompt: string;
  summary: string;
  actions: string[];
  ragContextUsed?: RagContextMatch[];
  projectState: ProjectStateSnapshot;
}

export interface ExplainerProject extends ProjectStateSnapshot {
  id: string;
  history: IterationSnapshot[];
  redoStack: IterationSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorAccountInfo {
  provider: ConnectorId;
  label?: string;
  tier?: string;
  characterCount?: number;
  characterLimit?: number;
  remainingCharacters?: number;
  voiceCount?: number;
  endpoint?: string;
  model?: string;
  verifiedAt?: string;
}

export interface ProviderStatus {
  elevenlabs: {
    configured: boolean;
    source: 'env' | 'vault' | 'session' | 'mock';
  };
  higgsfield: {
    configured: boolean;
    source: 'env' | 'vault' | 'session' | 'fallback';
  };
  gemini_veo?: {
    configured: boolean;
    source: 'env' | 'vault' | 'session' | 'fallback';
  };
}

export type ConnectorId =
  | 'elevenlabs'
  | 'higgsfield'
  | 'gemini_veo'
  | 'character_cloning'
  | 'script_director_llm'
  | 'music_soundtrack';

export type ConnectorStatusLevel = 'connected' | 'demo' | 'not_configured';

export type ConnectorKeySource = 'env' | 'vault' | 'session' | 'none';

export interface ConnectorDescriptor {
  id: ConnectorId;
  name: string;
  category: string;
  description: string;
  envVar: string;
  sessionHeader: string;
  endpointEnvVar?: string;
  defaultEndpoint: string;
  portalUrl?: string;
  portalLabel?: string;
  supportsKeySecret?: boolean;
  status: ConnectorStatusLevel;
  keySource: ConnectorKeySource;
  maskedKey?: string;
  savedInVault?: boolean;
  endpoint?: string;
  model?: string;
  account?: ConnectorAccountInfo;
  demoFallbackEnabled: boolean;
  capabilities: string[];
}

export interface ConnectorTestResult {
  connectorId: ConnectorId;
  ok: boolean;
  status: ConnectorStatusLevel;
  keySource: ConnectorKeySource;
  maskedKey?: string;
  account?: ConnectorAccountInfo;
  message: string;
  latencyMs: number;
  checkedAt: string;
  details?: Record<string, string | number | boolean>;
}

export interface ConnectConnectorRequest {
  apiKey: string;
  apiSecret?: string;
  endpoint?: string;
  model?: string;
}

export interface ConnectConnectorResponse {
  ok: boolean;
  connector?: ConnectorDescriptor;
  result: ConnectorTestResult;
  error?: string;
}

export interface GenerateProjectRequest {
  topic: string;
  durationMinutes: number;
  audience: AudienceLevel;
  title?: string;
  primaryVoiceId?: string;
  characterIds?: string[];
  assetIds?: string[];
  sourceIds?: string[];
  autoGenerateVisuals?: boolean;
}

export interface GenerateVisualRequest {
  prompt: string;
  title?: string;
  keyPoints?: string[];
  style?: CinematicStyle;
  diagramType?: NativeVisualDiagramType;
  projectId?: string;
  sceneId?: string;
}

export interface GenerateVisualResponse {
  asset: TechAsset;
  visualUrl: string;
  diagramType: Exclude<NativeVisualDiagramType, 'auto'>;
  project?: ExplainerProject;
}

export interface DirectorPromptRequest {
  prompt: string;
}

export interface DirectorPromptResult {
  project: ExplainerProject;
  summary: string;
  actions: string[];
  ragContextUsed?: RagContextMatch[];
  higgsfieldTargetSceneIds?: string[];
  veoTargetSceneIds?: string[];
}

export interface PushVoiceElevenLabsResult {
  ok: boolean;
  mode: 'pushed' | 'export-ready';
  elevenlabsVoiceId?: string;
  voice: VoiceProfile;
  message: string;
  workflowExport?: {
    endpoint: string;
    method: 'POST';
    headers: Record<string, string>;
    sampleUrl?: string;
    payload: Record<string, unknown>;
  };
}
