import WebSocket, { WebSocketServer as WSServer, Data } from 'ws';
import { logger } from '../utils/logger';
import { TunnelService } from '../services/TunnelService';

export class WebSocketServer {
  private wss: WSServer;
  private tunnelService: TunnelService;

  constructor(port: number, tunnelService: TunnelService) {
    this.wss = new WSServer({ port });
    this.tunnelService = tunnelService;
    this.initialize();
    logger.info(`WebSocket server listening on port ${port}`);
  }

  private initialize(): void {
    this.wss.on('connection', (ws, req) => {
      logger.info(`New WebSocket connection from ${req.socket.remoteAddress}`);

      ws.on('message', (data: Data) => {
        try {
          const message = JSON.parse(data.toString());
          logger.info('Received WebSocket message:', message);

          if (message.type === 'register') {
            this.tunnelService.registerTunnel(message.subdomain, ws);
            logger.info(`Registered tunnel for subdomain: ${message.subdomain}`);
          }
        } catch (err) {
          logger.error('Error processing WebSocket message:', err);
        }
      });

      ws.on('close', () => {
        // Find and remove any tunnels associated with this WebSocket
        const tunnels = this.tunnelService.getTunnels();
        for (const [subdomain, config] of tunnels) {
          if (config.ws === ws) {
            this.tunnelService.removeTunnel(subdomain);
            logger.info(`Removed tunnel for subdomain: ${subdomain}`);
          }
        }
      });

      ws.on('error', (err) => {
        logger.error('WebSocket error:', err);
      });
    });
  }
}
