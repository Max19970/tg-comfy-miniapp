import { WebSocket, WebSocketServer } from 'ws';
import { validateTelegramInitData } from '../telegram/auth.js';

export class JobWebSocketHub {
  constructor({ config, repository, publicJob }) {
    this.config = config;
    this.repository = repository;
    this.publicJob = publicJob;
    this.wsServer = new WebSocketServer({ noServer: true });
    this.subscribers = new Map();

    this.wsServer.on('connection', async (ws) => {
      const jobId = ws.jobId;
      if (!this.subscribers.has(jobId)) this.subscribers.set(jobId, new Set());
      this.subscribers.get(jobId).add(ws);

      const dbItem = await this.repository.getGeneration(jobId, ws.user.id);
      if (dbItem && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'job', job: this.publicJob(dbItem) }));

      ws.on('close', () => {
        const clients = this.subscribers.get(jobId);
        if (!clients) return;
        clients.delete(ws);
        if (!clients.size) this.subscribers.delete(jobId);
      });
    });
  }

  attachUpgrade(server) {
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname !== '/api/ws') return socket.destroy();

      try {
        const user = this.config.telegram?.enforceAuth
          ? validateTelegramInitData(url.searchParams.get('initData'), this.config)
          : { id: 'dev' };
        const jobId = url.searchParams.get('jobId');
        if (!jobId) throw new Error('jobId is missing');

        this.wsServer.handleUpgrade(request, socket, head, (ws) => {
          ws.user = user;
          ws.jobId = jobId;
          this.wsServer.emit('connection', ws, request);
        });
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      }
    });
  }

  broadcast(jobId, payload) {
    const clients = this.subscribers.get(jobId);
    if (!clients) return;
    const message = JSON.stringify(payload);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  }
}
