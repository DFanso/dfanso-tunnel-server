export const config = {
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0'
  },
  ssl: {
    enabled: process.env.SSL_ENABLED === 'true',
    certsDir: process.env.CERTS_DIR || './certs'
  },
  tunnel: {
    maxConnections: parseInt(process.env.MAX_CONNECTIONS || '1000', 10),
    timeout: parseInt(process.env.TUNNEL_TIMEOUT || '30000', 10),
    allowedProtocols: ['http', 'https']
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    directory: process.env.LOG_DIR || './logs'
  }
};
