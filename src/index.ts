// src/index.ts
import 'dotenv/config';
import { SSLService } from './services/SSLService';
import { TunnelService } from './services/TunnelService';
import { HttpServer } from './server/HttpServer';
import { WebSocketServer } from './server/WebSocketServer';
import { logger } from './utils/logger';

async function main() {
  try {
    const {
      DOMAIN = 'dfanso.dev',
      EMAIL = 'leogavin123@outlook.com',
      HTTP_PORT = '3000',
      HTTPS_PORT = '3001',
      WS_PORT = '8080',
      SSL_DIR = './certs',
      NODE_ENV = 'development'
    } = process.env;

    let sslConfig: { key: string; cert: string; } | undefined;
    if (NODE_ENV === 'production') {
      // Initialize SSL only in production
      logger.info('Initializing SSL certificates...');
      const sslService = new SSLService(DOMAIN, EMAIL, SSL_DIR);
      sslConfig = await sslService.initialize();

      // Schedule certificate renewal
      sslService.scheduleRenewal();
    } else {
      logger.info('Running in development mode without SSL');
      sslConfig = undefined;
    }

    // Initialize tunnel service
    const tunnelService = new TunnelService(sslConfig);

    // Start HTTP/HTTPS server
    const httpServer = new HttpServer(tunnelService, sslConfig);
    httpServer.start(
      parseInt(HTTP_PORT),
      sslConfig ? parseInt(HTTPS_PORT) : undefined
    );

    // Start WebSocket server for tunnel clients
    const wsServer = new WebSocketServer(
      httpServer.getHttpServer(),
      tunnelService
    );

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      httpServer.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    logger.info(`Tunnel server started successfully in ${NODE_ENV} mode`);
    logger.info(`Domain: ${DOMAIN}`);
    logger.info(`HTTP Port: ${HTTP_PORT}`);
    if (sslConfig) {
      logger.info(`HTTPS Port: ${HTTPS_PORT}`);
    }
    logger.info(`WebSocket Port: ${WS_PORT}`);
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

main();