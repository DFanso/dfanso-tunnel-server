import crypto from 'crypto';

export function generateTunnelId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function validateDomain(domain: string): boolean {
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
  return domainRegex.test(domain);
}

export function validateSubdomain(subdomain: string): boolean {
  const subdomainRegex = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
  return subdomainRegex.test(subdomain);
}

export function generateSubdomain(): string {
  const length = 8;
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function parseTarget(target: string): { host: string; port: number } {
  const [host, portStr] = target.split(':');
  const port = parseInt(portStr, 10) || 80;
  return { host, port };
}

export function formatBytes(bytes: number): string {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Byte';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)).toString());
  return Math.round(bytes / Math.pow(1024, i)) + ' ' + sizes[i];
}
