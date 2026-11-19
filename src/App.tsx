import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type {
  CharacterProfile,
  ConnectConnectorRequest,
  ConnectorDescriptor,
  ConnectorId,
  ConnectorTestResult,
  ExplainerProject,
  GenerateProjectRequest,
  ImportedSource,
  MusicTrack,
  NativeVisualDiagramType,
  PushVoiceElevenLabsResult,
  RagContextMatch,
  SceneItem,
  TechAsset,
  TimelineDragPayload,
  TimelineDropRequest,
  TtsBrowserFallback,
  VoicePlaybackMode,
  VoiceProfile,
} from '@shared/types';
import { studioApi } from '@/lib/api';
import {
  CONNECTOR_IDS,
  connectConnectorAccount,
  createEmptySessionConnectorKeys,
  disconnectConnectorAccount,
  fetchConnectors,
  loadDemoFallbackPrefs,
  loadSessionConnectorKeys,
  saveDemoFallbackPrefs,
  saveSessionConnectorKeys,
  testConnector,
  type DemoFallbackPrefs,
  type SessionConnectorKeys,
} from '@/lib/connectors/registry';
import {
  playAudioUrl,
  playVoiceBlobUrl,
  speakWithBrowserSpeechSynthesis,
  startAmbientBed,
  stopAllAudio,
  stopVoiceAudio,
  unlockAudio,
} from '@/lib/audioEngine';
import {
  exportCanvasWithAudioWebm,
  extensionForAudioMime,
  sanitizeFilename,
  triggerBlobDownload,
} from '@/lib/mediaExport';
import { AssetUploadModal } from '@/components/AssetUploadModal';
import { CharacterCloningModal } from '@/components/CharacterCloningModal';
import { ConnectorsWorkspace } from '@/components/ConnectorsWorkspace';
import { DirectorPromptBar } from '@/components/DirectorPromptBar';
import { ExplainerWizardModal } from '@/components/ExplainerWizardModal';
import { InspectorPanel, type InspectorTab } from '@/components/InspectorPanel';
import { IterationHistoryDrawer } from '@/components/IterationHistoryDrawer';
import { PreviewPlayer } from '@/components/PreviewPlayer';
import { ProviderConnectModal } from '@/components/ProviderConnectModal';
import { SourceImportModal } from '@/components/SourceImportModal';
import { Timeline, type SelectedTimelineBlock } from '@/components/Timeline';
import { TopBar, type WorkspaceView } from '@/components/TopBar';
import { TopicGeneratorModal } from '@/components/TopicGeneratorModal';
import { VoiceCloningModal } from '@/components/VoiceCloningModal';

export function App() {
  const [projects, setProjects] = useState<ExplainerProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [activeSceneId, setActiveSceneId] = useState<string>('');
  const [activeView, setActiveView] = useState<WorkspaceView>('studio');

  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [voiceSource, setVoiceSource] = useState<'env' | 'vault' | 'session' | 'mock'>('mock');
  const [allCharacters, setAllCharacters] = useState<CharacterProfile[]>([]);
  const [presets, setPresets] = useState<CharacterProfile[]>([]);
  const [assets, setAssets] = useState<TechAsset[]>([]);
  const [sources, setSources] = useState<ImportedSource[]>([]);

  const [sessionKeys, setSessionKeys] = useState<SessionConnectorKeys>(() =>
    loadSessionConnectorKeys()
  );
  const [demoPrefs, setDemoPrefs] = useState<DemoFallbackPrefs>(() =>
    loadDemoFallbackPrefs()
  );
  const [connectors, setConnectors] = useState<ConnectorDescriptor[]>([]);
  const [testResults, setTestResults] = useState<
    Partial<Record<ConnectorId, ConnectorTestResult>>
  >({});
  const [testingId, setTestingId] = useState<ConnectorId | 'all' | null>(null);

  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [seekEpoch, setSeekEpoch] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [activeVoiceSource, setActiveVoiceSource] = useState<
    'elevenlabs' | 'native' | 'mock' | null
  >(null);
  const [activeVoiceMode, setActiveVoiceMode] = useState<
    'elevenlabs' | 'direct-sample' | 'system-speech' | null
  >(null);

  const [showNewModal, setShowNewModal] = useState(false);
  const [showWizardModal, setShowWizardModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [connectModalId, setConnectModalId] = useState<ConnectorId | null>(null);

  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('scene');
  const [selectedTimelineBlock, setSelectedTimelineBlock] =
    useState<SelectedTimelineBlock | null>(null);
  const [selectedMusicTrackId, setSelectedMusicTrackId] = useState<string | null>(null);
  const [draggingPayload, setDraggingPayload] = useState<TimelineDragPayload | null>(null);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastActionSummary, setLastActionSummary] = useState<string | null>(null);
  const [lastRagContext, setLastRagContext] = useState<RagContextMatch[] | undefined>(undefined);
  const [lastVoicePushResult, setLastVoicePushResult] = useState<PushVoiceElevenLabsResult | null>(
    null
  );
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const ambientStopRef = useRef<(() => void) | null>(null);
  const voiceCacheRef = useRef<
    Map<
      string,
      |         {
          kind: 'audio';
          blobUrl: string;
          blob: Blob;
          contentType: string;
          source: 'elevenlabs' | 'native' | 'mock';
          synthesisMode?: string;
          dspShaped?: boolean;
        }
      | {
          kind: 'speech-synthesis';
          fallback: TtsBrowserFallback;
          source: 'native' | 'mock';
        }
    >
  >(new Map());
  const lastSpokenSceneKeyRef = useRef<string | null>(null);

  const clearVoiceCache = useCallback(() => {
    for (const entry of voiceCacheRef.current.values()) {
      if (entry.kind === 'audio') {
        URL.revokeObjectURL(entry.blobUrl);
      }
    }
    voiceCacheRef.current.clear();
  }, []);

  const refreshConnectorsAndVoices = useCallback(
    async (keys: SessionConnectorKeys, prefs: DemoFallbackPrefs) => {
      const [connectorList, voiceRes] = await Promise.all([
        fetchConnectors(keys, prefs),
        studioApi.listVoices(keys),
      ]);
      setConnectors(connectorList);
      setVoices(voiceRes.voices);
      setVoiceSource(voiceRes.source);
      return { connectorList, voiceRes };
    },
    []
  );

  // Load projects, characters, assets, and imported sources once on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [projRes, charRes, assetRes, sourceRes] = await Promise.all([
          studioApi.listProjects(),
          studioApi.listCharacters(),
          studioApi.listAssets(),
          studioApi.listSources(),
        ]);
        if (!mounted) return;
        setProjects(projRes.projects);
        setAllCharacters(charRes.characters);
        setPresets(charRes.presets);
        setAssets(assetRes.assets);
        setSources(sourceRes.sources);
        if (projRes.projects[0]) {
          setActiveProjectId(projRes.projects[0].id);
          setActiveSceneId(projRes.projects[0].scenes[0]?.id || '');
        }
      } catch (err) {
        if (mounted) {
          setErrorBanner(
            err instanceof Error ? err.message : 'Failed to load Calamari Sandwich studio.'
          );
        }
      }
    })();
    return () => {
      mounted = false;
      stopAllAudio();
    };
  }, []);

  // Refresh connectors and voices whenever session keys or demo prefs change
  useEffect(() => {
    void refreshConnectorsAndVoices(sessionKeys, demoPrefs).catch((err) => {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to load connectors and voices.'
      );
    });
  }, [refreshConnectorsAndVoices, sessionKeys, demoPrefs]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || projects[0],
    [projects, activeProjectId]
  );

  const totalDurationSec = useMemo(() => {
    if (!activeProject) return 0;
    return activeProject.scenes.reduce((s, sc) => s + sc.durationSec, 0);
  }, [activeProject]);

  const activeScene = useMemo(() => {
    if (!activeProject) return undefined;
    return (
      activeProject.scenes.find((s) => s.id === activeSceneId) || activeProject.scenes[0]
    );
  }, [activeProject, activeSceneId]);

  const upsertProject = (updated: ExplainerProject) => {
    setProjects((prev) => {
      const exists = prev.some((p) => p.id === updated.id);
      return exists ? prev.map((p) => (p.id === updated.id ? updated : p)) : [updated, ...prev];
    });
    setActiveProjectId(updated.id);
    if (!updated.scenes.some((s) => s.id === activeSceneId)) {
      setActiveSceneId(updated.scenes[0]?.id || '');
    }
  };

  const currentTimeSecRef = useRef(currentTimeSec);
  currentTimeSecRef.current = currentTimeSec;
  const activeProjectRef = useRef(activeProject);
  activeProjectRef.current = activeProject;
  const sessionKeysRef = useRef(sessionKeys);
  sessionKeysRef.current = sessionKeys;

  const firstMusicTrack = activeProject?.musicTracks[0];
  const firstMusicBpm = firstMusicTrack?.bpm ?? 0;
  const firstMusicDb = firstMusicTrack?.volumeDb ?? -16;
  const hasMusicTrack = Boolean(firstMusicTrack);

  // Playback ticker (does not restart when scene metadata or voiceStatus updates)
  useEffect(() => {
    if (!isPlaying || totalDurationSec <= 0) {
      if (ambientStopRef.current) {
        ambientStopRef.current();
        ambientStopRef.current = null;
      }
      return;
    }

    if (!isMuted && hasMusicTrack) {
      ambientStopRef.current = startAmbientBed(firstMusicBpm, firstMusicDb);
    }

    const timer = window.setInterval(() => {
      setCurrentTimeSec((prev) => {
        const next = prev + 0.1;
        if (next >= totalDurationSec) {
          setIsPlaying(false);
          return 0;
        }
        return next;
      });
    }, 100);

    return () => {
      window.clearInterval(timer);
      if (ambientStopRef.current) {
        ambientStopRef.current();
        ambientStopRef.current = null;
      }
    };
  }, [isPlaying, isMuted, totalDurationSec, hasMusicTrack, firstMusicBpm, firstMusicDb]);

  // Sync activeSceneId with playhead during playback
  useEffect(() => {
    if (!activeProject || !isPlaying) return;
    let cursor = 0;
    for (const sc of activeProject.scenes) {
      if (currentTimeSec >= cursor && currentTimeSec < cursor + sc.durationSec) {
        if (sc.id !== activeSceneId) {
          setActiveSceneId(sc.id);
        }
        break;
      }
      cursor += sc.durationSec;
    }
  }, [currentTimeSec, activeProject, isPlaying, activeSceneId]);

  // Synchronized ElevenLabs / Native Cloned / System Speech voiceover playback during timeline playback
  useEffect(() => {
    if (!isPlaying || isMuted || !activeProject?.id || !activeScene || activeScene.voiceEnabled === false) {
      stopVoiceAudio();
      lastSpokenSceneKeyRef.current = null;
      if (!isPlaying || isMuted || activeScene?.voiceEnabled === false) {
        setActiveVoiceSource(null);
        setActiveVoiceMode(null);
      }
      return;
    }

    const playbackModeKey = activeScene.voicePlaybackMode || 'auto';
    const spokenKey = `${activeScene.id}:${activeScene.voiceId}:${playbackModeKey}:${activeScene.narration}:${seekEpoch}`;
    if (lastSpokenSceneKeyRef.current === spokenKey) {
      return;
    }
    lastSpokenSceneKeyRef.current = spokenKey;

    const proj = activeProjectRef.current;
    let sceneStartSec = 0;
    for (const sc of proj?.scenes || []) {
      if (sc.id === activeScene.id) break;
      sceneStartSec += sc.durationSec;
    }
    const localOffsetSec = Math.max(0, currentTimeSecRef.current - sceneStartSec);
    const cacheKey = `${activeScene.id}:${activeScene.voiceId}:${playbackModeKey}:${activeScene.narration}`;
    const voiceObj = voices.find((v) => v.voice_id === activeScene.voiceId);
    let cancelled = false;

    const cached = voiceCacheRef.current.get(cacheKey);
    if (cached) {
      setActiveVoiceSource(cached.source);
      if (cached.kind === 'speech-synthesis') {
        setActiveVoiceMode('system-speech');
        void speakWithBrowserSpeechSynthesis({
          text: activeScene.narration,
          speechConfig: cached.fallback.speechConfig,
          startOffsetSec: localOffsetSec,
          sceneDurationSec: activeScene.durationSec,
        });
      } else {
        setActiveVoiceMode(
          cached.synthesisMode === 'direct-sample'
            ? 'direct-sample'
            : cached.source === 'elevenlabs'
              ? 'elevenlabs'
              : 'system-speech'
        );
        void playVoiceBlobUrl(cached.blobUrl, 0.9, localOffsetSec, {
          ...voiceObj?.traits,
          acousticSignature: voiceObj?.acousticSignature,
          dspShaped: cached.dspShaped,
        });
      }
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const res = await studioApi.synthesizeSpeech(
          {
            voiceId: activeScene.voiceId,
            text: activeScene.narration,
            projectId: activeProject.id,
            sceneId: activeScene.id,
            playbackMode: activeScene.voicePlaybackMode,
          },
          sessionKeysRef.current
        );
        if (cancelled) {
          if (res.kind === 'audio') {
            URL.revokeObjectURL(res.blobUrl);
          }
          return;
        }
        const normalizedSource =
          res.source === 'elevenlabs'
            ? 'elevenlabs'
            : res.source === 'native'
              ? 'native'
              : 'mock';

        if (res.kind === 'speech-synthesis') {
          voiceCacheRef.current.set(cacheKey, {
            kind: 'speech-synthesis',
            fallback: res.fallback,
            source: normalizedSource === 'native' ? 'native' : 'mock',
          });
          setActiveVoiceSource(normalizedSource);
          setActiveVoiceMode('system-speech');
          await speakWithBrowserSpeechSynthesis({
            text: activeScene.narration,
            speechConfig: res.fallback.speechConfig,
            startOffsetSec: localOffsetSec,
            sceneDurationSec: activeScene.durationSec,
          });
          return;
        }

        voiceCacheRef.current.set(cacheKey, {
          kind: 'audio',
          blobUrl: res.blobUrl,
          blob: res.blob,
          contentType: res.contentType,
          source: normalizedSource,
          synthesisMode: res.synthesisMode,
          dspShaped: res.dspShaped,
        });
        setActiveVoiceSource(normalizedSource);
        setActiveVoiceMode(
          res.synthesisMode === 'direct-sample'
            ? 'direct-sample'
            : normalizedSource === 'elevenlabs'
              ? 'elevenlabs'
              : 'system-speech'
        );
        const playback = await playVoiceBlobUrl(res.blobUrl, 0.9, localOffsetSec, {
          ...voiceObj?.traits,
          acousticSignature: voiceObj?.acousticSignature,
          dspShaped: res.dspShaped,
        });
        if (!playback.ok && playback.error && !cancelled) {
          setErrorBanner(`Audio playback blocked: ${playback.error}`);
        }
      } catch (err) {
        if (!cancelled) {
          setActiveVoiceSource(null);
          setActiveVoiceMode(null);
          setErrorBanner(
            err instanceof Error ? err.message : 'Voiceover synthesis failed during playback.'
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isPlaying,
    isMuted,
    activeProject?.id,
    activeScene?.id,
    activeScene?.voiceId,
    activeScene?.voicePlaybackMode,
    activeScene?.narration,
    activeScene?.voiceEnabled,
    seekEpoch,
    voices,
  ]);

  // Poll queued / generating Higgsfield and Gemini Veo jobs until ready or failed
  const pendingProviderJobs = useMemo(() => {
    if (!activeProject) return [] as Array<{ sceneId: string; provider: 'higgsfield' | 'gemini_veo' }>;
    const pending: Array<{ sceneId: string; provider: 'higgsfield' | 'gemini_veo' }> = [];
    for (const sc of activeProject.scenes) {
      if (
        sc.higgsfield.provider === 'higgsfield' &&
        (sc.higgsfield.status === 'queued' ||
          sc.higgsfield.status === 'generating' ||
          sc.higgsfield.status === 'rendering')
      ) {
        pending.push({ sceneId: sc.id, provider: 'higgsfield' });
      }
      if (
        sc.veo &&
        sc.veo.provider === 'gemini_veo' &&
        (sc.veo.status === 'queued' ||
          sc.veo.status === 'generating' ||
          sc.veo.status === 'rendering')
      ) {
        pending.push({ sceneId: sc.id, provider: 'gemini_veo' });
      }
    }
    return pending;
  }, [activeProject]);

  useEffect(() => {
    if (!activeProject || pendingProviderJobs.length === 0) return;
    let cancelled = false;
    const projectId = activeProject.id;

    const timer = window.setInterval(() => {
      void (async () => {
        for (const item of pendingProviderJobs) {
          if (cancelled) return;
          try {
            const res = await studioApi.pollProviderJob(
              projectId,
              item.sceneId,
              item.provider,
              sessionKeys
            );
            if (!cancelled) {
              upsertProject(res.project);
              if (res.job.status === 'ready') {
                setLastActionSummary(
                  `${item.provider === 'gemini_veo' ? 'Gemini Veo' : 'Higgsfield'} video ready`
                );
              } else if (res.job.status === 'failed') {
                setErrorBanner(res.job.errorMessage || `${item.provider} generation failed.`);
              }
            }
          } catch {
            // Keep polling until next tick
          }
        }
      })();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeProject, pendingProviderJobs, sessionKeys]);

  const handleGenerateProject = async (payload: GenerateProjectRequest) => {
    setBusyAction('generate');
    setErrorBanner(null);
    try {
      const [{ project }, assetRes] = await Promise.all([
        studioApi.generateProject(payload, sessionKeys),
        studioApi.listAssets(),
      ]);
      // Refresh assets after generation so auto-generated SVGs appear in Assets & Canvas
      const latestAssets = await studioApi.listAssets();
      setAssets(latestAssets.assets || assetRes.assets);
      upsertProject(project);
      setCurrentTimeSec(0);
      setIsPlaying(false);
      setActiveSceneId(project.scenes[0]?.id || '');
      setActiveView('studio');
      setLastRagContext(project.scenes[0]?.ragContext);
      setLastActionSummary(`Generated "${project.title}"`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDirectorPrompt = async (prompt: string) => {
    if (!activeProject) return;
    setBusyAction('director');
    setErrorBanner(null);
    try {
      const res = await studioApi.runDirectorPrompt(activeProject.id, prompt, sessionKeys);
      upsertProject(res.project);
      setLastRagContext(res.ragContextUsed);
      setLastActionSummary(res.summary);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Director edit failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleUndo = async () => {
    if (!activeProject) return;
    setBusyAction('undo');
    try {
      const { project } = await studioApi.undoProject(activeProject.id);
      upsertProject(project);
      setLastActionSummary('Undid last iteration');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRedo = async () => {
    if (!activeProject) return;
    setBusyAction('redo');
    try {
      const { project } = await studioApi.redoProject(activeProject.id);
      upsertProject(project);
      setLastActionSummary('Redid iteration');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestoreSnapshot = async (snapshotId: string) => {
    if (!activeProject) return;
    setBusyAction('restore');
    try {
      const { project } = await studioApi.restoreSnapshot(activeProject.id, snapshotId);
      upsertProject(project);
      setShowHistoryDrawer(false);
      setLastActionSummary('Restored timeline snapshot');
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdateScene = async (sceneId: string, patch: Record<string, unknown>) => {
    if (!activeProject) return;
    try {
      const { project } = await studioApi.updateScene(
        activeProject.id,
        sceneId,
        patch as Partial<SceneItem>
      );
      upsertProject(project);
      if (
        patch.voiceId !== undefined ||
        patch.narration !== undefined ||
        patch.voicePlaybackMode !== undefined ||
        patch.voiceEnabled !== undefined
      ) {
        clearVoiceCache();
        lastSpokenSceneKeyRef.current = null;
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Scene update failed.');
    }
  };

  const handleReorderScenes = async (sceneIds: string[]) => {
    if (!activeProject) return;
    try {
      const { project } = await studioApi.reorderScenes(activeProject.id, sceneIds);
      upsertProject(project);
      setLastActionSummary('Reordered scenes on timeline');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to reorder scenes.');
    }
  };

  const handleDeleteScene = async (sceneId: string) => {
    if (!activeProject) return;
    try {
      const { project } = await studioApi.deleteScene(activeProject.id, sceneId);
      upsertProject(project);
      clearVoiceCache();
      lastSpokenSceneKeyRef.current = null;
      setLastActionSummary('Deleted scene from timeline');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to delete scene.');
    }
  };

  const handleUpdateMusicTrack = async (trackId: string, patch: Partial<MusicTrack>) => {
    if (!activeProject) return;
    try {
      const { project } = await studioApi.updateMusicTrack(activeProject.id, trackId, patch);
      upsertProject(project);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to update music track.');
    }
  };

  const handleDropOnTimeline = async (req: TimelineDropRequest) => {
    if (!activeProject) return;
    setDraggingPayload(null);
    try {
      const res = await studioApi.dropOnTimeline(activeProject.id, req);
      upsertProject(res.project);
      clearVoiceCache();
      lastSpokenSceneKeyRef.current = null;
      if (res.summary) {
        setLastActionSummary(res.summary);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Timeline drop failed.');
    }
  };

  const handleTriggerHiggsfield = async (sceneId: string) => {
    if (!activeProject) return;
    setBusyAction('higgsfield');
    try {
      const { project, higgsfield } = await studioApi.generateHiggsfieldScene(
        activeProject.id,
        sceneId,
        sessionKeys
      );
      upsertProject(project);
      setLastActionSummary(higgsfield.renderNote || 'Scene render updated');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Higgsfield render failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePushSceneToProvider = async (
    provider: 'higgsfield' | 'gemini_veo',
    sceneId: string,
    characterId?: string
  ) => {
    if (!activeProject) return;
    setBusyAction(provider);
    setErrorBanner(null);
    try {
      const { project, job } = await studioApi.pushSceneToProvider(
        provider,
        activeProject.id,
        sceneId,
        characterId,
        sessionKeys
      );
      upsertProject(project);
      setLastActionSummary(
        job.renderNote ||
          `Pushed scene to ${provider === 'gemini_veo' ? 'Gemini Veo' : 'Higgsfield'}`
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Provider push failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePreviewVoice = async (
    voiceId: string,
    sampleText?: string,
    sceneId?: string
  ) => {
    if (!activeProject) return;
    unlockAudio();
    if (isMuted) {
      setIsMuted(false);
    }
    setBusyAction('tts');
    setErrorBanner(null);
    try {
      const sceneObj = sceneId
        ? activeProject.scenes.find((s) => s.id === sceneId)
        : activeScene;
      const voiceObj = voices.find((v) => v.voice_id === voiceId);
      const textToSpeak =
        sampleText || activeScene?.narration || 'Calamari Sandwich narration check.';
      const res = await studioApi.synthesizeSpeech(
        {
          voiceId,
          text: textToSpeak,
          projectId: activeProject.id,
          sceneId,
          playbackMode: sceneId ? sceneObj?.voicePlaybackMode : undefined,
        },
        sessionKeys
      );
      const normalizedSource =
        res.source === 'elevenlabs'
          ? 'elevenlabs'
          : res.source === 'native'
            ? 'native'
            : 'mock';
      setActiveVoiceSource(normalizedSource);

      if (res.kind === 'speech-synthesis') {
        setActiveVoiceMode('system-speech');
        const speechPlay = await speakWithBrowserSpeechSynthesis({
          text: textToSpeak,
          speechConfig: res.fallback.speechConfig,
        });
        if (!speechPlay.ok && speechPlay.error) {
          setErrorBanner(`Speech preview failed: ${speechPlay.error}`);
        }
        setLastActionSummary(
          `Speaking via browser SpeechSynthesis (${speechPlay.voiceUsed || res.fallback.voiceName})`
        );
      } else {
        setActiveVoiceMode(
          res.synthesisMode === 'direct-sample'
            ? 'direct-sample'
            : normalizedSource === 'elevenlabs'
              ? 'elevenlabs'
              : 'system-speech'
        );
        const playback = await playVoiceBlobUrl(res.blobUrl, 0.9, 0, {
          ...voiceObj?.traits,
          acousticSignature: voiceObj?.acousticSignature,
          dspShaped: res.dspShaped,
        });
        if (!playback.ok && playback.error) {
          setErrorBanner(`Audio playback failed: ${playback.error}`);
        }
        setLastActionSummary(
          res.synthesisMode === 'direct-sample'
            ? 'Playing recorded/uploaded voice clip'
            : normalizedSource === 'elevenlabs'
              ? 'Synthesized ElevenLabs voiceover'
              : `Spoke voiceover via ${res.synthesisMode || 'system speech'}`
        );
      }

      if (sceneId) {
        const refreshed = await studioApi.getProject(activeProject.id);
        upsertProject(refreshed.project);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Voice synthesis failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdateVoice = async (
    voiceId: string,
    patch: { playbackMode?: VoicePlaybackMode }
  ) => {
    setBusyAction(`update-voice-${voiceId}`);
    setErrorBanner(null);
    try {
      await studioApi.updateVoice(voiceId, patch);
      clearVoiceCache();
      lastSpokenSceneKeyRef.current = null;
      await refreshConnectorsAndVoices(sessionKeys, demoPrefs);
      setLastActionSummary(
        patch.playbackMode === 'direct-sample'
          ? 'Switched voice to Use Recorded Clip (Direct Sample Mode)'
          : 'Switched voice to Speak Script mode'
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to update voice.');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePlaySampleUrl = async (url: string, label: string) => {
    unlockAudio();
    if (isMuted) {
      setIsMuted(false);
    }
    setErrorBanner(null);
    const playback = await playAudioUrl(url);
    if (!playback.ok && playback.error) {
      setErrorBanner(`Could not play sample for "${label}": ${playback.error}`);
    } else {
      setLastActionSummary(`Playing recorded/uploaded sample for "${label}"`);
    }
  };

  const handleDeleteVoice = async (voiceId: string) => {
    setBusyAction(`delete-voice-${voiceId}`);
    setErrorBanner(null);
    try {
      await studioApi.deleteVoice(voiceId);
      clearVoiceCache();
      await refreshConnectorsAndVoices(sessionKeys, demoPrefs);
      if (activeProject) {
        const fallbackVoiceId =
          voices.find((v) => v.voice_id !== voiceId)?.voice_id || 'mock-rachel';
        let latest = activeProject;
        for (const sc of activeProject.scenes) {
          if (sc.voiceId === voiceId) {
            const res = await studioApi.updateScene(activeProject.id, sc.id, {
              voiceId: fallbackVoiceId,
            });
            latest = res.project;
          }
        }
        upsertProject(latest);
      }
      setLastActionSummary('Deleted custom cloned voice');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to delete voice.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadSceneAudio = async (scene: SceneItem) => {
    if (!activeProject) return;
    setBusyAction('tts');
    setErrorBanner(null);
    try {
      const res = await studioApi.synthesizeSpeech(
        {
          voiceId: scene.voiceId,
          text: scene.narration,
          projectId: activeProject.id,
          sceneId: scene.id,
          playbackMode: scene.voicePlaybackMode,
        },
        sessionKeys
      );
      if (res.kind === 'speech-synthesis') {
        if (res.fallback.sampleUrl) {
          const sampleResp = await fetch(res.fallback.sampleUrl);
          if (sampleResp.ok) {
            const sampleBlob = await sampleResp.blob();
            const ext = extensionForAudioMime(sampleBlob.type || 'audio/wav');
            triggerBlobDownload(sampleBlob, `${sanitizeFilename(scene.title)}-sample.${ext}`);
            setLastActionSummary(`Downloaded recorded voice sample (${ext.toUpperCase()})`);
            return;
          }
        }
        setLastActionSummary(
          'Live browser SpeechSynthesis active (no server WAV file on this host). Connect ElevenLabs or attach a recorded clip to export audio.'
        );
        return;
      }

      const ext = extensionForAudioMime(res.contentType);
      triggerBlobDownload(res.blob, `${sanitizeFilename(scene.title)}-voiceover.${ext}`);
      URL.revokeObjectURL(res.blobUrl);
      setLastActionSummary(`Downloaded voiceover audio (${ext.toUpperCase()}) for "${scene.title}"`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Audio download failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportSceneVideo = async (params: {
    canvas: HTMLCanvasElement | null;
    scene: SceneItem;
    stageVideoUrl: string | null;
  }) => {
    if (!activeProject) return;
    setBusyAction('export-video');
    setErrorBanner(null);
    try {
      if (params.stageVideoUrl) {
        const resp = await fetch(params.stageVideoUrl);
        if (!resp.ok) {
          throw new Error(`Failed to fetch stage video (HTTP ${resp.status})`);
        }
        const videoBlob = await resp.blob();
        const ext = videoBlob.type.includes('webm') ? 'webm' : 'mp4';
        triggerBlobDownload(videoBlob, `${sanitizeFilename(params.scene.title)}.${ext}`);
        setLastActionSummary(`Downloaded stage video for "${params.scene.title}"`);
        return;
      }

      if (!params.canvas) {
        throw new Error('Stage canvas is not ready for export.');
      }

      const speech = await studioApi.synthesizeSpeech(
        {
          voiceId: params.scene.voiceId,
          text: params.scene.narration,
          projectId: activeProject.id,
          sceneId: params.scene.id,
          playbackMode: params.scene.voicePlaybackMode,
        },
        sessionKeys
      );

      let voiceBlob: Blob | undefined;
      let voiceDspShaped = false;
      if (speech.kind === 'audio') {
        voiceBlob = speech.blob;
        voiceDspShaped = Boolean(speech.dspShaped);
        URL.revokeObjectURL(speech.blobUrl);
      }

      const activeVoiceObj = voices.find((v) => v.voice_id === params.scene.voiceId);
      const exported = await exportCanvasWithAudioWebm({
        canvas: params.canvas,
        voiceBlob,
        durationSec: params.scene.durationSec,
        voiceTraits: {
          warmth: activeVoiceObj?.acousticSignature?.warmth ?? activeVoiceObj?.traits?.warmth,
          brightness: activeVoiceObj?.acousticSignature?.brightness,
          dspShaped: voiceDspShaped,
        },
      });
      triggerBlobDownload(exported.blob, `${sanitizeFilename(params.scene.title)}.webm`);
      setLastActionSummary(
        exported.hasAudioTrack
          ? `Exported "${params.scene.title}" video + spoken voiceover (.webm)`
          : `Exported "${params.scene.title}" video (.webm) — browser SpeechSynthesis plays live in studio`
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Video export failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCloneVoice = async (
    formData: FormData,
    options?: { setAsActiveExplainerVoice: boolean }
  ): Promise<VoiceProfile> => {
    setBusyAction('clone-voice');
    try {
      const { voice, project: serverUpdatedProject } = await studioApi.cloneVoice(formData);
      clearVoiceCache();
      lastSpokenSceneKeyRef.current = null;
      await refreshConnectorsAndVoices(sessionKeys, demoPrefs);
      const shouldActivate = options?.setAsActiveExplainerVoice ?? true;
      if (serverUpdatedProject) {
        upsertProject(serverUpdatedProject);
      } else if (activeProject && shouldActivate) {
        const updated = await studioApi.setProjectPrimaryVoice(
          activeProject.id,
          voice.voice_id,
          true
        );
        upsertProject(updated.project);
      }
      setLastActionSummary(
        shouldActivate
          ? `Cloned "${voice.name}" and activated as explainer voice across all scenes`
          : `Cloned native voice "${voice.name}"`
      );
      return voice;
    } finally {
      setBusyAction(null);
    }
  };

  const handleUploadSceneVoiceTake = async (sceneId: string, file: File) => {
    if (!activeProject) return;
    setBusyAction('voice-take');
    setErrorBanner(null);
    try {
      const fd = new FormData();
      fd.append('audio', file);
      const { project } = await studioApi.uploadSceneVoiceTake(activeProject.id, sceneId, fd);
      upsertProject(project);
      clearVoiceCache();
      lastSpokenSceneKeyRef.current = null;
      setLastActionSummary('Attached recorded voice take to scene');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to attach scene voice take.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteSceneVoiceTake = async (sceneId: string) => {
    if (!activeProject) return;
    setBusyAction('voice-take');
    try {
      const { project } = await studioApi.deleteSceneVoiceTake(activeProject.id, sceneId);
      upsertProject(project);
      clearVoiceCache();
      lastSpokenSceneKeyRef.current = null;
      setLastActionSummary('Cleared per-scene voice take');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to clear scene voice take.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleGenerateSceneVisual = async (
    sceneId: string,
    diagramType: NativeVisualDiagramType
  ) => {
    if (!activeProject) return;
    const sc = activeProject.scenes.find((s) => s.id === sceneId);
    if (!sc) return;
    setBusyAction('generate-visual');
    setErrorBanner(null);
    try {
      const res = await studioApi.generateNativeVisual({
        prompt: sc.visualPrompt,
        title: sc.title,
        keyPoints: sc.keyPoints,
        style: sc.cinematicStyle,
        diagramType,
        projectId: activeProject.id,
        sceneId: sc.id,
      });
      setAssets((prev) => [res.asset, ...prev.filter((a) => a.id !== res.asset.id)]);
      if (res.project) {
        upsertProject(res.project);
      }
      setLastActionSummary(`Generated native ${res.diagramType} SVG visual for "${sc.title}"`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Native visual generation failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleGenerateFromSource = async (source: ImportedSource) => {
    await handleGenerateProject({
      topic: source.name,
      durationMinutes: Math.max(1, Math.min(30, Math.ceil(source.slides.length * 0.5))),
      audience: activeProject?.audience || 'engineering',
      primaryVoiceId: activeProject?.primaryVoiceId || activeScene?.voiceId,
      sourceIds: [source.id],
      autoGenerateVisuals: true,
    });
  };

  const handleImportPptxSource = async (formData: FormData, autoGenerate?: boolean) => {
    setBusyAction('import-source');
    setErrorBanner(null);
    try {
      const { source } = await studioApi.importPptxSource(formData);
      setSources((prev) => [source, ...prev]);
      const latestAssets = await studioApi.listAssets();
      setAssets(latestAssets.assets);
      setLastActionSummary(`Imported PPTX "${source.name}" (${source.slides.length} slides)`);
      if (autoGenerate) {
        await handleGenerateFromSource(source);
      }
      return source;
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportNotebookLmSource = async (
    payload: FormData | { name?: string; rawText: string },
    autoGenerate?: boolean
  ) => {
    setBusyAction('import-source');
    setErrorBanner(null);
    try {
      const { source } = await studioApi.importNotebookLmSource(payload);
      setSources((prev) => [source, ...prev]);
      setLastActionSummary(`Imported NotebookLM source "${source.name}" (${source.slides.length} sections)`);
      if (autoGenerate) {
        await handleGenerateFromSource(source);
      }
      return source;
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    await studioApi.deleteSource(sourceId);
    setSources((prev) => prev.filter((s) => s.id !== sourceId));
    setLastActionSummary('Removed imported source');
  };

  const handlePushVoiceToElevenLabs = async (voiceId: string) => {
    setBusyAction(`push-voice-${voiceId}`);
    setErrorBanner(null);
    try {
      const res = await studioApi.pushVoiceToElevenLabs(voiceId, sessionKeys);
      setLastVoicePushResult(res);
      await refreshConnectorsAndVoices(sessionKeys, demoPrefs);
      setLastActionSummary(res.message);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to push voice to ElevenLabs.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleUploadAsset = async (formData: FormData) => {
    setBusyAction('upload-asset');
    try {
      const { asset } = await studioApi.uploadAsset(formData);
      setAssets((prev) => [asset, ...prev]);
      if (activeProject && activeScene) {
        const nextAssetIds = Array.from(new Set([...(activeScene.assetIds || []), asset.id]));
        const updated = await studioApi.updateScene(activeProject.id, activeScene.id, {
          assetIds: nextAssetIds,
        });
        upsertProject(updated.project);
      }
      setLastActionSummary(`Imported asset "${asset.name}" into RAG Context Vault`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteAsset = async (assetId: string) => {
    await studioApi.deleteAsset(assetId);
    setAssets((prev) => prev.filter((a) => a.id !== assetId));
    setLastActionSummary('Removed asset from RAG Context Vault');
  };

  const handleCloneCharacter = async (formData: FormData) => {
    setBusyAction('clone');
    try {
      const { character } = await studioApi.cloneCharacter(formData, sessionKeys);
      setAllCharacters((prev) => [...prev, character]);
      if (activeProject) {
        const projRes = await studioApi.listProjects();
        setProjects(projRes.projects);
      }
      setLastActionSummary(`Cloned character "${character.name}"`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleAddMusicTrack = async (track: Omit<MusicTrack, 'id'>) => {
    if (!activeProject) return;
    const { project } = await studioApi.addMusicTrack(activeProject.id, track);
    upsertProject(project);
    setLastActionSummary(`Added music "${track.title}"`);
  };

  const handleDeleteMusicTrack = async (trackId: string) => {
    if (!activeProject) return;
    const { project } = await studioApi.deleteMusicTrack(activeProject.id, trackId);
    upsertProject(project);
  };

  const handleUpdateConnectorKey = (id: ConnectorId, value: string) => {
    const nextKeys = { ...sessionKeys, [id]: value };
    saveSessionConnectorKeys(nextKeys);
    setSessionKeys(nextKeys);
    void refreshConnectorsAndVoices(nextKeys, demoPrefs);
    setLastActionSummary(`Updated session key for ${id}`);
  };

  const handleToggleDemoFallback = (id: ConnectorId, enabled: boolean) => {
    const nextPrefs = { ...demoPrefs, [id]: enabled };
    saveDemoFallbackPrefs(nextPrefs);
    setDemoPrefs(nextPrefs);
    void refreshConnectorsAndVoices(sessionKeys, nextPrefs);
  };

  const handleClearAllSessionKeys = () => {
    const empty = createEmptySessionConnectorKeys();
    saveSessionConnectorKeys(empty);
    setSessionKeys(empty);
    setTestResults({});
    void refreshConnectorsAndVoices(empty, demoPrefs);
  };

  const handleTestConnector = async (id: ConnectorId) => {
    setTestingId(id);
    try {
      const result = await testConnector(id, sessionKeys, demoPrefs);
      setTestResults((prev) => ({ ...prev, [id]: result }));
      await refreshConnectorsAndVoices(sessionKeys, demoPrefs);
      return result;
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Connector test failed.');
      return undefined;
    } finally {
      setTestingId(null);
    }
  };

  const handleConnectConnector = async (
    id: ConnectorId,
    payload: ConnectConnectorRequest
  ) => {
    const res = await connectConnectorAccount(id, payload, sessionKeys, demoPrefs);
    if (res.result) {
      setTestResults((prev) => ({ ...prev, [id]: res.result }));
    }
    if (res.ok) {
      const nextKeys = { ...sessionKeys, [id]: '' };
      saveSessionConnectorKeys(nextKeys);
      setSessionKeys(nextKeys);

      const { voiceRes } = await refreshConnectorsAndVoices(nextKeys, demoPrefs);
      if (
        id === 'elevenlabs' &&
        voiceRes.source !== 'mock' &&
        voiceRes.voices.length > 0 &&
        activeProject
      ) {
        const firstRealVoice = voiceRes.voices.find((v) => v.source === 'elevenlabs');
        if (firstRealVoice && activeScene?.voiceId.startsWith('mock-')) {
          const updated = await studioApi.updateScene(activeProject.id, activeScene.id, {
            voiceId: firstRealVoice.voice_id,
          });
          upsertProject(updated.project);
        }
        clearVoiceCache();
      }
      setLastActionSummary(res.result.message);
    }
    return { ok: res.ok, error: res.error, result: res.result };
  };

  const handleDisconnectConnector = async (id: ConnectorId) => {
    await disconnectConnectorAccount(id, sessionKeys, demoPrefs);
    const nextKeys = { ...sessionKeys, [id]: '' };
    saveSessionConnectorKeys(nextKeys);
    setSessionKeys(nextKeys);
    setTestResults((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    if (id === 'elevenlabs') {
      clearVoiceCache();
    }
    await refreshConnectorsAndVoices(nextKeys, demoPrefs);
    setLastActionSummary(`Disconnected ${id}`);
  };

  const handleSyncElevenLabsVoices = async () => {
    setBusyAction('sync-voices');
    try {
      clearVoiceCache();
      const { voiceRes } = await refreshConnectorsAndVoices(sessionKeys, demoPrefs);
      setLastActionSummary(
        voiceRes.source === 'mock'
          ? 'Using native & studio voices (connect ElevenLabs for library voices)'
          : `Synced ${voiceRes.voices.length} voices`
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleAssignVoiceToAllScenes = async (voiceId: string) => {
    if (!activeProject) return;
    setBusyAction('assign-voices');
    try {
      const res = await studioApi.setProjectPrimaryVoice(activeProject.id, voiceId, true);
      upsertProject(res.project);
      clearVoiceCache();
      lastSpokenSceneKeyRef.current = null;
      const voiceName = voices.find((v) => v.voice_id === voiceId)?.name || voiceId;
      setLastActionSummary(`Activated "${voiceName}" as explainer voice across all scenes`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestAllConnectors = async () => {
    setTestingId('all');
    try {
      const results = await Promise.all(
        CONNECTOR_IDS.map((id) => testConnector(id, sessionKeys, demoPrefs))
      );
      const map: Partial<Record<ConnectorId, ConnectorTestResult>> = {};
      results.forEach((r) => {
        map[r.connectorId] = r;
      });
      setTestResults(map);
      await refreshConnectorsAndVoices(sessionKeys, demoPrefs);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to test connectors.');
    } finally {
      setTestingId(null);
    }
  };

  if (!activeProject) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#09090d] text-zinc-300 gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
        Loading Calamari Sandwich Studio...
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#09090d] text-zinc-100 overflow-hidden">
      <TopBar
        projects={projects}
        activeProject={activeProject}
        connectors={connectors}
        activeView={activeView}
        onChangeView={setActiveView}
        onSelectProject={(id) => {
          setActiveProjectId(id);
          const nextProj = projects.find((p) => p.id === id);
          setActiveSceneId(nextProj?.scenes[0]?.id || '');
          setCurrentTimeSec(0);
          setIsPlaying(false);
        }}
        onOpenNewProject={() => setShowNewModal(true)}
        onOpenWizard={() => setShowWizardModal(true)}
        onOpenCharacterClone={() => setShowCloneModal(true)}
        onOpenVoiceClone={() => setShowVoiceModal(true)}
        onOpenHistory={() => setShowHistoryDrawer(true)}
        onUndo={() => void handleUndo()}
        onRedo={() => void handleRedo()}
        busy={Boolean(busyAction)}
      />

      {errorBanner && (
        <div className="bg-rose-950/70 border-b border-rose-500/40 px-4 py-1.5 text-xs text-rose-200 flex items-center justify-between">
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-rose-300 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {activeView === 'connectors' ? (
        <ConnectorsWorkspace
          connectors={connectors}
          sessionKeys={sessionKeys}
          demoPrefs={demoPrefs}
          testResults={testResults}
          testingId={testingId}
          onUpdateSessionKey={handleUpdateConnectorKey}
          onToggleDemoFallback={handleToggleDemoFallback}
          onTestConnector={async (id) => {
            await handleTestConnector(id);
          }}
          onTestAllConnectors={handleTestAllConnectors}
          onClearAllSessionKeys={handleClearAllSessionKeys}
          onOpenConnectModal={(id) => setConnectModalId(id)}
          onDisconnectConnector={handleDisconnectConnector}
          onBackToStudio={() => setActiveView('studio')}
        />
      ) : (
        <main className="flex-1 min-h-0 p-3 flex flex-col gap-3 overflow-hidden">
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3 overflow-hidden">
            {/* Center Stage + Director Prompt */}
            <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto pr-0.5">
              <PreviewPlayer
                project={activeProject}
                assets={assets}
                currentTimeSec={currentTimeSec}
                seekEpoch={seekEpoch}
                isPlaying={isPlaying}
                isMuted={isMuted}
                activeSceneId={activeScene?.id || ''}
                activeVoiceSource={activeVoiceSource}
                activeVoiceMode={activeVoiceMode}
                exportingVideo={busyAction === 'export-video'}
                onTogglePlay={() => {
                  unlockAudio();
                  setIsPlaying((p) => !p);
                }}
                onToggleMute={() => setIsMuted((m) => !m)}
                onSeek={(sec) => {
                  lastSpokenSceneKeyRef.current = null;
                  setSeekEpoch((e) => e + 1);
                  setCurrentTimeSec(sec);
                }}
                onSelectScene={(id) => setActiveSceneId(id)}
                onSpeakActiveScene={() => {
                  if (activeScene) {
                    void handlePreviewVoice(
                      activeScene.voiceId,
                      activeScene.narration,
                      activeScene.id
                    );
                  }
                }}
                onDownloadSceneAudio={(sc) => void handleDownloadSceneAudio(sc)}
                onExportSceneVideo={(params) => void handleExportSceneVideo(params)}
              />

              <DirectorPromptBar
                onSubmitPrompt={handleDirectorPrompt}
                lastActionSummary={lastActionSummary}
                lastRagContext={lastRagContext}
                busy={busyAction === 'director'}
              />
            </div>

            {/* Right Inspector */}
            <InspectorPanel
              project={activeProject}
              activeScene={activeScene}
              voices={voices}
              voiceSource={voiceSource}
              connectors={connectors}
              allCharacters={allCharacters}
              assets={assets}
              sources={sources}
              activeTab={inspectorTab}
              onTabChange={setInspectorTab}
              selectedMusicTrackId={selectedMusicTrackId}
              onDragStartPayload={setDraggingPayload}
              onDragEndPayload={() => setDraggingPayload(null)}
              lastVoicePushResult={lastVoicePushResult}
              onUpdateScene={handleUpdateScene}
              onTriggerHiggsfield={handleTriggerHiggsfield}
              onPushSceneToProvider={handlePushSceneToProvider}
              onPreviewVoice={handlePreviewVoice}
              onDownloadSceneAudio={handleDownloadSceneAudio}
              onPlaySampleUrl={handlePlaySampleUrl}
              onUpdateVoice={handleUpdateVoice}
              onDeleteVoice={handleDeleteVoice}
              onPushVoiceToElevenLabs={handlePushVoiceToElevenLabs}
              onSyncElevenLabsVoices={handleSyncElevenLabsVoices}
              onAssignVoiceToAllScenes={handleAssignVoiceToAllScenes}
              onUploadSceneVoiceTake={handleUploadSceneVoiceTake}
              onDeleteSceneVoiceTake={handleDeleteSceneVoiceTake}
              onGenerateSceneVisual={handleGenerateSceneVisual}
              onOpenConnectModal={(id) => setConnectModalId(id)}
              onOpenCharacterClone={() => setShowCloneModal(true)}
              onOpenVoiceClone={() => setShowVoiceModal(true)}
              onOpenAssetUpload={() => setShowAssetModal(true)}
              onOpenSourceImport={() => setShowSourceModal(true)}
              onDeleteSource={handleDeleteSource}
              onGenerateFromSource={handleGenerateFromSource}
              onDeleteAsset={handleDeleteAsset}
              onAddMusicTrack={handleAddMusicTrack}
              onUpdateMusicTrack={handleUpdateMusicTrack}
              onDeleteMusicTrack={handleDeleteMusicTrack}
              busyAction={busyAction}
            />
          </div>

          {/* Bottom 4-Track Timeline */}
          <Timeline
            project={activeProject}
            voices={voices}
            allCharacters={allCharacters}
            currentTimeSec={currentTimeSec}
            activeSceneId={activeScene?.id || ''}
            selectedBlock={selectedTimelineBlock}
            draggingPayload={draggingPayload}
            onSelectBlock={(block, startSec) => {
              setSelectedTimelineBlock(block);
              if (!block) return;
              lastSpokenSceneKeyRef.current = null;
              setSeekEpoch((e) => e + 1);
              if (startSec !== undefined) {
                setCurrentTimeSec(startSec);
              }
              if (block.track === 'music') {
                setSelectedMusicTrackId(block.id);
                setInspectorTab('music');
              } else {
                setSelectedMusicTrackId(null);
                setActiveSceneId(block.id);
                setInspectorTab(
                  block.track === 'character'
                    ? 'characters'
                    : block.track === 'voiceover'
                      ? 'voices'
                      : 'scene'
                );
              }
            }}
            onSeek={(sec) => {
              lastSpokenSceneKeyRef.current = null;
              setSeekEpoch((e) => e + 1);
              setCurrentTimeSec(sec);
            }}
            onUpdateScene={handleUpdateScene}
            onReorderScenes={handleReorderScenes}
            onDeleteScene={handleDeleteScene}
            onUpdateMusicTrack={handleUpdateMusicTrack}
            onDeleteMusicTrack={handleDeleteMusicTrack}
            onDropItem={handleDropOnTimeline}
            onPreviewVoice={handlePreviewVoice}
          />
        </main>
      )}

      <TopicGeneratorModal
        open={showNewModal}
        voices={voices}
        sources={sources}
        activeVoiceId={activeProject.primaryVoiceId || activeScene?.voiceId}
        onClose={() => setShowNewModal(false)}
        onGenerate={handleGenerateProject}
        onOpenSourceImport={() => setShowSourceModal(true)}
        busy={busyAction === 'generate'}
      />

      <ExplainerWizardModal
        open={showWizardModal}
        voices={voices}
        sources={sources}
        assets={assets}
        characters={
          allCharacters.length > 0 ? allCharacters : activeProject.characters
        }
        activeVoiceId={activeProject.primaryVoiceId || activeScene?.voiceId}
        onClose={() => setShowWizardModal(false)}
        onAssemble={handleGenerateProject}
        onCloneVoice={handleCloneVoice}
        onImportPptx={handleImportPptxSource}
        onImportNotebookLm={handleImportNotebookLmSource}
        onPreviewVoice={handlePreviewVoice}
        onOpenCharacterClone={() => setShowCloneModal(true)}
        onAssetCreated={(asset) =>
          setAssets((prev) => [asset, ...prev.filter((a) => a.id !== asset.id)])
        }
        busy={busyAction === 'generate'}
      />

      <CharacterCloningModal
        open={showCloneModal}
        projectId={activeProject.id}
        voices={voices}
        presets={presets}
        onClose={() => setShowCloneModal(false)}
        onCloneSubmit={handleCloneCharacter}
        busy={busyAction === 'clone'}
      />

      <VoiceCloningModal
        open={showVoiceModal}
        projectId={activeProject.id}
        onClose={() => setShowVoiceModal(false)}
        onCloneVoice={handleCloneVoice}
        busy={busyAction === 'clone-voice'}
      />

      <SourceImportModal
        open={showSourceModal}
        onClose={() => setShowSourceModal(false)}
        onImportPptx={handleImportPptxSource}
        onImportNotebookLm={handleImportNotebookLmSource}
        busy={busyAction === 'import-source' || busyAction === 'generate'}
      />

      <AssetUploadModal
        open={showAssetModal}
        onClose={() => setShowAssetModal(false)}
        onUploadAsset={handleUploadAsset}
        busy={busyAction === 'upload-asset'}
      />

      <IterationHistoryDrawer
        open={showHistoryDrawer}
        history={activeProject.history}
        onClose={() => setShowHistoryDrawer(false)}
        onRestore={handleRestoreSnapshot}
      />

      <ProviderConnectModal
        open={connectModalId !== null}
        connector={connectors.find((c) => c.id === connectModalId) || null}
        onClose={() => setConnectModalId(null)}
        onConnect={handleConnectConnector}
        onDisconnect={handleDisconnectConnector}
        onTest={handleTestConnector}
        onSyncVoices={handleSyncElevenLabsVoices}
      />
    </div>
  );
}

export default App;
