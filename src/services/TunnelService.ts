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

  public registerTunnel(subdomain: string, ws: WebSocket): void {
    this.tunnels.set(subdomain, { subdomain, ws });
    logger.info(`Registered tunnel for subdomain: ${subdomain}`);
    
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

  public proxyRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      method: req.method
    });

    const tunnel = this.tunnels.get(subdomain);
    if (!tunnel) {
      logger.error(`No tunnel found for subdomain: ${subdomain}`, {
        availableTunnels: Array.from(this.tunnels.keys())
      });
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Tunnel not found' }));
      return Promise.resolve();
    }

    return new Promise<void>(async (resolve, reject) => {
      try {
        // Get request body if present
        let body = '';
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          body = await new Promise<string>((resolve, reject) => {
            let data = '';
            req.on('data', chunk => {
              data += chunk;
            });
            req.on('end', () => resolve(data));
            req.on('error', reject);
          });
        }

        // Prepare headers for Next.js compatibility
        const headers = { ...req.headers };
        delete headers['content-length']; // Let Node.js calculate this
        
        // Ensure proper forwarding headers are set
        headers['x-forwarded-proto'] = 'https';
        headers['x-forwarded-host'] = host;
        headers['x-forwarded-for'] = req.socket.remoteAddress || '';
        headers['x-real-ip'] = req.socket.remoteAddress || '';

        const message = {
          type: 'request',
          clientId: Math.random().toString(36).substring(7),
          method: req.method,
          path: req.url || '/',
          headers,
          body
        };

        logger.debug(`Sending tunnel message for ${subdomain}:`, { message });
        tunnel.ws.send(JSON.stringify(message));

        // Wait for response
        const response = await new Promise<{
          type: string;
          statusCode: number;
          headers: Record<string, string | string[]>;
          data?: string;
          error?: string;
        }>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Tunnel timeout'));
            cleanup();
          }, 30000);

          const cleanup = () => {
            tunnel.ws.removeListener('message', handleMessage);
            clearTimeout(timeout);
          };

          const handleMessage = (data: WebSocket.Data) => {
            try {
              const message = JSON.parse(data.toString());
              if (message.type === 'response') {
                cleanup();
                resolve(message);
              }
            } catch (err) {
              logger.error('Error parsing tunnel response:', err);
            }
          };

          tunnel.ws.on('message', handleMessage);
        });

        // Handle response
        if (response.type === 'response') {
          const responseHeaders = { ...response.headers };
          delete responseHeaders['content-length']; // Let Node.js calculate this

          if (response.data) {
            try {
              let buffer = Buffer.from(response.data, 'base64');
              
              // If the content is gzipped, send it as-is
              if (responseHeaders['content-encoding'] === 'gzip') {
                res.writeHead(response.statusCode, responseHeaders);
                res.end(buffer);
              } else {
                // If it's not gzipped, we need to handle the raw content
                delete responseHeaders['content-encoding'];
                res.writeHead(response.statusCode, responseHeaders);
                res.end(buffer);
              }
              
              logger.debug(`Response sent for ${subdomain}:`, {
                statusCode: response.statusCode,
                contentLength: buffer.length,
                headers: responseHeaders
              });
            } catch (error) {
              logger.error(`Error processing response data for ${subdomain}:`, error);
              res.writeHead(502);
              res.end(JSON.stringify({ error: 'Error processing response data' }));
            }
          } else {
            res.writeHead(response.statusCode, responseHeaders);
            res.end();
          }
        } else if (response.type === 'error') {
          logger.error(`Tunnel error for ${subdomain}:`, response.error);
          res.writeHead(502);
          res.end(JSON.stringify({ error: 'Tunnel error', details: response.error }));
        }
        resolve();
      } catch (err) {
        const error = err as Error;
        logger.error(`Error handling request for ${subdomain}:`, error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal server error', details: error.message }));
        reject(error);
      }
    });
  }
}