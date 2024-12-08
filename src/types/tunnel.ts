import { WebSocket } from 'ws';

export interface TunnelMessage {
  type: 'register' | 'data' | 'close';
  tunnelId: string;
  data?: any;
}

export interface TunnelConfig {
  subdomain: string;
  ws: WebSocket;
  targetUrl?: string;
  targetPort?: number;
}

export interface TunnelStats {
  bytesReceived: number;
  bytesSent: number;
  requestCount: number;
  connectedAt: Date;
  lastActivityAt: Date;
}

export interface SSLConfig {
  key: string;
  cert: string;
}

export interface TunnelOptions {
  subdomain?: string;
  clientId?: string;
  ssl?: boolean;
}
