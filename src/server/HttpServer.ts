import express from 'express';
import * as http from 'http';
import * as https from 'https';
import * as spdy from 'spdy';
import * as fs from 'fs';
import * as path from 'path';
import { TunnelService } from '../services/TunnelService';
import { TunnelConfig } from '../types/tunnel';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';

export class HttpServer {
  private app: express.Application;
  private server: http.Server | spdy.Server;
  private isSecure: boolean = false;

  constructor(
    private port: number,
    private tunnelService: TunnelService
  ) {
    this.app = express();
    this.setupExpress();

    if (process.env.NODE_ENV === 'production') {
      // In production, use HTTPS with HTTP/2 support via SPDY
      const sslDir = process.env.SSL_DIR || './certs';
      const options: spdy.ServerOptions = {
        key: fs.readFileSync(path.join(sslDir, 'privkey.pem')),
        cert: fs.readFileSync(path.join(sslDir, 'fullchain.pem')),
        spdy: {
          protocols: ['h2', 'spdy/3.1', 'http/1.1'],
          plain: false
        }
      };
      
      this.server = spdy.createServer(options, this.app);
      this.isSecure = true;
      this.server.listen(port, () => {
        logger.info(`HTTPS/HTTP2 server listening on port ${port}`);
      });
    } else {
      // In development, use HTTP
      const server = http.createServer(this.app);
      this.server = server;
      server.listen(port, () => {
        logger.info(`HTTP server listening on port ${port}`);
      });
    }

    // Add HTTPS redirect after server is initialized
    if (this.isSecure) {
      this.app.use((req, res, next) => {
        if (!req.secure) {
          return res.redirect(`https://${req.headers.host}${req.url}`);
        }
        next();
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
      // Set proper headers for HTTP response
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Connection', 'keep-alive');
      
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

        connection.ws.on('message', (data: Buffer | string) => {
          try {
            const message = JSON.parse(data.toString());

            switch (message.type) {
              case 'ready':
                if (!responseStarted) {
                  responseStarted = true;
                  clearTimeout(timeout);
                  res.writeHead(message.statusCode, message.headers);
                }
                break;

              case 'data':
                if (responseStarted) {
                  const chunk = Buffer.from(message.data, 'base64');
                  res.write(chunk);
                }
                break;

              case 'end':
                if (responseStarted) {
                  res.end();
                  this.tunnelService.removeConnection(clientId);
                }
                break;

              case 'error':
                if (!responseStarted) {
                  responseStarted = true;
                  clearTimeout(timeout);
                  res.status(502).send(`Tunnel error: ${message.error}`);
                  this.tunnelService.removeConnection(clientId);
                }
                break;
            }
          } catch (err) {
            logger.error('Error processing tunnel response:', err);
            if (!responseStarted) {
              responseStarted = true;
              clearTimeout(timeout);
              res.status(502).send('Invalid tunnel response');
              this.tunnelService.removeConnection(clientId);
            }
          }
        });

      } catch (err) {
        logger.error('Error handling tunnel request:', err);
        return res.status(502).send('Tunnel error');
      }
    });

    // Redirect HTTP to HTTPS only if HTTPS is enabled
    // Removed this block as it's now handled in the constructor
  }

  public getServer(): http.Server | spdy.Server {
    return this.server;
  }

  public stop() {
    this.server.close();
  }
}