import { config } from './index';
import path from 'path';

export const sslConfig = {
  enabled: config.ssl.enabled,
  certsPath: path.resolve(process.cwd(), config.ssl.certsDir),
  options: {
    key: process.env.SSL_KEY_PATH,
    cert: process.env.SSL_CERT_PATH,
    ca: process.env.SSL_CA_PATH
  },
  defaultCertConfig: {
    days: 365,
    algorithm: 'sha256',
    keySize: 2048,
    organization: process.env.SSL_ORG_NAME || 'Tunnel Server',
    organizationUnit: process.env.SSL_ORG_UNIT || 'Development',
    country: process.env.SSL_COUNTRY || 'US',
    state: process.env.SSL_STATE || 'California',
    locality: process.env.SSL_LOCALITY || 'San Francisco'
  }
};
