import { AbortError } from 'p-retry';
import { env } from '../config/env.js';
import { getValidToken } from './oauth.js';
import { LinkedInApiError } from '../lib/errors.js';
import { withRetry } from '../lib/retry.js';

export class LinkedInClient {
  private readonly baseUrl = 'https://api.linkedin.com';
  
  constructor(private readonly accessToken: string) {}

  /**
   * General request wrapper with error handling.
   */
  private async request(
    path: string,
    options: RequestInit,
    label: string
  ): Promise<Response> {
    const isExternalUrl = path.startsWith('http://') || path.startsWith('https://');
    const url = isExternalUrl ? path : `${this.baseUrl}${path}`;

    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${this.accessToken}`);
    
    // LinkedIn API version header is required for `/rest/*` endpoints
    if (url.includes('/rest/')) {
      headers.set('LinkedIn-Version', env.LINKEDIN_API_VERSION);
      headers.set('X-Restli-Protocol-Version', '2.0.0');
    }

    const runRequest = async () => {
      try {
        const res = await fetch(url, { ...options, headers });
        
        if (!res.ok) {
          const body = await res.text();
          let parsedBody: any;
          try {
            parsedBody = JSON.parse(body);
          } catch {
            parsedBody = body;
          }

          const apiError = new LinkedInApiError(
            `LinkedIn API ${options.method} to ${path} failed: ${res.statusText} (${res.status})`,
            {
              statusCode: res.status,
              context: { response: parsedBody, path, method: options.method },
            }
          );

          // Retry on 429 (rate limit) or 5xx (server errors), but abort for 4xx client errors
          const isTransient = res.status === 429 || res.status >= 500;
          if (!isTransient) {
            throw new AbortError(apiError);
          }
          throw apiError;
        }

        return res;
      } catch (err: any) {
        if (err instanceof AbortError || err instanceof LinkedInApiError) {
          throw err;
        }
        throw new LinkedInApiError(`Network failure during ${options.method} request to ${path}`, {
          cause: err,
        });
      }
    };

    return withRetry(runRequest, { label });
  }

  async get(path: string, headers?: Record<string, string>): Promise<any> {
    const res = await this.request(path, { method: 'GET', headers }, `GET ${path}`);
    return res.json();
  }

  async post(path: string, body: any, headers?: Record<string, string>): Promise<any> {
    const isMultipartOrBinary = body instanceof Buffer || body instanceof ArrayBuffer;
    
    const requestHeaders: Record<string, string> = { ...headers };
    if (!isMultipartOrBinary && !requestHeaders['Content-Type']) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const res = await this.request(
      path,
      {
        method: 'POST',
        headers: requestHeaders,
        body: isMultipartOrBinary ? (body as any) : JSON.stringify(body),
      },
      `POST ${path}`
    );
    
    // Some POST requests might return 201 Created with an empty body or just headers (like x-restli-id)
    const text = await res.text();
    if (!text) {
      return {
        headers: Object.fromEntries(res.headers.entries()),
      };
    }
    
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async put(
    path: string,
    body: Buffer | ArrayBuffer | string,
    contentType: string,
    headers?: Record<string, string>
  ): Promise<Response> {
    return this.request(
      path,
      {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          ...headers,
        },
        body,
      },
      `PUT ${path}`
    );
  }
}

/**
 * Factory to create a LinkedInClient initialized with a valid token.
 */
export async function createLinkedInClient(): Promise<LinkedInClient> {
  const { accessToken } = await getValidToken();
  return new LinkedInClient(accessToken);
}
