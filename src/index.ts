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
  let httpServer: HttpServer | undefined;
  let httpsServer: HttpServer | undefined;
  let wsServer: WebSocketServer | undefined;

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
    const httpPort = parseInt(process.env.HTTP_PORT || '80');
    const httpsPort = parseInt(process.env.HTTPS_PORT || '443');

    logger.info(`Environment: ${process.env.NODE_ENV}`);
    logger.info(`Domain: ${process.env.DOMAIN || 'localhost'}`);

    // Initialize WebSocket server first
    wsServer = new WebSocketServer(tunnelService);
    
    // Initialize HTTP/HTTPS servers
    if (process.env.NODE_ENV === 'production') {
      // In production, create both HTTP (for redirect) and HTTPS servers
      httpServer = new HttpServer(httpPort, tunnelService, false); // HTTP server for redirects
      httpsServer = new HttpServer(httpsPort, tunnelService, true); // HTTPS server for main traffic
    } else {
      // In development, just create HTTP server
      httpServer = new HttpServer(httpPort, tunnelService, false);
    }

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down servers...');
      
      const shutdownPromises: Promise<void>[] = [];
      
      if (wsServer) {
        shutdownPromises.push(wsServer.stop());
      }
      
      if (httpServer) {
        shutdownPromises.push(httpServer.stop());
      }
      
      if (httpsServer) {
        shutdownPromises.push(httpsServer.stop());
      }

      try {
        await Promise.all(shutdownPromises);
        logger.info('All servers stopped successfully');
      } catch (error) {
        logger.error('Error during shutdown:', error);
      }

      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();