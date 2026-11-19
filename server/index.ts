import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import cors from 'cors';
import express from 'express';
import { createApiRouter } from './routes/api.js';
import { AssetLibrary } from './store/assetLibrary.js';
import { CredentialVault } from './store/credentialVault.js';
import { ProjectStore } from './store/projectStore.js';
import { VoiceStore } from './store/voiceStore.js';

export interface CreateAppOptions {
  dataDir?: string;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const store = new ProjectStore(options.dataDir);
  const vault = new CredentialVault(options.dataDir);
  const voiceStore = new VoiceStore(options.dataDir);
  const assetLibrary = new AssetLibrary(options.dataDir);

  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  app.use('/api', createApiRouter(store, vault, voiceStore, assetLibrary));
  app.use('/uploads', express.static(store.getUploadsDir()));

  const clientDistDir = path.resolve(process.cwd(), 'dist/client');
  if (fs.existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir));
    app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
      res.sendFile(path.join(clientDistDir, 'index.html'));
    });
  }

  return { app, store, vault, voiceStore, assetLibrary };
}

function resolveRealPath(filePath: string): string {
  try {
    return fs.realpathSync(path.resolve(filePath));
  } catch {
    return path.resolve(filePath);
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(resolveRealPath(process.argv[1])).href;

if (isDirectRun) {
  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST?.trim();
  const { app, store, voiceStore, assetLibrary } = createApp();
  Promise.all([
    store.ensureInitialized(),
    voiceStore.ensureInitialized(),
    assetLibrary.ensureInitialized(),
  ])
    .then(() => {
      const onListen = () => {
        console.log(
          `Calamari Sandwich Studio API listening on http://${host || 'localhost'}:${port}`
        );
      };
      if (host) {
        app.listen(port, host, onListen);
      } else {
        app.listen(port, onListen);
      }
    })
    .catch((err) => {
      console.error('Failed to initialize stores:', err);
      process.exit(1);
    });
}
