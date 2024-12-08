import { Server as HttpServer } from 'http';
import WebSocket, { WebSocketServer as WSServer } from 'ws';
import { logger } from '../utils/logger';
import { TunnelService } from '../services/TunnelService';

export class WebSocketServer {
  private wss: WSServer;
  private tunnelService: TunnelService;

  constructor(server: HttpServer, tunnelService: TunnelService) {
    this.wss = new WSServer({ server });
    this.tunnelService = tunnelService;
    this.initialize();
  }

  private initialize(): void {
    this.wss.on('connection', (ws, req) => {
      logger.info(`New WebSocket connection from ${req.socket.remoteAddress}`);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleMessage(ws, data);
        } catch (err) {
          logger.error('Failed to parse WebSocket message:', err);
          ws.send(JSON.stringify({ error: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        logger.info(`WebSocket connection closed from ${req.socket.remoteAddress}`);
      });

      ws.on('error', (err) => {
        logger.error('WebSocket error:', err);
      });
    });
  }

  private handleMessage(ws: WebSocket, message: any): void {
    // Handle different message types here
    logger.info('Received message:', message);
  }
}
