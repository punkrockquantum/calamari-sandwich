import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type {
  CharacterProfile,
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
  createEmptySessionConnectorKeys,
  fetchConnectors,
  loadDemoFallbackPrefs,
  loadSessionConnectorKeys,
  saveDemoFallbackPrefs,
  saveSessionConnectorKeys,
  testConnector,
  type DemoFallbackPrefs,
  type SessionConnectorKeys,
} from '@/lib/connectors/registry';
import { playVoiceBlobUrl, startAmbientBed, stopAllAudio } from '@/lib/audioEngine';
import { CharacterCloningModal } from '@/components/CharacterCloningModal';
import { ConnectorsWorkspace } from '@/components/ConnectorsWorkspace';
import { DirectorPromptBar } from '@/components/DirectorPromptBar';
import { InspectorPanel } from '@/components/InspectorPanel';
import { IterationHistoryDrawer } from '@/components/IterationHistoryDrawer';
import { MultiTrackTimeline } from '@/components/MultiTrackTimeline';
import { PreviewPlayer } from '@/components/PreviewPlayer';
import { TopBar, type WorkspaceView } from '@/components/TopBar';
import { TopicGeneratorModal } from '@/components/TopicGeneratorModal';

export function App() {
  const [projects, setProjects] = useState<ExplainerProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [activeSceneId, setActiveSceneId] = useState<string>('');
  const [activeView, setActiveView] = useState<WorkspaceView>('studio');

  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [voiceSource, setVoiceSource] = useState<'env' | 'session' | 'mock'>('mock');
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

  const [showNewModal, setShowNewModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastActionSummary, setLastActionSummary] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const ambientStopRef = useRef<(() => void) | null>(null);

  const refreshConnectorsAndVoices = useCallback(
    async (keys: SessionConnectorKeys, prefs: DemoFallbackPrefs) => {
      const [connectorList, voiceRes] = await Promise.all([
        fetchConnectors(keys, prefs),
        studioApi.listVoices(keys),
      ]);
      setConnectors(connectorList);
      setVoices(voiceRes.voices);
      setVoiceSource(voiceRes.source);
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
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Connector test failed.');
    } finally {
      setTestingId(null);
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
          onTestConnector={handleTestConnector}
          onTestAllConnectors={handleTestAllConnectors}
          onClearAllSessionKeys={handleClearAllSessionKeys}
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
                onTogglePlay={() => setIsPlaying((p) => !p)}
                onToggleMute={() => setIsMuted((m) => !m)}
                onSeek={(sec) => setCurrentTimeSec(sec)}
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
              allCharacters={allCharacters}
              onUpdateScene={handleUpdateScene}
              onTriggerHiggsfield={handleTriggerHiggsfield}
              onPreviewVoice={handlePreviewVoice}
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
    </div>
  );
}

export default App;
