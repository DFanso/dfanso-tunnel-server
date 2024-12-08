// src/services/TunnelService.ts
import { EventEmitter } from 'events';
import { TunnelConfig, TunnelOptions } from '../types/tunnel';
import { generateSubdomain, validateSubdomain } from '../utils/helpers';
import { logger } from '../utils/logger';
import net from 'net';
import tls from 'tls';

export class TunnelService extends EventEmitter {
  private tunnels: Map<string, TunnelConfig>;
  private connections: Map<string, Set<net.Socket>>;
  private sslConfig?: { key: string; cert: string };

  constructor(sslConfig?: { key: string; cert: string }) {
    super();
    this.tunnels = new Map();
    this.connections = new Map();
    this.sslConfig = sslConfig;
  }

  public createTunnel(targetPort: number, options: TunnelOptions = {}): string {
    const subdomain = options.subdomain || generateSubdomain();

    if (options.subdomain && !validateSubdomain(options.subdomain)) {
      throw new Error('Invalid subdomain format');
    }

    if (this.tunnels.has(subdomain)) {
      throw new Error('Subdomain already in use');
    }

    const config: TunnelConfig = {
      id: subdomain,
      domain: `${subdomain}.${process.env.DOMAIN || 'localhost'}`,
      targetPort,
      protocol: options.ssl !== false ? 'https' : 'http',
      clientId: options.clientId,
      ssl: options.ssl !== false,
      created: new Date(),
      active: true
    };

    this.tunnels.set(subdomain, config);
    this.connections.set(subdomain, new Set());

    logger.info(`Tunnel created: ${subdomain} -> port ${targetPort}`);
    return subdomain;
  }

  public getTunnelInfo(subdomain: string): TunnelConfig | undefined {
    return this.tunnels.get(subdomain);
  }

  public getTunnels(): Map<string, TunnelConfig> {
    return new Map(this.tunnels);
  }

  public removeTunnel(subdomain: string): boolean {
    const connections = this.connections.get(subdomain);
    if (connections) {
      for (const socket of connections) {
        socket.destroy();
      }
      this.connections.delete(subdomain);
    }

    const removed = this.tunnels.delete(subdomain);
    if (removed) {
      logger.info(`Tunnel removed: ${subdomain}`);
    }
    return removed;
  }

  public removeClientTunnels(clientId: string): void {
    for (const [subdomain, config] of this.tunnels.entries()) {
      if (config.clientId === clientId) {
        this.removeTunnel(subdomain);
      }
    }
  }

  public handleConnection(socket: net.Socket | tls.TLSSocket, isSecure: boolean = false): void {
    socket.once('data', (data: Buffer) => {
      const headerMatch = data.toString().match(/Host: ([^\r\n]+)/i);
      if (!headerMatch) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }

      const [, host] = headerMatch;
      const subdomain = host.split('.')[0];
      const tunnel = this.tunnels.get(subdomain);

      if (!tunnel) {
        socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
        return;
      }

      if (tunnel.ssl && !isSecure) {
        const redirectUrl = `https://${host}${(socket as any).url || ''}`;
        socket.end([
          'HTTP/1.1 301 Moved Permanently',
          `Location: ${redirectUrl}`,
          'Connection: close',
          '',
          ''
        ].join('\r\n'));
        return;
      }

      // Forward the connection
      this.forwardConnection(socket, data, tunnel);
    });
  }

  private forwardConnection(socket: net.Socket | tls.TLSSocket, data: Buffer, tunnel: TunnelConfig): void {
    const target = net.createConnection({
      host: 'localhost',
      port: tunnel.targetPort
    });

    target.on('connect', () => {
      target.write(data);
      socket.pipe(target).pipe(socket);
    });

    target.on('error', (err) => {
      logger.error(`Error forwarding connection: ${err.message}`);
      socket.end();
    });

    socket.on('error', () => {
      target.end();
    });
  }
}