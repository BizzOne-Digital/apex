import crypto from 'crypto';
import type { Env } from '../config/env.js';

export function hashInstallationId(installationId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(installationId).digest('hex');
}

export function verifyInstallationHeader(
  installationId: string | undefined,
  token: string | undefined,
  env: Env
): string {
  if (!installationId || !token) {
    throw new Error('MISSING_INSTALLATION');
  }
  const expected = hashInstallationId(installationId, env.INSTALLATION_TOKEN_SECRET);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('INVALID_INSTALLATION');
  }
  return installationId;
}

export function issueInstallationToken(installationId: string, env: Env): string {
  return hashInstallationId(installationId, env.INSTALLATION_TOKEN_SECRET);
}
