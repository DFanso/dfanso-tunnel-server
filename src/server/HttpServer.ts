// src/server/HttpServer.ts
import express from 'express';
import * as http from 'http';
import * as https from 'https';
import { TunnelService } from '../services/TunnelService';
import { TunnelConfig } from '../types/tunnel';
import { logger } from '../utils/logger';

export class HttpServer {
  private app: express.Application;
  private httpServer: http.Server;
  private httpsServer?: https.Server;
  private tunnelService: TunnelService;

  constructor(tunnelService: TunnelService, sslConfig?: { key: string; cert: string }) {
    this.tunnelService = tunnelService;
    this.app = express();
    this.setupExpress();
    this.httpServer = http.createServer(this.app);
    
    if (sslConfig) {
      this.httpsServer = https.createServer(sslConfig, this.app);
    }
  }

  private setupExpress() {
    this.app.use(express.json());
    
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    // API endpoints for tunnel management
    this.app.get('/api/tunnels', (req, res) => {
      const tunnels = Array.from(this.tunnelService.getTunnels().entries())
        .map(([subdomain, config]) => ({
          subdomain,
          ...config,
        }));
      res.json(tunnels);
    });

    // Redirect HTTP to HTTPS only if HTTPS is enabled
    if (this.httpsServer) {
      this.app.use((req, res, next) => {
        if (!req.secure) {
          return res.redirect(`https://${req.headers.host}${req.url}`);
        }
        next();
      });
    }
  }

  public start(httpPort: number, httpsPort?: number) {
    this.httpServer.listen(httpPort, () => {
      logger.info(`HTTP server listening on port ${httpPort}`);
    });

    if (this.httpsServer && httpsPort) {
      this.httpsServer.listen(httpsPort, () => {
        logger.info(`HTTPS server listening on port ${httpsPort}`);
      });
    }
  }

  public getHttpServer(): http.Server {
    return this.httpServer;
  }

  public getHttpsServer(): https.Server | undefined {
    return this.httpsServer;
  }

  public stop() {
    this.httpServer.close();
    if (this.httpsServer) {
      this.httpsServer.close();
    }
    logger.info('HTTP' + (this.httpsServer ? ' and HTTPS' : '') + ' servers stopped');
  }
}