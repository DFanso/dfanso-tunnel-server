// src/index.ts
import { config } from 'dotenv';
import { HttpServer } from './server/HttpServer';
import { WebSocketServer } from './server/WebSocketServer';
import { TunnelService } from './services/TunnelService';
import { logger } from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
config();

async function main() {
  try {
    let sslConfig: { key: Buffer; cert: Buffer } | undefined;

    if (process.env.NODE_ENV === 'production') {
      // In production, load SSL certificates
      const sslDir = process.env.SSL_DIR || './certs';
      logger.info(`Loading SSL certificates from ${sslDir}`);

      try {
        sslConfig = {
          key: fs.readFileSync(path.join(sslDir, 'privkey.pem')),
          cert: fs.readFileSync(path.join(sslDir, 'fullchain.pem'))
        };
        logger.info('SSL certificates loaded successfully');
      } catch (err) {
        logger.error('Failed to load SSL certificates:', err);
        process.exit(1);
      }
    }

    // Initialize services
    const tunnelService = new TunnelService(sslConfig);
    const wsPort = parseInt(process.env.WS_PORT || '8080');
    const httpPort = parseInt(process.env.HTTP_PORT || '3000');

    // Initialize servers
    const wsServer = new WebSocketServer(tunnelService);
    const httpServer = new HttpServer(httpPort, tunnelService);

    logger.info(`Environment: ${process.env.NODE_ENV}`);
    logger.info(`Domain: ${process.env.DOMAIN || 'localhost'}`);
    logger.info(`HTTP${process.env.NODE_ENV === 'production' ? 'S' : ''} server listening on port ${httpPort}`);
    logger.info(`WebSocket${process.env.NODE_ENV === 'production' ? ' (SSL)' : ''} server listening on port ${wsPort}`);

    // Handle graceful shutdown
    const shutdown = () => {
      logger.info('Shutting down servers...');
      httpServer.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

main();