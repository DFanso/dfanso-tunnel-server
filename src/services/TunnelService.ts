import { EventEmitter } from 'events';
import * as net from 'net';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { TunnelConfig } from '../types/tunnel';
import { IncomingMessage, ServerResponse } from 'http';
import { ProxyService } from './ProxyService';
import zlib from 'zlib';
import { promisify } from 'util';
import * as http from 'http';
const httpProxy = require('http-proxy');

interface Connection {
  clientId: string;
  ws: WebSocket;
  localPort: number;
  ready: boolean;
}

export class TunnelService extends EventEmitter {
  private tunnels: Map<string, TunnelConfig> = new Map();
  private connections: Map<string, WebSocket> = new Map();
  private sslConfig?: { key: Buffer; cert: Buffer };
  private proxyService: ProxyService;

  constructor(sslConfig?: { key: Buffer; cert: Buffer }) {
    super();
    this.sslConfig = sslConfig;
    this.proxyService = new ProxyService();
    
    // Log active tunnels every 30 seconds
    setInterval(() => {
      const tunnels = Array.from(this.tunnels.entries());
      logger.info(`Active tunnels: ${tunnels.length}`, {
        tunnels: tunnels.map(([subdomain]) => subdomain)
      });
    }, 30000);
  }

  public getTunnels(): [string, TunnelConfig][] {
    return Array.from(this.tunnels.entries());
  }

  public registerTunnel(subdomain: string, ws: WebSocket, targetPort: number): void {
    this.tunnels.set(subdomain, { 
      subdomain, 
      ws,
      targetPort
    });
    logger.info(`Registered tunnel for subdomain: ${subdomain} targeting port ${targetPort}`);
    
    // Log current active tunnels
    const tunnels = Array.from(this.tunnels.entries());
    logger.info(`Active tunnels: ${tunnels.length}`, {
      tunnels: tunnels.map(([subdomain]) => subdomain)
    });
  }

  public getTunnel(subdomain: string): TunnelConfig | undefined {
    const tunnel = this.tunnels.get(subdomain);
    if (!tunnel) {
      logger.info(`Tunnel not found for subdomain: ${subdomain}`);
      // Log current active tunnels
      const tunnels = Array.from(this.tunnels.entries());
      logger.info(`Active tunnels: ${tunnels.length}`, {
        tunnels: tunnels.map(([subdomain]) => subdomain)
      });
    }
    return tunnel;
  }

  public registerConnection(clientId: string, ws: WebSocket): { clientId: string; ws: WebSocket } {
    this.connections.set(clientId, ws);
    logger.info(`Registered connection: ${clientId}`);
    return { clientId, ws };
  }

  public removeConnection(clientId: string): void {
    this.connections.delete(clientId);
    logger.info(`Removed connection: ${clientId}`);
  }

  public removeTunnel(subdomain: string): void {
    this.tunnels.delete(subdomain);
    logger.info(`Removed tunnel for subdomain: ${subdomain}`);
    
    // Log current active tunnels
    const tunnels = Array.from(this.tunnels.entries());
    logger.info(`Active tunnels: ${tunnels.length}`, {
      tunnels: tunnels.map(([subdomain]) => subdomain)
    });
  }

  public removeTunnelsForSocket(ws: WebSocket): void {
    // Find and remove all tunnels associated with this WebSocket
    for (const [subdomain, config] of this.tunnels.entries()) {
      if (config.ws === ws) {
        this.tunnels.delete(subdomain);
        logger.info(`Removed tunnel for subdomain: ${subdomain}`);
      }
    }
    
    // Log current active tunnels
    const tunnels = Array.from(this.tunnels.entries());
    logger.info(`Active tunnels: ${tunnels.length}`, {
      tunnels: tunnels.map(([subdomain]) => subdomain)
    });
  }

  public clientReady(clientId: string): void {
    const connection = this.connections.get(clientId);
    if (connection) {
      logger.info(`Client ${clientId} is ready for data transfer`);
    }
  }

  public handleData(clientId: string, data: string): void {
    const connection = this.connections.get(clientId);
    if (connection) {
      // Convert base64 data back to buffer and send to local port
      const buffer = Buffer.from(data, 'base64');
      // Here you would typically send this data to the appropriate destination
      logger.debug(`Handling data for client ${clientId}, size: ${buffer.length} bytes`);
    }
  }

  public createConnection(subdomain: string): Promise<{ clientId: string; ws: WebSocket }> {
    return new Promise((resolve, reject) => {
      const tunnel = this.tunnels.get(subdomain);
      if (!tunnel) {
        reject(new Error(`No tunnel found for subdomain: ${subdomain}`));
        return;
      }

      const clientId = uuidv4();
      const connection = this.registerConnection(clientId, tunnel.ws);
      logger.info(`Created new connection ${clientId} for subdomain ${subdomain}`);
      resolve(connection);
    });
  }

  private async validateTargetService(target: string, port: number): Promise<boolean> {
    const maxRetries = 3;
    const retryDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`Validating target service (attempt ${attempt}/${maxRetries})`, {
          target,
          port
        });

        const isAvailable = await new Promise<boolean>((resolve) => {
          const socket = new net.Socket();
          
          socket.setTimeout(2000); // 2 second timeout
          
          socket.on('connect', () => {
            logger.info(`Successfully connected to target service`, {
              target,
              port,
              attempt
            });
            socket.destroy();
            resolve(true);
          });
          
          socket.on('timeout', () => {
            logger.warn(`Connection attempt timed out`, {
              target,
              port,
              attempt
            });
            socket.destroy();
            resolve(false);
          });
          
          socket.on('error', (err) => {
            logger.warn(`Connection attempt failed`, {
              target,
              port,
              attempt,
              error: err.message
            });
            socket.destroy();
            resolve(false);
          });
          
          const host = target.replace(/^https?:\/\//, '').split(':')[0];
          logger.info(`Attempting to connect to ${host}:${port}`);
          socket.connect(port, host);
        });

        if (isAvailable) {
          return true;
        }

        if (attempt < maxRetries) {
          logger.info(`Retrying connection after ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      } catch (error) {
        logger.error(`Error during service validation`, {
          target,
          port,
          attempt,
          error
        });
      }
    }

    return false;
  }

  public async proxyRequestWrapper(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host;
    if (!host) {
      logger.error('No host header found in request');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'No host header found' }));
      return Promise.resolve();
    }

    const subdomain = host.split('.')[0];
    logger.info(`Proxying request for subdomain: ${subdomain}`, {
      headers: req.headers,
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString()
    });

    const tunnelConfig = this.tunnels.get(subdomain);
    if (!tunnelConfig) {
      logger.error(`No tunnel found for subdomain: ${subdomain}`, {
        availableTunnels: Array.from(this.tunnels.keys())
      });
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Tunnel not found' }));
      return Promise.resolve();
    }

    try {
      const target = tunnelConfig.targetUrl || (tunnelConfig.targetPort ? `http://localhost:${tunnelConfig.targetPort}` : undefined);
      if (!target) {
        logger.error(`No target URL or port found for tunnel: ${subdomain}`, {
          tunnel: {
            subdomain: tunnelConfig.subdomain,
            targetPort: tunnelConfig.targetPort,
            targetUrl: tunnelConfig.targetUrl
          }
        });
        res.writeHead(502);
        res.end(JSON.stringify({ error: 'Tunnel target not configured' }));
        return;
      }

      // Validate target service availability
      const isAvailable = await this.validateTargetService(target, tunnelConfig.targetPort!);
      if (!isAvailable) {
        logger.error(`Target service not available: ${target}`, {
          subdomain,
          port: tunnelConfig.targetPort
        });
        res.writeHead(502);
        res.end(JSON.stringify({ 
          error: 'Target service not available',
          details: `Could not connect to service on port ${tunnelConfig.targetPort}. Make sure your service is running.`
        }));
        return;
      }

      logger.info(`Forwarding request to target: ${target}`, {
        subdomain,
        method: req.method,
        url: req.url
      });
      
      await this.handleProxyRequest(req, res, target, tunnelConfig);
    } catch (error) {
      logger.error('Error in proxyRequest', { error, subdomain });
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Proxy request failed' }));
    }
  }

  private async handleProxyRequest(req: IncomingMessage, res: ServerResponse, target: string, tunnelConfig: TunnelConfig) {
    try {
      const proxy = httpProxy.createProxyServer({});
      
      // Add error handler for proxy errors
      proxy.on('error', (err: Error, req: IncomingMessage, res: ServerResponse) => {
        logger.error('Proxy error', {
          error: err.message,
          target,
          headers: req.headers,
          method: req.method,
          url: req.url,
          stack: err.stack
        });

        // Handle specific error cases
        if (err.message.includes('ECONNREFUSED')) {
          logger.error('Target service not available', {
            target,
            error: 'Connection refused',
            port: tunnelConfig.targetPort
          });
          res.writeHead(502);
          res.end(JSON.stringify({ 
            error: 'Target service not available',
            details: `Connection refused to port ${tunnelConfig.targetPort}. Make sure your service is running and listening on the correct port.`
          }));
          return;
        }

        if (err.message.includes('ECONNRESET')) {
          logger.error('Connection reset by target', {
            target,
            error: 'Connection reset'
          });
          res.writeHead(504);
          res.end(JSON.stringify({ 
            error: 'Connection reset',
            details: 'The target service unexpectedly closed the connection.'
          }));
          return;
        }

        if (err.message.includes('ETIMEDOUT')) {
          logger.error('Connection timed out', {
            target,
            error: 'Timeout'
          });
          res.writeHead(504);
          res.end(JSON.stringify({ 
            error: 'Gateway timeout',
            details: 'The target service took too long to respond.'
          }));
          return;
        }

        // Default error response
        res.writeHead(500);
        res.end(JSON.stringify({ 
          error: 'Proxy error', 
          details: err.message,
          code: err.name
        }));
      });

      proxy.web(req, res, {
        target,
        secure: false,
        changeOrigin: true,
        selfHandleResponse: true,
        ws: false // Disable WebSocket upgrade for HTTP requests
      });

      proxy.on('proxyRes', (proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        
        proxyRes.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        proxyRes.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks);
            const encoding = proxyRes.headers['content-encoding'];

            // Copy all headers except content-length (let Node calculate it)
            Object.keys(proxyRes.headers).forEach(key => {
              if (key.toLowerCase() !== 'content-length') {
                res.setHeader(key, proxyRes.headers[key]!);
              }
            });

            // Set status code
            res.statusCode = proxyRes.statusCode || 200;

            // Log response details
            logger.info('Proxying response', {
              statusCode: proxyRes.statusCode,
              contentEncoding: encoding,
              contentLength: buffer.length,
              headers: proxyRes.headers,
              target
            });

            // Send the response
            res.end(buffer);

          } catch (error) {
            logger.error('Error processing proxy response', { error, target });
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Error processing response' }));
          }
        });
      });

    } catch (error) {
      logger.error('Error in handleProxyRequest', { error, target });
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Proxy request failed' }));
    }
  }
}