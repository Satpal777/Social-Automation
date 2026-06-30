import { env } from '../config/env.js';
import { logger } from '../monitoring/logger.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { oauthTokenRepository } from '../db/repositories/oauth-token.repository.js';
import { ConfigError, LinkedInApiError } from '../lib/errors.js';

// In-memory store for CSRF state validation (simple Map)
const stateStore = new Set<string>();

/**
 * Generate CSRF state, store it, and return authorization URL.
 */
export function getAuthorizationUrl(state: string): string {
  const clientId = env.LINKEDIN_CLIENT_ID;
  const redirectUri = env.LINKEDIN_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new ConfigError('LINKEDIN_CLIENT_ID and LINKEDIN_REDIRECT_URI must be configured');
  }

  stateStore.add(state);
  // Auto-cleanup after 10 minutes to prevent memory leak
  setTimeout(() => stateStore.delete(state), 10 * 60 * 1000);

  const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('client_id', clientId);
  url.searchParams.append('redirect_uri', redirectUri);
  url.searchParams.append('scope', env.LINKEDIN_SCOPES);
  url.searchParams.append('state', state);

  return url.toString();
}

/**
 * Validate state and exchange the authorization code for access and refresh tokens.
 */
export async function exchangeCode(code: string, state: string): Promise<void> {
  if (!stateStore.has(state)) {
    throw new LinkedInApiError('CSRF state validation failed or expired', { statusCode: 400 });
  }
  stateStore.delete(state);

  const clientId = env.LINKEDIN_CLIENT_ID;
  const clientSecret = env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = env.LINKEDIN_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new ConfigError(
      'LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, and LINKEDIN_REDIRECT_URI must be configured'
    );
  }

  logger.info('Exchanging OAuth authorization code for token');
  
  const tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  let tokenData: {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    scope?: string;
  };

  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new LinkedInApiError(`Token exchange failed: ${errText}`, {
        statusCode: res.status,
      });
    }

    tokenData = await res.json() as any;
  } catch (err: any) {
    if (err instanceof LinkedInApiError) throw err;
    throw new LinkedInApiError('Network error during token exchange', { cause: err });
  }

  // Encrypt tokens before storing
  const encryptedAccessToken = encrypt(tokenData.access_token);
  const encryptedRefreshToken = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : undefined;
  
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  // Fetch Member URN
  const memberUrn = await fetchMemberUrn(tokenData.access_token);

  await oauthTokenRepository.upsert('linkedin', {
    accessToken: encryptedAccessToken,
    refreshToken: encryptedRefreshToken,
    expiresAt,
    scope: tokenData.scope || env.LINKEDIN_SCOPES,
    memberUrn,
  });

  logger.info({ memberUrn }, 'OAuth token successfully stored for member');
}

/**
 * Fetch member URN using the access token from the OpenID /v2/userinfo endpoint.
 */
async function fetchMemberUrn(accessToken: string): Promise<string> {
  const url = 'https://api.linkedin.com/v2/userinfo';
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new LinkedInApiError(`Failed to fetch user info: ${errText}`, {
        statusCode: res.status,
      });
    }

    const data: { sub: string } = await res.json() as any;
    if (!data.sub) {
      throw new LinkedInApiError('Invalid response from userinfo: missing sub field');
    }
    return `urn:li:person:${data.sub}`;
  } catch (err: any) {
    if (err instanceof LinkedInApiError) throw err;
    throw new LinkedInApiError('Network error fetching member URN', { cause: err });
  }
}

/**
 * Proactively refresh the access token using the stored refresh token.
 */
export async function refreshAccessToken(): Promise<void> {
  const storedToken = await oauthTokenRepository.findByProvider('linkedin');
  if (!storedToken) {
    throw new LinkedInApiError('No stored LinkedIn token found to refresh', { statusCode: 404 });
  }
  if (!storedToken.refreshToken) {
    throw new LinkedInApiError('No refresh token available to perform refresh', { statusCode: 400 });
  }

  const clientId = env.LINKEDIN_CLIENT_ID;
  const clientSecret = env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new ConfigError('LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be configured');
  }

  const decryptedRefreshToken = decrypt(storedToken.refreshToken);
  logger.info('Refreshing LinkedIn access token');

  const tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: decryptedRefreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  let tokenData: {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    scope?: string;
  };

  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new LinkedInApiError(`Token refresh failed: ${errText}`, {
        statusCode: res.status,
      });
    }

    tokenData = await res.json() as any;
  } catch (err: any) {
    if (err instanceof LinkedInApiError) throw err;
    throw new LinkedInApiError('Network error during token refresh', { cause: err });
  }

  const encryptedAccessToken = encrypt(tokenData.access_token);
  const encryptedRefreshToken = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : undefined;
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  // If userinfo endpoint fails or scopes changed, we fetch again. Otherwise keep existing URN.
  let memberUrn = storedToken.memberUrn;
  try {
    memberUrn = await fetchMemberUrn(tokenData.access_token);
  } catch (err) {
    logger.warn({ err }, 'Could not re-fetch userinfo during refresh, reusing stored memberUrn');
  }

  await oauthTokenRepository.upsert('linkedin', {
    accessToken: encryptedAccessToken,
    refreshToken: encryptedRefreshToken || storedToken.refreshToken || undefined,
    expiresAt,
    scope: tokenData.scope || storedToken.scope,
    memberUrn: memberUrn || undefined,
  });

  logger.info('OAuth token successfully refreshed');
}

/**
 * Check if the stored token is healthy (exists and is not expired).
 */
export async function isTokenHealthy(): Promise<boolean> {
  const token = await oauthTokenRepository.findByProvider('linkedin');
  if (!token) return false;
  // If token is already expired or expires in less than 10 seconds
  return token.expiresAt.getTime() > Date.now() + 10 * 1000;
}

/**
 * Retrieve a valid decrypted access token and the member URN.
 * If the token is close to expiry (within 5 minutes) and we have a refresh token, we refresh it first.
 */
export async function getValidToken(): Promise<{ accessToken: string; memberUrn: string }> {
  const storedToken = await oauthTokenRepository.findByProvider('linkedin');
  if (!storedToken) {
    throw new LinkedInApiError('No LinkedIn credentials configured. Please complete OAuth flow.', {
      statusCode: 401,
    });
  }

  const fiveMinutes = 5 * 60 * 1000;
  const isNearExpiry = storedToken.expiresAt.getTime() < Date.now() + fiveMinutes;

  if (isNearExpiry && storedToken.refreshToken) {
    try {
      await refreshAccessToken();
      const refreshedToken = await oauthTokenRepository.findByProvider('linkedin');
      if (refreshedToken) {
        return {
          accessToken: decrypt(refreshedToken.accessToken),
          memberUrn: refreshedToken.memberUrn || '',
        };
      }
    } catch (err) {
      logger.error({ err }, 'Failed to refresh token proactively, attempting to use current token');
    }
  }

  if (storedToken.expiresAt.getTime() <= Date.now()) {
    throw new LinkedInApiError('LinkedIn access token has expired. Please re-authenticate.', {
      statusCode: 401,
    });
  }

  return {
    accessToken: decrypt(storedToken.accessToken),
    memberUrn: storedToken.memberUrn || '',
  };
}
