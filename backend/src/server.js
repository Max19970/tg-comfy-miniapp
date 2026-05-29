import http from 'node:http';
import { createApp } from './app.js';

const { app, runtime, services, logStartup } = await createApp();
const server = http.createServer(app);
services.wsHub.attachUpgrade(server);

function shutdown(signal) {
  console.log(`\n[app] received ${signal}, shutting down...`);
  services.cloudflaredService.stop();
  services.repository.flush().catch((error) => console.error('[storage] final flush failed:', error));
  server.close(() => {
    console.log('[app] backend stopped');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 7000).unref?.();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGHUP', () => shutdown('SIGHUP'));
process.once('uncaughtException', (error) => {
  console.error('[app] uncaught exception', error);
  services.cloudflaredService.stop();
  process.exit(1);
});
process.once('unhandledRejection', (reason) => {
  console.error('[app] unhandled rejection', reason);
  services.cloudflaredService.stop();
  process.exit(1);
});

server.listen(runtime.port, runtime.host, () => {
  logStartup();
  services.cloudflaredService.start();
});
