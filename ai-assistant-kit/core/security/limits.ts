import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import type { SourceCitation } from '../schemas.ts';

function extractForwardedIp(req: Request): string {
  const forwarded = req.headers.forwarded;
  const headerVal = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof headerVal === 'string' && headerVal.trim()) {
    const firstEntry = headerVal.split(',')[0] || '';
    const match = /for\s*=\s*"?([^";,\s]+)"?/i.exec(firstEntry);
    if (match?.[1]) {
      let raw = match[1].trim();
      if (raw.startsWith('[')) {
        const endBracket = raw.indexOf(']');
        if (endBracket > 1) {
          raw = raw.slice(1, endBracket);
        }
      } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(raw)) {
        raw = raw.split(':')[0] || raw;
      }
      if (raw && !raw.startsWith('_')) {
        return raw;
      }
    }
  }
  return req.ip || req.socket?.remoteAddress || '0.0.0.0';
}

function clientIpKey(req: Request): string {
  return ipKeyGenerator(extractForwardedIp(req));
}

export interface RateLimitConfigLike {
  rateLimitWindowMs?: number;
  rateLimitMaxIp?: number;
  rateLimitMaxUser?: number;
}

export function createIpRateLimiter(cfgOrMax: RateLimitConfigLike | number = 120, windowMs?: number) {
  const max = typeof cfgOrMax === 'number' ? cfgOrMax : (cfgOrMax?.rateLimitMaxIp ?? 120);
  const win = typeof cfgOrMax === 'number' ? (windowMs || 60000) : (cfgOrMax?.rateLimitWindowMs ?? 60000);
  return rateLimit({
    windowMs: win,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => clientIpKey(req),
    message: { error: 'Too many requests from this IP address. Please retry shortly.' },
  });
}

export function createUserRateLimiter(cfgOrMax: RateLimitConfigLike | number = 60, windowMs?: number) {
  const max = typeof cfgOrMax === 'number' ? cfgOrMax : (cfgOrMax?.rateLimitMaxUser ?? 60);
  const win = typeof cfgOrMax === 'number' ? (windowMs || 60000) : (cfgOrMax?.rateLimitWindowMs ?? 60000);
  return rateLimit({
    windowMs: win,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const user = (req as Request & { authUser?: { userId: string } }).authUser;
      return user?.userId ? `user:${user.userId}` : `ip:${clientIpKey(req)}`;
    },
    message: { error: 'User rate limit exceeded. Please pause briefly before sending more requests.' },
  });
}

export function createPaymentRateLimiter(cfg: RateLimitConfigLike) {
  const win = cfg.rateLimitWindowMs ?? 60000;
  const maxUser = cfg.rateLimitMaxUser ?? 40;
  return rateLimit({
    windowMs: win,
    max: Math.max(12, Math.min(30, Math.floor(maxUser / 2))),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const auth = req.headers.authorization || '';
      return auth ? `pay:${clientIpKey(req)}:${auth.slice(-16)}` : `pay:${clientIpKey(req)}`;
    },
    message: { error: 'Too many payment requests. Please wait a moment before retrying.' },
  });
}

export interface CachedAnswer {
  answer: string;
  sources: SourceCitation[];
  refusal: boolean;
  model: string;
  expiresAt: number;
}

export class ResponseCache {
  private readonly store = new Map<string, CachedAnswer>();

  constructor(private readonly ttlMs: number) {}

  makeKey(
    appId: string,
    question: string,
    language: string,
    routePath?: string,
    contextKey?: string
  ): string {
    const normalized = question.trim().toLowerCase().replace(/\s+/g, ' ');
    return `${appId}::${language}::${routePath || ''}::${contextKey || ''}::${normalized}`;
  }

  get(key: string): CachedAnswer | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  set(key: string, value: Omit<CachedAnswer, 'expiresAt'>): void {
    if (this.ttlMs <= 0) return;
    if (this.store.size > 500) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(key, {
      ...value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clearForApp(appId: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(`${appId}::`)) {
        this.store.delete(key);
      }
    }
  }
}
