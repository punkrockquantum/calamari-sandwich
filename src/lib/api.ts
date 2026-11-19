import type {
  CharacterProfile,
  DirectorPromptResult,
  ExplainerProject,
  GenerateProjectRequest,
  HiggsfieldJobState,
  MusicTrack,
  ProviderStatus,
  PushVoiceElevenLabsResult,
  RagContextMatch,
  SceneItem,
  TechAsset,
  VoiceProfile,
} from '@shared/types';
import {
  buildConnectorHeaders,
  type DemoFallbackPrefs,
  type SessionConnectorKeys,
} from './connectors/registry';

export type { SessionConnectorKeys };

async function requestJson<T>(
  url: string,
  init?: RequestInit,
  keys?: Partial<SessionConnectorKeys>,
  demoPrefs?: Partial<DemoFallbackPrefs>
): Promise<T> {
  const headers: Record<string, string> = {
    ...buildConnectorHeaders(keys, demoPrefs),
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (init?.body && !(init.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(errBody.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const studioApi = {
  getProviderStatus(keys?: Partial<SessionConnectorKeys>) {
    return requestJson<ProviderStatus>('/api/providers/status', undefined, keys);
  },

  listProjects() {
    return requestJson<{ projects: ExplainerProject[] }>('/api/projects');
  },

  getProject(id: string) {
    return requestJson<{ project: ExplainerProject }>(`/api/projects/${encodeURIComponent(id)}`);
  },

  generateProject(payload: GenerateProjectRequest, keys?: Partial<SessionConnectorKeys>) {
    return requestJson<{ project: ExplainerProject }>(
      '/api/projects/generate',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      keys
    );
  },

  updateScene(projectId: string, sceneId: string, patch: Partial<SceneItem>) {
    return requestJson<{ project: ExplainerProject; scene: SceneItem }>(
      `/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }
    );
  },

  addMusicTrack(projectId: string, track: Omit<MusicTrack, 'id'>) {
    return requestJson<{ project: ExplainerProject; track: MusicTrack }>(
      `/api/projects/${encodeURIComponent(projectId)}/music`,
      {
        method: 'POST',
        body: JSON.stringify(track),
      }
    );
  },

  deleteMusicTrack(projectId: string, trackId: string) {
    return requestJson<{ project: ExplainerProject }>(
      `/api/projects/${encodeURIComponent(projectId)}/music/${encodeURIComponent(trackId)}`,
      { method: 'DELETE' }
    );
  },

  runDirectorPrompt(
    projectId: string,
    prompt: string,
    keys?: Partial<SessionConnectorKeys>
  ) {
    return requestJson<DirectorPromptResult>(
      `/api/projects/${encodeURIComponent(projectId)}/director`,
      {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      },
      keys
    );
  },

  undoProject(projectId: string) {
    return requestJson<{ project: ExplainerProject }>(
      `/api/projects/${encodeURIComponent(projectId)}/undo`,
      { method: 'POST' }
    );
  },

  redoProject(projectId: string) {
    return requestJson<{ project: ExplainerProject }>(
      `/api/projects/${encodeURIComponent(projectId)}/redo`,
      { method: 'POST' }
    );
  },

  restoreSnapshot(projectId: string, snapshotId: string) {
    return requestJson<{ project: ExplainerProject }>(
      `/api/projects/${encodeURIComponent(projectId)}/restore/${encodeURIComponent(snapshotId)}`,
      { method: 'POST' }
    );
  },

  listCharacters() {
    return requestJson<{ characters: CharacterProfile[]; presets: CharacterProfile[] }>(
      '/api/characters'
    );
  },

  cloneCharacter(formData: FormData, keys?: Partial<SessionConnectorKeys>) {
    return requestJson<{ character: CharacterProfile }>(
      '/api/characters/clone',
      {
        method: 'POST',
        body: formData,
      },
      keys
    );
  },

  listVoices(keys?: Partial<SessionConnectorKeys>) {
    return requestJson<{
      voices: VoiceProfile[];
      source: 'env' | 'vault' | 'session' | 'mock';
      fallbackReason?: string;
    }>('/api/voices', undefined, keys);
  },

  async synthesizeSpeech(
    params: { voiceId: string; text: string; projectId?: string; sceneId?: string },
    keys?: Partial<SessionConnectorKeys>
  ): Promise<{
    blobUrl: string;
    blob: Blob;
    contentType: string;
    source: string;
    fallbackReason?: string;
  }> {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildConnectorHeaders(keys),
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'TTS failed' }));
      throw new Error(err.error || 'TTS failed');
    }
    const contentType = res.headers.get('content-type') || 'audio/wav';
    const blob = await res.blob();
    return {
      blobUrl: URL.createObjectURL(blob),
      blob,
      contentType,
      source: res.headers.get('X-Voice-Source') || 'mock',
      fallbackReason: res.headers.get('X-Voice-Fallback-Reason') || undefined,
    };
  },

  getProviderVideoProxyUrl(
    projectId: string,
    sceneId: string,
    provider: 'higgsfield' | 'gemini_veo'
  ) {
    return `/api/providers/video-proxy/${encodeURIComponent(projectId)}/${encodeURIComponent(sceneId)}/${encodeURIComponent(provider)}`;
  },

  generateHiggsfieldScene(
    projectId: string,
    sceneId: string,
    keys?: Partial<SessionConnectorKeys>
  ) {
    return requestJson<{ project: ExplainerProject; higgsfield: HiggsfieldJobState }>(
      '/api/higgsfield/generate',
      {
        method: 'POST',
        body: JSON.stringify({ projectId, sceneId }),
      },
      keys
    );
  },

  pollHiggsfieldJob(
    projectId: string,
    sceneId: string,
    keys?: Partial<SessionConnectorKeys>
  ) {
    return requestJson<{ project: ExplainerProject; higgsfield: HiggsfieldJobState }>(
      `/api/higgsfield/jobs/${encodeURIComponent(projectId)}/${encodeURIComponent(sceneId)}`,
      undefined,
      keys
    );
  },

  cloneVoice(formData: FormData) {
    return requestJson<{ voice: VoiceProfile }>('/api/voices/clone', {
      method: 'POST',
      body: formData,
    });
  },

  deleteVoice(voiceId: string) {
    return requestJson<{ deleted: boolean }>(
      `/api/voices/${encodeURIComponent(voiceId)}`,
      { method: 'DELETE' }
    );
  },

  pushVoiceToElevenLabs(voiceId: string, keys?: Partial<SessionConnectorKeys>) {
    return requestJson<PushVoiceElevenLabsResult>(
      `/api/voices/${encodeURIComponent(voiceId)}/push-elevenlabs`,
      { method: 'POST' },
      keys
    );
  },

  listAssets() {
    return requestJson<{ assets: TechAsset[] }>('/api/assets');
  },

  uploadAsset(formData: FormData) {
    return requestJson<{ asset: TechAsset }>('/api/assets', {
      method: 'POST',
      body: formData,
    });
  },

  deleteAsset(assetId: string) {
    return requestJson<{ deleted: boolean }>(
      `/api/assets/${encodeURIComponent(assetId)}`,
      { method: 'DELETE' }
    );
  },

  retrieveRagContext(query: string, projectId?: string, limit = 5) {
    return requestJson<{ matches: RagContextMatch[] }>('/api/assets/retrieve', {
      method: 'POST',
      body: JSON.stringify({ query, projectId, limit }),
    });
  },

  pushSceneToProvider(
    provider: 'higgsfield' | 'gemini_veo',
    projectId: string,
    sceneId: string,
    characterId?: string,
    keys?: Partial<SessionConnectorKeys>
  ) {
    return requestJson<{
      project: ExplainerProject;
      job: HiggsfieldJobState;
      provider: 'higgsfield' | 'gemini_veo';
    }>(
      '/api/providers/push',
      {
        method: 'POST',
        body: JSON.stringify({ provider, projectId, sceneId, characterId }),
      },
      keys
    );
  },

  pollProviderJob(
    projectId: string,
    sceneId: string,
    provider: 'higgsfield' | 'gemini_veo',
    keys?: Partial<SessionConnectorKeys>
  ) {
    return requestJson<{
      project: ExplainerProject;
      job: HiggsfieldJobState;
      provider: 'higgsfield' | 'gemini_veo';
    }>(
      `/api/providers/jobs/${encodeURIComponent(projectId)}/${encodeURIComponent(sceneId)}/${encodeURIComponent(provider)}`,
      undefined,
      keys
    );
  },
};
