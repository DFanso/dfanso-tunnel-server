// src/services/SSLService.ts
import { promises as fs } from 'fs';
import path from 'path';
import * as acme from 'acme-client';
import forge from 'node-forge';
import { logger } from '../utils/logger';
import { SSLConfig } from '../types/tunnel';

export class SSLService {
  private domain: string;
  private email: string;
  private sslDir: string;
  private client!: acme.Client;

  constructor(domain: string, email: string, sslDir: string) {
    this.domain = domain;
    this.email = email;
    this.sslDir = sslDir;
  }

  public async initialize(): Promise<SSLConfig> {
    await this.setupSSLDirectory();
    
    // Initialize ACME client
    const accountKey = await this.getAccountKey();
    const pemKey = forge.pki.privateKeyToPem(accountKey);
    
    this.client = new acme.Client({
      directoryUrl: acme.directory.letsencrypt.production,
      accountKey: pemKey,
    });

    // Check if we need to create or renew certificates
    if (await this.needsRenewal()) {
      return this.obtainCertificates();
    } else {
      return this.loadExistingCertificates();
    }
  }

  private async setupSSLDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.sslDir, { recursive: true });
      await fs.mkdir(path.join(this.sslDir, 'live'), { recursive: true });
      await fs.mkdir(path.join(this.sslDir, 'archive'), { recursive: true });
    } catch (err) {
      logger.error('Failed to create SSL directories:', err);
      throw err;
    }
  }

  private async getAccountKey(): Promise<forge.pki.rsa.PrivateKey> {
    const accountKeyPath = path.join(this.sslDir, 'account.key');
    
    try {
      const key = await fs.readFile(accountKeyPath, 'utf8');
      return forge.pki.privateKeyFromPem(key);
    } catch (err) {
      // Generate new account key if it doesn't exist
      const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const pem = forge.pki.privateKeyToPem(keypair.privateKey);
      
      await fs.writeFile(accountKeyPath, pem);
      return keypair.privateKey;
    }
  }

  private async needsRenewal(): Promise<boolean> {
    try {
      const certPath = path.join(this.sslDir, 'live', this.domain, 'cert.pem');
      const cert = await fs.readFile(certPath, 'utf8');
      const certificate = forge.pki.certificateFromPem(cert);
      
      // Renew if certificate expires in less than 30 days
      const validTo = new Date(certificate.validity.notAfter);
      const daysUntilExpiry = (validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      return daysUntilExpiry <= 30;
    } catch (err) {
      // If there's any error reading the certificate, assume we need renewal
      return true;
    }
  }

  private async obtainCertificates(): Promise<SSLConfig> {
    try {
      // Generate CSR
      const [privateKey, csr] = await acme.forge.createCsr({
        commonName: this.domain,
        altNames: [`*.${this.domain}`], // Wildcard certificate
      });

      // Get certificate
      const cert = await this.client.auto({
        csr,
        email: this.email,
        termsOfServiceAgreed: true,
        challengePriority: ['dns-01'],
        challengeCreateFn: async (authz, challenge, keyAuthorization) => {
          // Here you would implement DNS challenge
          // You need to create a TXT record _acme-challenge.yourdomain.com
          // with keyAuthorization as the value
          logger.info('Please create DNS TXT record:');
          logger.info(`_acme-challenge.${authz.identifier.value}`);
          logger.info(`TXT value: ${keyAuthorization}`);
          
          // Wait for user to set up DNS record
          await new Promise(resolve => setTimeout(resolve, 30000));
        },
        challengeRemoveFn: async (authz, challenge, keyAuthorization) => {
          // Clean up DNS record
          logger.info('You can now remove the DNS TXT record');
        },
      });

      // Save certificates
      const livePath = path.join(this.sslDir, 'live', this.domain);
      await fs.mkdir(livePath, { recursive: true });
      
      const privateKeyStr = privateKey.toString();
      const certStr = cert.toString();
      
      await fs.writeFile(path.join(livePath, 'privkey.pem'), privateKeyStr);
      await fs.writeFile(path.join(livePath, 'cert.pem'), certStr);
      
      return {
        key: privateKeyStr,
        cert: certStr,
      };
    } catch (err) {
      logger.error('Failed to obtain certificates:', err);
      throw err;
    }
  }

  private async loadExistingCertificates(): Promise<SSLConfig> {
    try {
      const livePath = path.join(this.sslDir, 'live', this.domain);
      const [key, cert] = await Promise.all([
        fs.readFile(path.join(livePath, 'privkey.pem'), 'utf8'),
        fs.readFile(path.join(livePath, 'cert.pem'), 'utf8')
      ]);

      return { key, cert };
    } catch (err) {
      logger.error('Failed to load existing certificates:', err);
      throw err;
    }
  }

  public async renewCertificates(): Promise<SSLConfig> {
    logger.info('Renewing SSL certificates...');
    return this.obtainCertificates();
  }

  public scheduleRenewal(): void {
    // Check for renewal every day
    setInterval(async () => {
      try {
        if (await this.needsRenewal()) {
          await this.renewCertificates();
          logger.info('SSL certificates renewed successfully');
        }
      } catch (err) {
        logger.error('Failed to renew SSL certificates:', err);
      }
    }, 24 * 60 * 60 * 1000);
  }
}