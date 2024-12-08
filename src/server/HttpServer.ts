// src/server/HttpServer.ts
import express from 'express';
import * as http from 'http';
import * as https from 'https';
import { TunnelService } from '../services/TunnelService';
import { TunnelConfig } from '../types/tunnel';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

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
      const tunnels = this.tunnelService.getTunnels()
        .map(([_, config]) => config);
      res.json(tunnels);
    });

    // Handle tunnel requests
    this.app.use(async (req, res) => {
      const host = req.headers.host;
      logger.info(`Incoming request - Host: ${host}, URL: ${req.url}`);

      if (!host) {
        logger.warn('No host header in request');
        return res.status(400).send('No host header');
      }

      // Extract subdomain and remaining path
      const urlParts = req.url?.split('/') || [];
      const subdomain = urlParts[1] || '';
      const remainingPath = '/' + urlParts.slice(2).join('/');

      // Find tunnel for subdomain
      const tunnel = this.tunnelService.getTunnel(subdomain);
      if (!tunnel) {
        const tunnels = this.tunnelService.getTunnels();
        const tunnelList = tunnels.map(([domain]) => domain).join(', ');
        return res.status(404).send(`Tunnel "${subdomain}" not found. Available tunnels: ${tunnelList}`);
      }

      try {
        const clientId = uuidv4();
        const connection = this.tunnelService.registerConnection(clientId, tunnel.ws);

        // Forward the request through the tunnel
        tunnel.ws.send(JSON.stringify({
          type: 'connection',
          clientId,
          method: req.method,
          path: remainingPath,
          headers: req.headers,
          body: ''  // Will be populated later
        }));

        // Set timeout for tunnel response
        const timeout = setTimeout(() => {
          res.status(504).send('Tunnel timeout');
          this.tunnelService.removeConnection(clientId);
        }, 30000);

        // Handle response from tunnel
        let responseStarted = false;
        let responseHeaders: Record<string, string> = {};

        connection.ws.on('message', (data: Buffer | string) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.type === 'ready' && message.clientId === connection.clientId) {
              // Headers received, start response
              responseHeaders = message.headers || {};
              res.writeHead(message.statusCode || 200, responseHeaders);
              responseStarted = true;
            } else if (message.type === 'data' && message.clientId === connection.clientId) {
              clearTimeout(timeout);
              if (!responseStarted) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                responseStarted = true;
              }
              res.write(Buffer.from(message.data, 'base64'));
            } else if (message.type === 'end' && message.clientId === connection.clientId) {
              res.end();
              this.tunnelService.removeConnection(connection.clientId);
            } else if (message.type === 'error' && message.clientId === connection.clientId) {
              if (!responseStarted) {
                res.status(502).send(`Tunnel error: ${message.error}`);
                responseStarted = true;
              }
              this.tunnelService.removeConnection(connection.clientId);
            }
          } catch (err) {
            logger.error('Error handling tunnel response:', err);
            if (!responseStarted) {
              res.status(500).send('Error processing tunnel response');
            } else {
              res.end();
            }
            this.tunnelService.removeConnection(connection.clientId);
          }
        });

        // Handle request body if any
        let requestBody = '';
        req.on('data', chunk => {
          requestBody += chunk;
        });

        req.on('end', () => {
          tunnel.ws.send(JSON.stringify({
            type: 'connection',
            clientId: connection.clientId,
            method: req.method,
            path: remainingPath,
            headers: req.headers,
            body: requestBody
          }));
        });

      } catch (err) {
        logger.error('Error handling tunnel request:', err);
        res.status(500).send('Internal server error');
      }
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