import { EventEmitter } from 'events';
import * as net from 'net';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { TunnelConfig } from '../types/tunnel';
import { IncomingMessage, ServerResponse } from 'http';
import { ProxyService } from './ProxyService';

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
  }

  public getTunnels(): [string, TunnelConfig][] {
    return Array.from(this.tunnels.entries());
  }

  public registerTunnel(subdomain: string, ws: WebSocket): void {
    this.tunnels.set(subdomain, { subdomain, ws });
  }

  public getTunnel(subdomain: string): TunnelConfig | undefined {
    return this.tunnels.get(subdomain);
  }

  public registerConnection(clientId: string, ws: WebSocket): { clientId: string; ws: WebSocket } {
    this.connections.set(clientId, ws);
    return { clientId, ws };
  }

  public removeConnection(clientId: string): void {
    this.connections.delete(clientId);
  }

  public removeTunnel(subdomain: string): void {
    this.tunnels.delete(subdomain);
  }

  public removeTunnelsForSocket(ws: WebSocket): void {
    // Find and remove all tunnels associated with this WebSocket
    for (const [subdomain, config] of this.tunnels.entries()) {
      if (config.ws === ws) {
        this.tunnels.delete(subdomain);
        logger.info(`Removed tunnel for subdomain: ${subdomain}`);
      }
    }

    // Also clean up any connections using this WebSocket
    for (const [clientId, connWs] of this.connections.entries()) {
      if (connWs === ws) {
        this.connections.delete(clientId);
        logger.info(`Removed connection: ${clientId}`);
      }
    }
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

  public async proxyRequest(
    tunnel: TunnelConfig,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Send request through WebSocket
        const clientId = uuidv4();
        const connection = this.registerConnection(clientId, tunnel.ws);

        // Forward the request through the tunnel
        tunnel.ws.send(JSON.stringify({
          type: 'request',
          clientId,
          method: req.method,
          path: req.url,
          headers: req.headers,
          body: '' // Will be populated if needed
        }));

        // Set timeout for tunnel response
        const timeout = setTimeout(() => {
          this.removeConnection(clientId);
          reject(new Error('Tunnel timeout'));
        }, 30000);

        // Handle response from tunnel
        let responseStarted = false;

        connection.ws.on('message', (data: Buffer | string) => {
          try {
            const message = JSON.parse(data.toString());

            switch (message.type) {
              case 'response':
                if (!responseStarted) {
                  responseStarted = true;
                  clearTimeout(timeout);
                  res.writeHead(message.statusCode, message.headers);
                  if (message.data) {
                    res.end(Buffer.from(message.data, 'base64'));
                  } else {
                    res.end();
                  }
                  this.removeConnection(clientId);
                  resolve();
                }
                break;

              case 'error':
                clearTimeout(timeout);
                this.removeConnection(clientId);
                reject(new Error(message.error));
                break;
            }
          } catch (err) {
            clearTimeout(timeout);
            this.removeConnection(clientId);
            reject(err);
          }
        });

      } catch (err) {
        reject(err);
      }
    });
  }
}