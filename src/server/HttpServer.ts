// src/server/HttpServer.ts
import express from 'express';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { TunnelService } from '../services/TunnelService';
import { TunnelConfig } from '../types/tunnel';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';

export class HttpServer {
  private app: express.Application;
  private server: http.Server | https.Server;

  constructor(
    private port: number,
    private tunnelService: TunnelService
  ) {
    this.app = express();
    this.setupExpress();

    if (process.env.NODE_ENV === 'production') {
      // In production, use HTTPS
      const sslDir = process.env.SSL_DIR || './certs';
      const server = https.createServer({
        key: fs.readFileSync(path.join(sslDir, 'privkey.pem')),
        cert: fs.readFileSync(path.join(sslDir, 'fullchain.pem'))
      }, this.app);
      
      this.server = server;
      server.listen(port, () => {
        logger.info(`HTTPS server listening on port ${port}`);
      });
    } else {
      // In development, use HTTP
      const server = http.createServer(this.app);
      this.server = server;
      server.listen(port, () => {
        logger.info(`HTTP server listening on port ${port}`);
      });
    }
  }

  private setupExpress(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Add CORS headers in development
    if (process.env.NODE_ENV !== 'production') {
      this.app.use(cors());
    }

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.send('OK');
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
      if (!host) {
        return res.status(400).send('No host header');
      }

      let subdomain: string;
      const domain = process.env.DOMAIN || 'localhost';
      const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');

      // Extract subdomain based on environment and host
      if (isLocalhost) {
        // In localhost, use path-based routing
        const urlParts = req.url?.split('/') || [];
        subdomain = urlParts[1] || '';
        if (!subdomain) {
          // Show available tunnels on root path
          const tunnels = this.tunnelService.getTunnels();
          return res.send(`
            <h1>Available Tunnels</h1>
            <ul>
              ${tunnels.map(([name]) => `
                <li><a href="/${name}">${name}</a></li>
              `).join('')}
            </ul>
          `);
        }
        // Modify URL to remove subdomain from path
        req.url = '/' + urlParts.slice(2).join('/');
      } else {
        // For domain access, extract subdomain from hostname
        if (host.endsWith(domain)) {
          subdomain = host.split('.')[0];
          if (!subdomain || subdomain === domain) {
            // Show available tunnels on root domain
            const tunnels = this.tunnelService.getTunnels();
            return res.send(`
              <h1>Available Tunnels</h1>
              <ul>
                ${tunnels.map(([name]) => `
                  <li><a href="${req.protocol}://${name}.${domain}">${name}</a></li>
                `).join('')}
              </ul>
            `);
          }
        } else {
          return res.status(400).send('Invalid domain');
        }
      }

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
          path: req.url,
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
            path: req.url,
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
    if (this.server instanceof https.Server) {
      this.app.use((req, res, next) => {
        if (!req.secure) {
          return res.redirect(`https://${req.headers.host}${req.url}`);
        }
        next();
      });
    }
  }

  public getServer(): http.Server | https.Server {
    return this.server;
  }

  public stop() {
    this.server.close();
    logger.info('Server stopped');
  }
}