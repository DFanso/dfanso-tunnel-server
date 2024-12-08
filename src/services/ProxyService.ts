// @ts-nocheck
import { EventEmitter } from 'events';
import httpProxy from 'http-proxy';
import { IncomingMessage, ServerResponse, ClientRequest } from 'http';
import { logger } from '../utils/logger';

type ProxyServer = httpProxy & {
  on(event: 'error', callback: (err: Error, req: IncomingMessage, res: ServerResponse) => void): this;
  on(event: 'proxyReq', callback: (proxyReq: ClientRequest, req: IncomingMessage, res: ServerResponse, options: object) => void): this;
  web(req: IncomingMessage, res: ServerResponse, options: httpProxy.ServerOptions, callback?: (err?: Error) => void): void;
};

export class ProxyService extends EventEmitter {
  private proxy: ProxyServer;

  constructor() {
    super();
    this.proxy = httpProxy.createProxyServer({}) as ProxyServer;

    // Handle proxy errors
    this.proxy.on('error', (
      err: Error,
      req: IncomingMessage,
      res: ServerResponse
    ) => {
      logger.error('Proxy error:', err);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Proxy error: ' + err.message);
      }
    });

    // Modify request headers before forwarding
    this.proxy.on('proxyReq', (
      proxyReq: ClientRequest,
      req: IncomingMessage,
      res: ServerResponse,
      options: object
    ) => {
      // Add X-Forwarded headers
      const host = req.headers.host || '';
      proxyReq.setHeader('X-Forwarded-Host', host);
      proxyReq.setHeader('X-Forwarded-Proto', 'https');

      // Remove connection header to prevent keep-alive issues
      proxyReq.removeHeader('connection');
    });
  }

  public proxyRequest(
    req: IncomingMessage,
    res: ServerResponse,
    target: string,
    errorCallback: (err: Error) => void
  ): void {
    this.proxy.web(req, res, { target }, errorCallback);
  }
}
