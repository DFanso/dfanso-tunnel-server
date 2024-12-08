export interface TunnelMessage {
  type: 'register' | 'data' | 'close';
  tunnelId: string;
  data?: any;
}

export interface TunnelConfig {
  id: string;
  domain: string;
  targetPort: number;
  protocol: 'http' | 'https';
  clientId?: string;
  ssl?: boolean;
  created?: Date;
  active?: boolean;
  options?: TunnelOptions;
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
