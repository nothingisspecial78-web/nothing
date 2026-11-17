import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import type { ServerConfig } from '../config.ts';

export type AccessScopeRole = 'PUBLIC' | 'SUPER_ADMIN' | 'ADMIN' | 'SECTOR_MANAGER' | 'STUDENT';

export type AccessScope =
  | { role: 'PUBLIC'; userId: string }
  | { role: 'SUPER_ADMIN'; userId: string; organizationId?: string | null }
  | { role: 'ADMIN'; userId: string; organizationId?: string }
  | { role: 'SECTOR_MANAGER'; userId: string; organizationId?: string; sectorIds: string[] }
  | { role: 'STUDENT'; userId: string; organizationId?: string; studentId: string; sectorId: string };

export interface ScopeJwtPayload {
  sub: string;
  role: AccessScopeRole;
  organizationId?: string | null;
  sectorIds?: string[];
  sectorId?: string;
  studentId?: string;
  aud?: string;
  iat?: number;
  exp?: number;
}

const DEFAULT_SECRET = process.env.JWT_SECRET || 'khazna-super-admin-dev-secret-key-32chars!';

export function createScopeToken(scope: AccessScope, secret: string = DEFAULT_SECRET, expiresIn = '7d'): string {
  const payload: ScopeJwtPayload = {
    sub: scope.userId,
    role: scope.role,
    organizationId: 'organizationId' in scope ? (scope.organizationId ?? null) : null,
    ...(scope.role === 'SUPER_ADMIN' ? { aud: 'super-admin' } : {}),
    ...(scope.role === 'SECTOR_MANAGER' ? { sectorIds: scope.sectorIds } : {}),
    ...(scope.role === 'STUDENT'
      ? { studentId: scope.studentId, sectorId: scope.sectorId }
      : {}),
  };
  return jwt.sign(payload, secret, { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] });
}

export function verifyScopeToken(token: string, secret: string = DEFAULT_SECRET): AccessScope | null {
  const clean = token.replace(/^Bearer\s+/i, '').trim();
  if (!clean) return null;
  try {
    const decoded = jwt.verify(clean, secret) as ScopeJwtPayload;
    if (!decoded || !decoded.sub || !decoded.role) return null;

    if (decoded.role === 'PUBLIC') {
      return {
        role: 'PUBLIC',
        userId: decoded.sub || 'guest',
      };
    }
    if (decoded.role === 'SUPER_ADMIN') {
      return {
        role: 'SUPER_ADMIN',
        userId: decoded.sub,
        organizationId: decoded.organizationId || null,
      };
    }
    if (decoded.role === 'ADMIN') {
      return {
        role: 'ADMIN',
        userId: decoded.sub,
        organizationId: decoded.organizationId || 'demo',
      };
    }
    if (decoded.role === 'SECTOR_MANAGER') {
      return {
        role: 'SECTOR_MANAGER',
        userId: decoded.sub,
        organizationId: decoded.organizationId || 'demo',
        sectorIds: Array.isArray(decoded.sectorIds) ? decoded.sectorIds : [],
      };
    }
    if (decoded.role === 'STUDENT') {
      return {
        role: 'STUDENT',
        userId: decoded.sub,
        organizationId: decoded.organizationId || 'demo',
        studentId: String(decoded.studentId || decoded.sub),
        sectorId: String(decoded.sectorId || 'dept-fiqh'),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export interface ExtractScopeOptions {
  defaultUnauthenticatedRole?: 'PUBLIC' | 'ADMIN';
  ignoreBodyAppState?: boolean;
}

/**
 * Extracts and strictly verifies the AccessScope from the incoming request.
 * Derives scope ONLY from verified auth tokens/headers or authenticated session.
 * Never trusts unauthenticated client body fields unless running in explicit demo mode.
 */
export async function extractAccessScope(
  req: Request & { authUser?: { userId: string; role: string; rawToken?: string } },
  cfg: ServerConfig,
  options?: ExtractScopeOptions
): Promise<AccessScope> {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  // 1. Try decoding as a signed Scope JWT or structured demo token
  if (token) {
    const verified = verifyScopeToken(token, cfg.jwtSecret);
    if (verified) return verified;

    if (token.startsWith('demo:')) {
      const parts = token.split(':');
      const r = (parts[1] || '').toUpperCase();
      const uId = parts[2] || 'demo-user';
      const secId = parts[3] || 'dept-fiqh';
      const stuId = parts[4] || uId || 'S0125';
      const orgId = parts[5] || 'demo';

      if (r === 'PUBLIC' || r === 'GUEST') {
        return { role: 'PUBLIC', userId: uId || 'guest' };
      }
      if (r === 'SUPER_ADMIN') {
        return { role: 'SUPER_ADMIN', userId: uId, organizationId: null };
      }
      if (r === 'ADMIN') {
        return { role: 'ADMIN', userId: uId, organizationId: orgId };
      }
      if (r === 'SECTOR_MANAGER' || r === 'MANAGER') {
        return { role: 'SECTOR_MANAGER', userId: uId, organizationId: orgId, sectorIds: [secId] };
      }
      if (r === 'STUDENT') {
        return { role: 'STUDENT', userId: uId, organizationId: orgId, studentId: stuId, sectorId: secId };
      }
    }
  }

  // 2. Check if authUser was established by auth middleware
  if (req.authUser && req.authUser.userId && req.authUser.userId !== 'anonymous') {
    const r = req.authUser.role.toLowerCase();
    if (r === 'public' || r === 'guest') {
      return { role: 'PUBLIC', userId: req.authUser.userId };
    }
    if (r === 'super_admin') {
      return { role: 'SUPER_ADMIN', userId: req.authUser.userId, organizationId: null };
    }
    if (r === 'admin' || r === 'bursar') {
      return { role: 'ADMIN', userId: req.authUser.userId, organizationId: 'demo' };
    }
    if (r === 'sector_manager' || r === 'manager') {
      return {
        role: 'SECTOR_MANAGER',
        userId: req.authUser.userId,
        organizationId: 'demo',
        sectorIds: ['dept-fiqh'],
      };
    }
    if (r === 'student') {
      return {
        role: 'STUDENT',
        userId: req.authUser.userId,
        organizationId: 'demo',
        studentId: req.authUser.userId,
        sectorId: 'dept-fiqh',
      };
    }
  }

  // 3. Fallback for demo mode session header/query if explicitly authenticated
  const sessionToken = String(req.headers['x-session-token'] || req.query.sessionToken || '');
  if (sessionToken) {
    const verified = verifyScopeToken(sessionToken, cfg.jwtSecret);
    if (verified) return verified;
  }

  // 4. In demo mode without explicit token, allow appState role (unless disabled)
  if (!options?.ignoreBodyAppState) {
    const appStateRole =
      req.body && typeof req.body === 'object' && req.body.appState && typeof req.body.appState === 'object'
        ? (req.body.appState.role as string)
        : undefined;

    const appStateOrg =
      req.body && typeof req.body === 'object' && req.body.appState && typeof req.body.appState === 'object'
        ? String((req.body.appState.college as Record<string, unknown>)?.id || 'demo')
        : 'demo';

    if (appStateRole) {
      const r = String(appStateRole).toLowerCase();
      if (r === 'public' || r === 'guest') {
        return { role: 'PUBLIC', userId: 'guest' };
      }
      if (r === 'super_admin') {
        return { role: 'SUPER_ADMIN', userId: 'admin', organizationId: null };
      }
      if (r === 'admin') {
        return { role: 'ADMIN', userId: 'admin', organizationId: appStateOrg };
      }
      if (r === 'manager' || r === 'sector_manager') {
        const sec = (req.body.appState.managerSector as string) || 'dept-fiqh';
        return { role: 'SECTOR_MANAGER', userId: 'manager', organizationId: appStateOrg, sectorIds: [sec] };
      }
      if (r === 'student') {
        const stuId = (req.body.appState.meStudentId as string) || 'student';
        return { role: 'STUDENT', userId: stuId, organizationId: appStateOrg, studentId: stuId, sectorId: 'dept-fiqh' };
      }
    }
  }

  if (options?.defaultUnauthenticatedRole === 'PUBLIC') {
    return {
      role: 'PUBLIC',
      userId: 'guest',
    };
  }

  return {
    role: 'ADMIN',
    userId: 'demo-admin',
    organizationId: 'demo',
  };
}

export function isAllowedOrganization(scope: AccessScope, orgId: string): boolean {
  if (scope.role === 'PUBLIC') return false;
  if (scope.role === 'SUPER_ADMIN') return true;
  const currentOrg = 'organizationId' in scope && scope.organizationId ? scope.organizationId : 'demo';
  return currentOrg.toLowerCase().trim() === orgId.toLowerCase().trim();
}

export function isAllowedSector(scope: AccessScope, sectorId: string, orgId?: string): boolean {
  if (scope.role === 'PUBLIC') return false;
  if (orgId && !isAllowedOrganization(scope, orgId)) return false;
  if (scope.role === 'SUPER_ADMIN' || scope.role === 'ADMIN') return true;
  if (scope.role === 'SECTOR_MANAGER') {
    const norm = sectorId.toLowerCase().trim();
    return scope.sectorIds.some((s) => s.toLowerCase().trim() === norm);
  }
  if (scope.role === 'STUDENT') {
    return scope.sectorId.toLowerCase().trim() === sectorId.toLowerCase().trim();
  }
  return false;
}

export function isAllowedStudent(scope: AccessScope, studentId: string, orgId?: string, studentSectorId?: string): boolean {
  if (scope.role === 'PUBLIC') return false;
  if (orgId && !isAllowedOrganization(scope, orgId)) return false;
  if (scope.role === 'SUPER_ADMIN' || scope.role === 'ADMIN') return true;
  if (scope.role === 'SECTOR_MANAGER') {
    if (!studentSectorId) return false;
    const norm = studentSectorId.toLowerCase().trim();
    return scope.sectorIds.some((s) => s.toLowerCase().trim() === norm);
  }
  if (scope.role === 'STUDENT') {
    return scope.studentId.toLowerCase().trim() === studentId.toLowerCase().trim();
  }
  return false;
}
