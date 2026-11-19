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
  MusicTrack,
  SceneItem,
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
  playVoiceBlobUrl,
  startAmbientBed,
  stopAllAudio,
  stopVoiceAudio,
} from '@/lib/audioEngine';
import { CharacterCloningModal } from '@/components/CharacterCloningModal';
import { ConnectorsWorkspace } from '@/components/ConnectorsWorkspace';
import { DirectorPromptBar } from '@/components/DirectorPromptBar';
import { InspectorPanel } from '@/components/InspectorPanel';
import { IterationHistoryDrawer } from '@/components/IterationHistoryDrawer';
import { MultiTrackTimeline } from '@/components/MultiTrackTimeline';
import { PreviewPlayer } from '@/components/PreviewPlayer';
import { ProviderConnectModal } from '@/components/ProviderConnectModal';
import { TopBar, type WorkspaceView } from '@/components/TopBar';
import { TopicGeneratorModal } from '@/components/TopicGeneratorModal';

export function App() {
  const [projects, setProjects] = useState<ExplainerProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [activeSceneId, setActiveSceneId] = useState<string>('');
  const [activeView, setActiveView] = useState<WorkspaceView>('studio');

  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [voiceSource, setVoiceSource] = useState<'env' | 'vault' | 'session' | 'mock'>('mock');
  const [allCharacters, setAllCharacters] = useState<CharacterProfile[]>([]);
  const [presets, setPresets] = useState<CharacterProfile[]>([]);

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
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [activeVoiceSource, setActiveVoiceSource] = useState<'elevenlabs' | 'mock' | null>(null);

  const [showNewModal, setShowNewModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [connectModalId, setConnectModalId] = useState<ConnectorId | null>(null);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastActionSummary, setLastActionSummary] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const ambientStopRef = useRef<(() => void) | null>(null);
  const voiceCacheRef = useRef<
    Map<string, { blobUrl: string; source: 'elevenlabs' | 'mock' }>
  >(new Map());
  const lastSpokenSceneKeyRef = useRef<string | null>(null);

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

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [projRes, charRes] = await Promise.all([
          studioApi.listProjects(),
          studioApi.listCharacters(),
        ]);
        if (!mounted) return;
        setProjects(projRes.projects);
        setAllCharacters(charRes.characters);
        setPresets(charRes.presets);
        if (projRes.projects[0]) {
          setActiveProjectId(projRes.projects[0].id);
          setActiveSceneId(projRes.projects[0].scenes[0]?.id || '');
        }
        await refreshConnectorsAndVoices(sessionKeys, demoPrefs);
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

  // Playback ticker
  useEffect(() => {
    if (!isPlaying || totalDurationSec <= 0) {
      if (ambientStopRef.current) {
        ambientStopRef.current();
        ambientStopRef.current = null;
      }
      return;
    }

    if (!isMuted && activeProject?.musicTracks[0]) {
      ambientStopRef.current = startAmbientBed(
        activeProject.musicTracks[0].bpm,
        activeProject.musicTracks[0].volumeDb
      );
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
  }, [isPlaying, isMuted, totalDurationSec, activeProject]);

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

  // Real ElevenLabs / fallback voiceover playback synchronized with timeline playback
  useEffect(() => {
    if (!isPlaying || isMuted || !activeProject || !activeScene) {
      stopVoiceAudio();
      lastSpokenSceneKeyRef.current = null;
      if (!isPlaying || isMuted) {
        setActiveVoiceSource(null);
      }
      return;
    }

    const spokenKey = `${activeScene.id}:${activeScene.voiceId}:${activeScene.narration}`;
    if (lastSpokenSceneKeyRef.current === spokenKey) {
      return;
    }
    lastSpokenSceneKeyRef.current = spokenKey;

    let sceneStartSec = 0;
    for (const sc of activeProject.scenes) {
      if (sc.id === activeScene.id) break;
      sceneStartSec += sc.durationSec;
    }
    const localOffsetSec = Math.max(0, currentTimeSec - sceneStartSec);
    let cancelled = false;

    const cached = voiceCacheRef.current.get(spokenKey);
    if (cached) {
      setActiveVoiceSource(cached.source);
      void playVoiceBlobUrl(cached.blobUrl, 0.9, localOffsetSec);
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
          },
          sessionKeys
        );
        if (cancelled) return;
        const normalizedSource = res.source === 'elevenlabs' ? 'elevenlabs' : 'mock';
        voiceCacheRef.current.set(spokenKey, {
          blobUrl: res.blobUrl,
          source: normalizedSource,
        });
        setActiveVoiceSource(normalizedSource);
        await playVoiceBlobUrl(res.blobUrl, 0.9, localOffsetSec);
      } catch {
        if (!cancelled) {
          setActiveVoiceSource(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isPlaying, isMuted, activeProject, activeScene, currentTimeSec, sessionKeys]);

  // Poll queued / generating Higgsfield render jobs until ready or failed
  const pendingHiggsfieldSceneIds = useMemo(() => {
    if (!activeProject) return [];
    return activeProject.scenes
      .filter(
        (sc) =>
          sc.higgsfield.provider === 'higgsfield' &&
          (sc.higgsfield.status === 'queued' ||
            sc.higgsfield.status === 'generating' ||
            sc.higgsfield.status === 'rendering')
      )
      .map((sc) => sc.id);
  }, [activeProject]);

  useEffect(() => {
    if (!activeProject || pendingHiggsfieldSceneIds.length === 0) return;
    let cancelled = false;
    const projectId = activeProject.id;

    const timer = window.setInterval(() => {
      void (async () => {
        for (const scId of pendingHiggsfieldSceneIds) {
          if (cancelled) return;
          try {
            const res = await studioApi.pollHiggsfieldJob(projectId, scId, sessionKeys);
            if (!cancelled) {
              upsertProject(res.project);
              if (res.higgsfield.status === 'ready') {
                setLastActionSummary(`Higgsfield video ready for scene`);
              } else if (res.higgsfield.status === 'failed') {
                setErrorBanner(res.higgsfield.errorMessage || 'Higgsfield generation failed.');
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
  }, [activeProject, pendingHiggsfieldSceneIds, sessionKeys]);

  const handleGenerateProject = async (payload: GenerateProjectRequest) => {
    setBusyAction('generate');
    setErrorBanner(null);
    try {
      const { project } = await studioApi.generateProject(payload, sessionKeys);
      upsertProject(project);
      setCurrentTimeSec(0);
      setIsPlaying(false);
      setActiveSceneId(project.scenes[0]?.id || '');
      setActiveView('studio');
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

  const handleUpdateScene = async (sceneId: string, patch: Partial<SceneItem>) => {
    if (!activeProject) return;
    try {
      const { project } = await studioApi.updateScene(activeProject.id, sceneId, patch);
      upsertProject(project);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Scene update failed.');
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

  const handlePreviewVoice = async (
    voiceId: string,
    sampleText?: string,
    sceneId?: string
  ) => {
    if (!activeProject) return;
    setBusyAction('tts');
    try {
      const res = await studioApi.synthesizeSpeech(
        {
          voiceId,
          text: sampleText || activeScene?.narration || 'Calamari Sandwich narration check.',
          projectId: activeProject.id,
          sceneId,
        },
        sessionKeys
      );
      if (!isMuted) {
        await playVoiceBlobUrl(res.blobUrl);
      }
      if (sceneId) {
        const refreshed = await studioApi.listProjects();
        setProjects(refreshed.projects);
      }
      setLastActionSummary(
        res.source === 'elevenlabs'
          ? 'Synthesized ElevenLabs voiceover'
          : 'Played studio fallback voiceover'
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Voice synthesis failed.');
    } finally {
      setBusyAction(null);
    }
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
      // Clear temporary session key override so the persisted local vault takes precedence
      const nextKeys = { ...sessionKeys, [id]: '' };
      saveSessionConnectorKeys(nextKeys);
      setSessionKeys(nextKeys);

      const { voiceRes } = await refreshConnectorsAndVoices(nextKeys, demoPrefs);
      if (id === 'elevenlabs' && voiceRes.source !== 'mock' && voiceRes.voices.length > 0 && activeProject) {
        const firstRealVoice = voiceRes.voices.find((v) => v.source === 'elevenlabs');
        if (firstRealVoice && activeScene?.voiceId.startsWith('mock-')) {
          const updated = await studioApi.updateScene(activeProject.id, activeScene.id, {
            voiceId: firstRealVoice.voice_id,
          });
          upsertProject(updated.project);
        }
        voiceCacheRef.current.clear();
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
      voiceCacheRef.current.clear();
    }
    await refreshConnectorsAndVoices(nextKeys, demoPrefs);
    setLastActionSummary(`Disconnected ${id}`);
  };

  const handleSyncElevenLabsVoices = async () => {
    setBusyAction('sync-voices');
    try {
      voiceCacheRef.current.clear();
      const { voiceRes } = await refreshConnectorsAndVoices(sessionKeys, demoPrefs);
      setLastActionSummary(
        voiceRes.source === 'mock'
          ? 'Using studio demo voices (connect ElevenLabs for library voices)'
          : `Synced ${voiceRes.voices.length} ElevenLabs voices`
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleAssignVoiceToAllScenes = async (voiceId: string) => {
    if (!activeProject) return;
    setBusyAction('assign-voices');
    try {
      let latestProject = activeProject;
      for (const sc of activeProject.scenes) {
        if (sc.voiceId !== voiceId) {
          const res = await studioApi.updateScene(activeProject.id, sc.id, { voiceId });
          latestProject = res.project;
        }
      }
      upsertProject(latestProject);
      voiceCacheRef.current.clear();
      setLastActionSummary('Applied selected voice to all scenes');
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
        onOpenCharacterClone={() => setShowCloneModal(true)}
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
                currentTimeSec={currentTimeSec}
                isPlaying={isPlaying}
                isMuted={isMuted}
                activeSceneId={activeScene?.id || ''}
                activeVoiceSource={activeVoiceSource}
                onTogglePlay={() => setIsPlaying((p) => !p)}
                onToggleMute={() => setIsMuted((m) => !m)}
                onSeek={(sec) => {
                  lastSpokenSceneKeyRef.current = null;
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
              />

              <DirectorPromptBar
                onSubmitPrompt={handleDirectorPrompt}
                lastActionSummary={lastActionSummary}
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
              onUpdateScene={handleUpdateScene}
              onTriggerHiggsfield={handleTriggerHiggsfield}
              onPreviewVoice={handlePreviewVoice}
              onSyncElevenLabsVoices={handleSyncElevenLabsVoices}
              onAssignVoiceToAllScenes={handleAssignVoiceToAllScenes}
              onOpenConnectModal={(id) => setConnectModalId(id)}
              onOpenCharacterClone={() => setShowCloneModal(true)}
              onAddMusicTrack={handleAddMusicTrack}
              onDeleteMusicTrack={handleDeleteMusicTrack}
              busyAction={busyAction}
            />
          </div>

          {/* Bottom 4-Track Timeline */}
          <MultiTrackTimeline
            project={activeProject}
            currentTimeSec={currentTimeSec}
            activeSceneId={activeScene?.id || ''}
            onSelectScene={(sceneId, startSec) => {
              setActiveSceneId(sceneId);
              setCurrentTimeSec(startSec);
            }}
            onSeek={(sec) => setCurrentTimeSec(sec)}
          />
        </main>
      )}

      <TopicGeneratorModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        onGenerate={handleGenerateProject}
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
