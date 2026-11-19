import type {
  ConnectConnectorRequest,
  ConnectConnectorResponse,
  ConnectorDescriptor,
  ConnectorId,
  ConnectorTestResult,
} from '@shared/types';

export type SessionConnectorKeys = Record<ConnectorId, string>;
export type DemoFallbackPrefs = Record<ConnectorId, boolean>;

const STORAGE_KEYS_PREFIX = 'calamari_sandwich_connector_key_';
const STORAGE_DEMO_PREFS = 'calamari_sandwich_demo_prefs';

export const CONNECTOR_IDS: ConnectorId[] = [
  'elevenlabs',
  'higgsfield',
  'character_cloning',
  'script_director_llm',
  'music_soundtrack',
];

export const CONNECTOR_SESSION_HEADERS: Record<ConnectorId, string> = {
  elevenlabs: 'x-elevenlabs-key',
  higgsfield: 'x-higgsfield-key',
  character_cloning: 'x-character-clone-key',
  script_director_llm: 'x-director-llm-key',
  music_soundtrack: 'x-music-key',
};

export function createEmptySessionConnectorKeys(): SessionConnectorKeys {
  return {
    elevenlabs: '',
    higgsfield: '',
    character_cloning: '',
    script_director_llm: '',
    music_soundtrack: '',
  };
}

export function createDefaultDemoPrefs(): DemoFallbackPrefs {
  return {
    elevenlabs: true,
    higgsfield: true,
    character_cloning: true,
    script_director_llm: true,
    music_soundtrack: true,
  };
}

export function loadSessionConnectorKeys(): SessionConnectorKeys {
  const result = createEmptySessionConnectorKeys();
  try {
    for (const id of CONNECTOR_IDS) {
      result[id] = sessionStorage.getItem(`${STORAGE_KEYS_PREFIX}${id}`) || '';
    }
  } catch {
    // Ignore storage unavailability
  }
  return result;
}

export function saveSessionConnectorKeys(keys: SessionConnectorKeys): void {
  try {
    for (const id of CONNECTOR_IDS) {
      const val = keys[id]?.trim();
      if (val) {
        sessionStorage.setItem(`${STORAGE_KEYS_PREFIX}${id}`, val);
      } else {
        sessionStorage.removeItem(`${STORAGE_KEYS_PREFIX}${id}`);
      }
    }
  } catch {
    // Ignore storage unavailability
  }
}

export function loadDemoFallbackPrefs(): DemoFallbackPrefs {
  const defaults = createDefaultDemoPrefs();
  try {
    const raw = sessionStorage.getItem(STORAGE_DEMO_PREFS);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<DemoFallbackPrefs>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function saveDemoFallbackPrefs(prefs: DemoFallbackPrefs): void {
  try {
    sessionStorage.setItem(STORAGE_DEMO_PREFS, JSON.stringify(prefs));
  } catch {
    // Ignore storage unavailability
  }
}

export function buildConnectorHeaders(
  keys?: Partial<SessionConnectorKeys>,
  demoPrefs?: Partial<DemoFallbackPrefs>
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (keys) {
    for (const id of CONNECTOR_IDS) {
      const val = keys[id]?.trim();
      if (val) {
        headers[CONNECTOR_SESSION_HEADERS[id]] = val;
      }
    }
  }
  if (demoPrefs) {
    const disabled = CONNECTOR_IDS.filter((id) => demoPrefs[id] === false);
    if (disabled.length > 0) {
      headers['x-connectors-demo-disabled'] = disabled.join(',');
    }
  }
  return headers;
}

export async function fetchConnectors(
  keys?: Partial<SessionConnectorKeys>,
  demoPrefs?: Partial<DemoFallbackPrefs>
): Promise<ConnectorDescriptor[]> {
  const res = await fetch('/api/connectors', {
    headers: buildConnectorHeaders(keys, demoPrefs),
  });
  if (!res.ok) {
    throw new Error(`Failed to load connectors (${res.status})`);
  }
  const data = (await res.json()) as { connectors: ConnectorDescriptor[] };
  return data.connectors;
}

export async function testConnector(
  id: ConnectorId,
  keys?: Partial<SessionConnectorKeys>,
  demoPrefs?: Partial<DemoFallbackPrefs>
): Promise<ConnectorTestResult> {
  const res = await fetch(`/api/connectors/${encodeURIComponent(id)}/test`, {
    method: 'POST',
    headers: buildConnectorHeaders(keys, demoPrefs),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Connector test failed (${res.status})`);
  }
  return res.json() as Promise<ConnectorTestResult>;
}

export async function connectConnectorAccount(
  id: ConnectorId,
  payload: ConnectConnectorRequest,
  keys?: Partial<SessionConnectorKeys>,
  demoPrefs?: Partial<DemoFallbackPrefs>
): Promise<ConnectConnectorResponse> {
  const res = await fetch(`/api/connectors/${encodeURIComponent(id)}/connect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildConnectorHeaders(keys, demoPrefs),
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({
    ok: false,
    error: `HTTP ${res.status}`,
  }))) as ConnectConnectorResponse;
  if (!res.ok && !data.result) {
    throw new Error(data.error || `Failed to connect (${res.status})`);
  }
  return data;
}

export async function disconnectConnectorAccount(
  id: ConnectorId,
  keys?: Partial<SessionConnectorKeys>,
  demoPrefs?: Partial<DemoFallbackPrefs>
): Promise<ConnectorDescriptor> {
  const res = await fetch(`/api/connectors/${encodeURIComponent(id)}/disconnect`, {
    method: 'POST',
    headers: buildConnectorHeaders(keys, demoPrefs),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Failed to disconnect (${res.status})`);
  }
  const data = (await res.json()) as { ok: boolean; connector: ConnectorDescriptor };
  return data.connector;
}
