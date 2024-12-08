import { EventEmitter } from 'events';
import * as net from 'net';
import * as tls from 'tls';
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
  private pendingResponses: Map<WebSocket, ServerResponse> = new Map();

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
    // In a VM setup, we can't directly validate the client's local port
    // Instead, we'll trust that the client has verified its local port
    return true;
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
      // Handle WebSocket upgrade requests
      if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        logger.info(`Handling WebSocket upgrade request for ${subdomain}`);
        return this.handleWebSocketUpgrade(req, res, tunnelConfig);
      }

      // Get request body as Buffer to handle binary data
      const body = await this.getRequestBody(req);

      // Prepare the message for the client
      const message = {
        type: 'request',
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          'x-forwarded-proto': req.socket instanceof tls.TLSSocket ? 'https' : 'http',
          'x-forwarded-for': req.socket.remoteAddress || '',
          'x-real-ip': req.socket.remoteAddress || ''
        },
        body: body.toString('base64'), // Send binary data as base64
        isBase64Encoded: true
      };

      logger.info(`Forwarding request via WebSocket`, {
        subdomain,
        method: req.method,
        url: req.url,
        targetPort: tunnelConfig.targetPort,
        contentLength: body.length
      });

      // Send the request to the client via WebSocket
      tunnelConfig.ws.send(JSON.stringify(message));

      // Handle streaming responses
      const responseStream = await this.waitForResponseStream(tunnelConfig.ws, res);
      if (!responseStream) {
        throw new Error('Failed to establish response stream');
      }
    } catch (error) {
      logger.error('Error in proxyRequest', { error, subdomain });
      res.statusCode = 502;
      res.end(JSON.stringify({ 
        error: 'Bad Gateway',
        details: 'Error communicating with the client tunnel'
      }));
    }
  }

  private getRequestBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => {
        chunks.push(chunk);
      });
      req.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
    });
  }

  private async handleWebSocketUpgrade(req: IncomingMessage, res: ServerResponse, tunnelConfig: TunnelConfig): Promise<void> {
    const message = {
      type: 'upgrade',
      path: req.url,
      headers: req.headers
    };

    // Send upgrade request to client
    tunnelConfig.ws.send(JSON.stringify(message));

    // Wait for client to confirm upgrade
    const response = await this.waitForResponse(tunnelConfig.ws);
    if (response.type === 'upgrade-success') {
      // Perform WebSocket upgrade
      const upgradeHeader = {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Accept': response.acceptKey
      };
      res.writeHead(101, upgradeHeader);
      res.end();
    } else {
      res.writeHead(400);
      res.end('WebSocket upgrade failed');
    }
  }

  private waitForResponseStream(ws: WebSocket, res: ServerResponse): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Response timeout'));
      }, 30000);

      const messageHandler = async (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          
          if (response.type === 'response-start') {
            // Keep content-encoding header if present
            const headers = { ...response.headers };
            
            // Don't override content-encoding if it exists
            if (!headers['content-encoding'] && response.encoding) {
              headers['content-encoding'] = response.encoding;
            }

            // Write headers first
            res.writeHead(response.statusCode, headers);
            
            if (!response.isStreaming) {
              resolve(true);
            }
          } else if (response.type === 'response-chunk') {
            // Handle compressed data
            let chunk: Buffer;
            if (response.isBase64) {
              chunk = Buffer.from(response.data, 'base64');
            } else {
              chunk = Buffer.from(response.data);
            }
            
            res.write(chunk);
          } else if (response.type === 'response-end') {
            clearTimeout(timeout);
            ws.removeListener('message', messageHandler);
            res.end();
            resolve(true);
          }
        } catch (error) {
          logger.error('Error parsing response chunk', { error });
          reject(error);
        }
      };

      ws.on('message', messageHandler);
    });
  }

  private async waitForResponse(ws: WebSocket): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Response timeout'));
      }, 30000); // 30 second timeout

      const messageHandler = (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.type === 'response') {
            clearTimeout(timeout);
            ws.removeListener('message', messageHandler);
            resolve(response);
          }
        } catch (error) {
          logger.error('Error parsing response', { error });
        }
      };

      ws.on('message', messageHandler);
    });
  }

  private handleWebSocketConnection(ws: WebSocket, req: IncomingMessage) {
    console.log('New WebSocket connection established');

    ws.on('message', async (message: string) => {
      try {
        const parsedMessage = JSON.parse(message);
        
        if (parsedMessage.type === 'response-start') {
          const { statusCode, headers, encoding, isStreaming } = parsedMessage;
          const clientResponse = this.pendingResponses.get(ws);
          
          if (clientResponse) {
            // Set response headers including content encoding if present
            if (encoding) {
              headers['content-encoding'] = encoding;
            }
            
            clientResponse.writeHead(statusCode, headers);
            
            if (!isStreaming) {
              this.pendingResponses.delete(ws);
            }
          }
        } 
        else if (parsedMessage.type === 'response-chunk') {
          const clientResponse = this.pendingResponses.get(ws);
          if (clientResponse) {
            const { data, isBase64 } = parsedMessage;
            const chunk = isBase64 ? Buffer.from(data, 'base64') : data;
            clientResponse.write(chunk);
          }
        }
        else if (parsedMessage.type === 'response-end') {
          const clientResponse = this.pendingResponses.get(ws);
          if (clientResponse) {
            clientResponse.end();
            this.pendingResponses.delete(ws);
          }
        }
        else if (parsedMessage.type === 'error') {
          console.error('Error from tunnel client:', parsedMessage.error);
          const clientResponse = this.pendingResponses.get(ws);
          if (clientResponse) {
            clientResponse.writeHead(502, { 'Content-Type': 'application/json' });
            clientResponse.end(JSON.stringify({
              error: 'Bad Gateway',
              details: parsedMessage.error
            }));
            this.pendingResponses.delete(ws);
          }
        }
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
        const clientResponse = this.pendingResponses.get(ws);
        if (clientResponse) {
          clientResponse.writeHead(500, { 'Content-Type': 'application/json' });
          clientResponse.end(JSON.stringify({
            error: 'Internal Server Error',
            details: 'Error processing tunnel response'
          }));
          this.pendingResponses.delete(ws);
        }
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      const clientResponse = this.pendingResponses.get(ws);
      if (clientResponse) {
        clientResponse.writeHead(502, { 'Content-Type': 'application/json' });
        clientResponse.end(JSON.stringify({
          error: 'Bad Gateway',
          details: 'Tunnel connection closed unexpectedly'
        }));
        this.pendingResponses.delete(ws);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      const clientResponse = this.pendingResponses.get(ws);
      if (clientResponse) {
        clientResponse.writeHead(502, { 'Content-Type': 'application/json' });
        clientResponse.end(JSON.stringify({
          error: 'Bad Gateway',
          details: 'Tunnel connection error'
        }));
        this.pendingResponses.delete(ws);
      }
    });
  }
}