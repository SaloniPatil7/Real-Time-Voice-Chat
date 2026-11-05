import { createApp } from './app.js';
import { config } from './config.js';

const { httpServer, io } = createApp();

httpServer.listen(config.port, () => {
  console.log(`[voice-chat] server listening on http://localhost:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    io.close();
    httpServer.close(() => process.exit(0));
  });
}
