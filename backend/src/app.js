import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { config } from './config.js';
import { registerHandlers } from './handlers.js';
import { Store } from './store.js';

const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));

// doesn't call listen() so the tests can pick their own port
export function createApp(overrides = {}) {
  const settings = { ...config, ...overrides };
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    pingInterval: settings.pingIntervalMs,
    pingTimeout: settings.pingTimeoutMs,
  });
  const store = new Store();
  registerHandlers(io, store, settings);

  app.get('/health', (req, res) => {
    res.json({ ok: true, users: store.users.size, calls: store.calls.size, waiting: store.queue.length });
  });

  // serve the react build if it exists (npm run build)
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile('index.html', { root: clientDist }) : next()));
  }

  return { app, httpServer, io, store };
}
