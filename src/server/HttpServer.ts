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
    private tunnelService: TunnelService,
    private useHttps: boolean = false
  ) {
    this.app = express();
    this.setupExpress();

    if (useHttps && process.env.NODE_ENV === 'production') {
      // In production with HTTPS, use HTTP/2 support via SPDY
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
    } else {
      // HTTP server (for development or HTTP to HTTPS redirect)
      this.server = http.createServer(this.app);
    }

    // Handle server errors
    this.server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${this.port} is already in use`);
        process.exit(1);
      } else {
        logger.error('Server error:', error);
      }
    });

    // Start listening
    this.server.listen(this.port, () => {
      logger.info(`${this.isSecure ? 'HTTPS/HTTP2' : 'HTTP'} server listening on port ${this.port}`);
    });

    // Set up routes after server is initialized
    this.setupRoutes();
  }

  private setupExpress(): void {
    // Enable CORS in development
    if (process.env.NODE_ENV !== 'production') {
      this.app.use(cors());
    }

    // Parse JSON bodies
    this.app.use(express.json());
  }

  private setupRoutes(): void {
    if (!this.isSecure && process.env.NODE_ENV === 'production') {
      // HTTP server in production - redirect all traffic to HTTPS
      this.app.use((req, res) => {
        const host = req.headers.host || '';
        const httpsPort = parseInt(process.env.HTTPS_PORT || '443');
        const targetUrl = `https://${host.split(':')[0]}${httpsPort === 443 ? '' : `:${httpsPort}`}${req.url}`;
        res.redirect(301, targetUrl);
      });
    } else {
      // HTTPS server or development server - handle normal traffic
      this.app.use(async (req, res) => {
        const host = req.headers.host || '';
        const subdomain = host.split('.')[0];
        
        try {
          const tunnel = await this.tunnelService.getTunnel(subdomain);
          if (!tunnel) {
            res.status(404).send('Tunnel not found');
            return;
          }

          // Forward the request to the local service
          await this.tunnelService.proxyRequest(tunnel, req, res);
        } catch (error) {
          logger.error('Error handling request:', error);
          res.status(500).send('Internal Server Error');
        }
      });
    }
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info(`Server on port ${this.port} stopped`);
        resolve();
      });
    });
  }
}