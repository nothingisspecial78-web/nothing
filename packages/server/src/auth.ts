import { IncomingMessage, ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import type { Express, NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AppProfile } from '@ai-assistant/core';
import { logger, type ServerConfig } from './config.ts';
import type { ProfileRegistry } from './profiles/loader.ts';
import { verifyScopeToken } from './security/scope.ts';

export interface AuthenticatedUser {
  userId: string;
  role: string;
  name?: string;
  rawToken: string;
}

export interface AuthedRequest extends Request {
  authUser?: AuthenticatedUser;
  appProfile?: AppProfile;
}

export interface AppServiceBinding {
  envVar: 'DEMO_COLLEGE_FINANCE_URL' | 'SECOND_DEMO_APP_URL';
  mountPrefix: string;
}

const SERVICE_BINDING_RULES: Array<{
  matchAppIds: string[];
  matchPathPrefix: string;
  binding: AppServiceBinding;
}> = [
  {
    matchAppIds: ['college-finance', 'khazna-ledger'],
    matchPathPrefix: '/api/demo/college-finance',
    binding: {
      envVar: 'DEMO_COLLEGE_FINANCE_URL',
      mountPrefix: '/api/demo/college-finance',
    },
  },
  {
    matchAppIds: ['second-demo'],
    matchPathPrefix: '/api/demo/second-demo',
    binding: {
      envVar: 'SECOND_DEMO_APP_URL',
      mountPrefix: '/api/demo/second-demo',
    },
  },
];

let localExpressApp: Express | null = null;

export function registerLocalExpressApp(app: Express | null): void {
  localExpressApp = app;
}

export function resolveAppBaseUrl(
  baseUrl: string,
  serverPort: number,
  appId?: string,
  env: Record<string, string | undefined> = process.env
): string {
  for (const rule of SERVICE_BINDING_RULES) {
    const matchesApp = appId ? rule.matchAppIds.includes(appId) : false;
    const matchesUrl = baseUrl.includes(rule.matchPathPrefix);
    if (matchesApp || matchesUrl) {
      const boundOrigin = env[rule.binding.envVar]?.trim();
      if (boundOrigin) {
        const originWithSlash = boundOrigin.endsWith('/') ? boundOrigin : `${boundOrigin}/`;
        const relativePrefix = rule.binding.mountPrefix.replace(/^\/+/, '');
        return new URL(relativePrefix, originWithSlash).toString().replace(/\/$/, '');
      }
    }
  }

  // In single-port container environments, allow localhost:3000 in profile.json to track actual server port
  return baseUrl.replace('http://localhost:3000', `http://127.0.0.1:${serverPort}`);
}

async function dispatchInProcess(
  app: Express,
  url: URL,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<globalThis.Response> {
  const socket = new PassThrough();
  const req = new IncomingMessage(socket as unknown as import('node:net').Socket);
  req.method = (init.method || 'GET').toUpperCase();
  req.url = `${url.pathname}${url.search}`;

  const normalizedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(init.headers || {})) {
    if (v !== undefined) normalizedHeaders[k.toLowerCase()] = String(v);
  }
  normalizedHeaders.host = url.host;
  if (init.body !== undefined) {
    const buf = Buffer.from(init.body, 'utf8');
    normalizedHeaders['content-length'] = String(buf.byteLength);
    socket.push(buf);
  }
  socket.push(null);
  req.headers = normalizedHeaders;

  return new Promise<globalThis.Response>((resolve, reject) => {
    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);

    res.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
      if (chunk !== undefined && chunk !== null) {
        chunks.push(
          Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(String(chunk), typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8')
        );
      }
      return origWrite(chunk as never, encoding as never, cb as never);
    }) as typeof res.write;

    res.end = ((chunk?: unknown, encoding?: unknown, cb?: unknown) => {
      if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') {
        chunks.push(
          Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(String(chunk), typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8')
        );
      }
      const ret = origEnd(chunk as never, encoding as never, cb as never);
      const rawHeaders = res.getHeaders();
      const outHeaders = new Headers();
      for (const [hk, hv] of Object.entries(rawHeaders)) {
        if (Array.isArray(hv)) {
          for (const item of hv) outHeaders.append(hk, String(item));
        } else if (hv !== undefined) {
          outHeaders.set(hk, String(hv));
        }
      }
      resolve(
        new globalThis.Response(Buffer.concat(chunks), {
          status: res.statusCode || 200,
          statusText: res.statusMessage || '',
          headers: outHeaders,
        })
      );
      return ret;
    }) as typeof res.end;

    res.on('error', reject);
    app(req as unknown as Request, res as unknown as Response);
  });
}

export async function appInternalFetch(
  targetUrl: URL,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<globalThis.Response> {
  const isLocalTarget =
    targetUrl.hostname === '127.0.0.1' ||
    targetUrl.hostname === 'localhost' ||
    targetUrl.hostname === '::1';

  if (localExpressApp && isLocalTarget) {
    return dispatchInProcess(localExpressApp, targetUrl, init);
  }

  return fetch(targetUrl, init);
}

export async function verifyUserToken(params: {
  token: string;
  profile: AppProfile;
  cfg: ServerConfig;
}): Promise<AuthenticatedUser | null> {
  const { token, profile, cfg } = params;
  const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
  if (!cleanToken) {
    if (profile.auth.mode === 'none') {
      return { userId: 'anonymous', role: 'viewer', rawToken: '' };
    }
    return null;
  }

  // 1. Structured demo token support (e.g. demo:ADMIN:user:sector:student:org)
  if (cleanToken.startsWith('demo:')) {
    const parts = cleanToken.split(':');
    const role = parts[1] || 'viewer';
    const userId = parts[2] || 'demo-user';
    return {
      userId,
      role,
      name: parts[2] || 'Demo User',
      rawToken: cleanToken,
    };
  }

  // 2. Signed Scope JWT token verification
  const scopeSecret =
    (profile.auth.jwtSecretEnv ? process.env[profile.auth.jwtSecretEnv] : undefined) ||
    cfg.jwtSecret;
  const verifiedScope = verifyScopeToken(cleanToken, scopeSecret);
  if (verifiedScope) {
    return {
      userId: verifiedScope.userId,
      role: verifiedScope.role,
      name: verifiedScope.userId,
      rawToken: cleanToken,
    };
  }

  // 3. JWT auth mode
  if (profile.auth.mode === 'jwt' || profile.auth.mode === 'hybrid') {
    try {
      const decoded = jwt.verify(cleanToken, scopeSecret) as Record<string, unknown>;
      const userId = String(decoded.sub || decoded.userId || decoded.id || '');
      if (userId) {
        return {
          userId,
          role: String(decoded.role || 'member'),
          name: decoded.name ? String(decoded.name) : undefined,
          rawToken: cleanToken,
        };
      }
    } catch {
      if (profile.auth.mode === 'jwt') {
        return null;
      }
    }
  }

  // 4. Me endpoint auth mode
  if ((profile.auth.mode === 'me' || profile.auth.mode === 'hybrid') && profile.api.meEndpoint) {
    try {
      const base = resolveAppBaseUrl(profile.api.baseUrl, cfg.port, profile.appId).replace(/\/$/, '');
      const relativeEndpoint = profile.api.meEndpoint.replace(/^\/+/, '');
      const targetUrl = new URL(relativeEndpoint, `${base}/`);
      const res = await appInternalFetch(targetUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          'x-app-id': profile.appId,
        },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, unknown>;
      const userId = String(data.userId || data.id || data.sub || '');
      if (!userId) return null;
      return {
        userId,
        role: String(data.role || 'member'),
        name: data.name ? String(data.name) : undefined,
        rawToken: cleanToken,
      };
    } catch (err) {
      logger.warn({ err, appId: profile.appId }, 'Profile /me token verification failed');
      return null;
    }
  }

  // 5. If profile auth mode is 'none', accept any non-empty token gracefully
  if (profile.auth.mode === 'none') {
    return {
      userId: 'anonymous',
      role: 'viewer',
      rawToken: cleanToken,
    };
  }

  return null;
}

export function createAuthMiddleware(profiles: ProfileRegistry, cfg: ServerConfig) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const appIdRaw =
      (req.body && typeof req.body.appId === 'string' && req.body.appId) ||
      (typeof req.query.appId === 'string' && req.query.appId) ||
      (typeof req.headers['x-app-id'] === 'string' && req.headers['x-app-id']) ||
      '';

    if (!appIdRaw) {
      res.status(400).json({ error: 'Missing required appId.' });
      return;
    }

    const profile = profiles.getProfile(appIdRaw);
    if (!profile) {
      res.status(404).json({ error: `Unknown appId "${appIdRaw}".` });
      return;
    }

    const authHeader = req.headers.authorization || '';
    const user = await verifyUserToken({ token: authHeader, profile, cfg });
    if (!user) {
      res.status(401).json({ error: 'Unauthorized: invalid or missing authentication token.' });
      return;
    }

    req.appProfile = profile;
    req.authUser = user;
    next();
  };
}
