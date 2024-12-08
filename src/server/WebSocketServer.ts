import WebSocket, { WebSocketServer as WSServer, Data } from 'ws';
import { logger } from '../utils/logger';
import { TunnelService } from '../services/TunnelService';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

export class WebSocketServer {
  private wss: WSServer;
  private server: http.Server | https.Server;

  constructor(private tunnelService: TunnelService) {
    const port = parseInt(process.env.WS_PORT || '8080');

    if (process.env.NODE_ENV === 'production') {
      // In production, use SSL
      const sslDir = process.env.SSL_DIR || './certs';
      this.server = https.createServer({
        key: fs.readFileSync(path.join(sslDir, 'privkey.pem')),
        cert: fs.readFileSync(path.join(sslDir, 'fullchain.pem'))
      });
    } else {
      // In development, use HTTP
      this.server = http.createServer();
    }

    this.wss = new WSServer({ server: this.server });
    
    // Start listening
    this.server.listen(port, () => {
      logger.info(`WebSocket server${process.env.NODE_ENV === 'production' ? ' (SSL)' : ''} listening on port ${port}`);
    });

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
        logger.info('WebSocket connection closed');
        // Remove any tunnels associated with this connection
        this.tunnelService.removeTunnelsForSocket(ws);
      });

      ws.on('error', (err) => {
        logger.error('WebSocket error:', err);
      });
    });
  }

  public stop(): void {
    this.wss.close();
    this.server.close();
  }
}
