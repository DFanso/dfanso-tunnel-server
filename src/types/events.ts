export interface TunnelEvent {
  type: TunnelEventType;
  tunnelId: string;
  timestamp: Date;
  data?: any;
}

export enum TunnelEventType {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  DATA_RECEIVED = 'data_received',
  DATA_SENT = 'data_sent',
  ERROR = 'error'
}

export interface TunnelErrorEvent extends TunnelEvent {
  type: TunnelEventType.ERROR;
  error: Error;
}
