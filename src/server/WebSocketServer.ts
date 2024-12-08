import WebSocket, { WebSocketServer as WSServer, Data } from 'ws';
import { logger } from '../utils/logger';
import { TunnelService } from '../services/TunnelService';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

export class WebSocketServer {
  private wss: WSServer;

  constructor(private tunnelService: TunnelService) {
    const port = parseInt(process.env.WS_PORT || '8080');

    if (process.env.NODE_ENV === 'production') {
      // In production, use SSL
      const sslDir = process.env.SSL_DIR || './certs';
      const server = https.createServer({
        key: fs.readFileSync(path.join(sslDir, 'privkey.pem')),
        cert: fs.readFileSync(path.join(sslDir, 'fullchain.pem'))
      });

      this.wss = new WSServer({ server });
      server.listen(port);
      logger.info(`WebSocket server (SSL) listening on port ${port}`);
    } else {
      // In development, no SSL
      this.wss = new WSServer({ port });
      logger.info(`WebSocket server listening on port ${port}`);
    }
    this.initialize();
  }

  initialize(): void {
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
