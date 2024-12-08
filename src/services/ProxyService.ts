import { Request, Response } from 'express';
import httpProxy from 'http-proxy';
import { logger } from '../utils/logger';

export class ProxyService {
  private proxy: httpProxy;

  constructor() {
    this.proxy = httpProxy.createProxyServer({});
    this.setupProxyEvents();
  }

  private setupProxyEvents(): void {
    this.proxy.on('error', (err, req, res) => {
      logger.error('Proxy error:', err);
      const response = res as Response;
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Proxy error');
      }
    });

    this.proxy.on('proxyReq', (proxyReq, req) => {
      const request = req as Request;
      logger.debug(`Proxying request to: ${request.url}`);
    });
  }

  public handleRequest(req: Request, res: Response): void {
    const host = req.headers.host;
    if (!host) {
      res.status(400).send('Host header is required');
      return;
    }

    // Here you would typically look up the target based on the host
    // For now, we'll use a placeholder target
    const target = process.env.DEFAULT_TARGET || 'http://localhost:8080';

    this.proxy.web(req, res, { target }, (err) => {
      logger.error('Failed to proxy request:', err);
      if (!res.headersSent) {
        res.status(502).send('Bad Gateway');
      }
    });
  }
}
