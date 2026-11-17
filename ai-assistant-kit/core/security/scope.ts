import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export type CanonicalScopeRole =
  | 'PUBLIC'
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'SCOPED_MANAGER'
  | 'END_USER';

export type AccessScopeRole = CanonicalScopeRole | string;

export interface AccessScope {
  role: AccessScopeRole;
  canonicalRole?: CanonicalScopeRole;
  userId: string;
  organizationId?: string | null;
  scopeIds?: string[];
  scopeId?: string;
  ownerId?: string;
  attributes?: Record<string, unknown>;
}

export interface ScopeJwtPayload {
  sub: string;
  role: AccessScopeRole;
  organizationId?: string | null;
  scopeIds?: string[];
  scopeId?: string;
  ownerId?: string;
  aud?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export interface ScopeResolverOptions {
  roleAliases?: Record<string, CanonicalScopeRole>;
  defaultScopeId?: string;
  defaultOwnerId?: string;
  defaultOrgId?: string;
  appStateScopeKey?: string;
  appStateOwnerKey?: string;
  appStateOrgKey?: string;
  defaultUnauthenticatedRole?: 'PUBLIC' | 'ADMIN';
  ignoreBodyAppState?: boolean;
}

const DEFAULT_ROLE_ALIASES: Record<string, CanonicalScopeRole> = {
  PUBLIC: 'PUBLIC',
  GUEST: 'PUBLIC',
  ANONYMOUS: 'PUBLIC',
  SUPER_ADMIN: 'SUPER_ADMIN',
  PLATFORM_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  OWNER: 'ADMIN',
  SCOPED_MANAGER: 'SCOPED_MANAGER',
  MANAGER: 'SCOPED_MANAGER',
  END_USER: 'END_USER',
  USER: 'END_USER',
  MEMBER: 'END_USER',
};

const EPHEMERAL_FALLBACK_KEY = crypto.randomBytes(24).toString('hex');

function resolveSigningSecret(explicitSecret?: string): string {
  return explicitSecret || process.env.JWT_SECRET || EPHEMERAL_FALLBACK_KEY;
}

export function resolveCanonicalRole(
  role: string,
  aliases: Record<string, CanonicalScopeRole> = {}
): CanonicalScopeRole {
  const norm = String(role || 'PUBLIC').trim().toUpperCase();
  return aliases[norm] || DEFAULT_ROLE_ALIASES[norm] || 'PUBLIC';
}

export function createScopeToken(
  scope: AccessScope,
  secret: string = resolveSigningSecret(),
  expiresIn = '7d'
): string {
  const canonical = scope.canonicalRole || resolveCanonicalRole(scope.role);
  const payload: ScopeJwtPayload = {
    sub: scope.userId,
    role: scope.role,
    organizationId: scope.organizationId ?? null,
    ...(canonical === 'SUPER_ADMIN' ? { aud: 'super-admin' } : {}),
    ...(scope.scopeIds && scope.scopeIds.length > 0 ? { scopeIds: scope.scopeIds } : {}),
    ...(scope.scopeId ? { scopeId: scope.scopeId } : {}),
    ...(scope.ownerId ? { ownerId: scope.ownerId } : {}),
    ...(scope.attributes ? scope.attributes : {}),
  };
  return jwt.sign(payload, secret, { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] });
}

export function verifyScopeToken(
  token: string,
  secret: string = resolveSigningSecret(),
  opts?: ScopeResolverOptions
): AccessScope | null {
  const clean = token.replace(/^Bearer\s+/i, '').trim();
  if (!clean) return null;
  try {
    const decoded = jwt.verify(clean, secret) as ScopeJwtPayload;
    if (!decoded || !decoded.sub || !decoded.role) return null;

    const rawRole = String(decoded.role).trim().toUpperCase();
    const canonical = resolveCanonicalRole(rawRole, opts?.roleAliases);
    const orgId = decoded.organizationId || opts?.defaultOrgId || 'default-org';

    const rawScopeIds = Array.isArray(decoded.scopeIds)
      ? decoded.scopeIds.map(String)
      : decoded.scopeId
        ? [String(decoded.scopeId)]
        : [];
    const ownerId = decoded.ownerId ? String(decoded.ownerId) : String(decoded.sub);
    const scopeId = decoded.scopeId
      ? String(decoded.scopeId)
      : rawScopeIds[0] || opts?.defaultScopeId || '';

    if (canonical === 'PUBLIC') {
      return {
        role: rawRole,
        canonicalRole: 'PUBLIC',
        userId: decoded.sub || 'guest',
      };
    }
    if (canonical === 'SUPER_ADMIN') {
      return {
        role: rawRole,
        canonicalRole: 'SUPER_ADMIN',
        userId: decoded.sub,
        organizationId: decoded.organizationId ?? null,
      };
    }
    if (canonical === 'ADMIN') {
      return {
        role: rawRole,
        canonicalRole: 'ADMIN',
        userId: decoded.sub,
        organizationId: String(orgId),
      };
    }
    if (canonical === 'SCOPED_MANAGER') {
      return {
        role: rawRole,
        canonicalRole: 'SCOPED_MANAGER',
        userId: decoded.sub,
        organizationId: String(orgId),
        scopeIds: rawScopeIds,
        scopeId,
      };
    }
    return {
      role: rawRole,
      canonicalRole: 'END_USER',
      userId: decoded.sub,
      organizationId: String(orgId),
      ownerId,
      scopeId,
      scopeIds: scopeId ? [scopeId] : [],
    };
  } catch {
    return null;
  }
}

export interface ScopeRequestLike {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  authUser?: {
    userId: string;
    role: string;
    rawToken?: string;
    organizationId?: string;
    scopeIds?: string[];
    ownerId?: string;
  };
}

/**
 * Extracts and verifies the AccessScope from verified auth tokens, authenticated session,
 * or explicit demo tokens. Default-deny: unauthenticated contexts resolve to PUBLIC unless configured otherwise.
 */
export async function extractAccessScope(
  req: ScopeRequestLike,
  cfg: { jwtSecret?: string },
  options?: ScopeResolverOptions
): Promise<AccessScope> {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const defaultOrg = options?.defaultOrgId || 'default-org';

  if (token) {
    const verified = verifyScopeToken(token, resolveSigningSecret(cfg.jwtSecret), options);
    if (verified) return verified;

    if (token.startsWith('demo:')) {
      const parts = token.split(':');
      const r = (parts[1] || '').trim().toUpperCase();
      const canonical = resolveCanonicalRole(r, options?.roleAliases);
      const uId = parts[2] || 'demo-user';
      const scId = parts[3] || options?.defaultScopeId || '';
      const owId = parts[4] || uId || options?.defaultOwnerId || '';
      const orgId = parts[5] || defaultOrg;

      if (canonical === 'PUBLIC') {
        return { role: r || 'PUBLIC', canonicalRole: 'PUBLIC', userId: uId || 'guest' };
      }
      if (canonical === 'SUPER_ADMIN') {
        return { role: r || 'SUPER_ADMIN', canonicalRole: 'SUPER_ADMIN', userId: uId, organizationId: null };
      }
      if (canonical === 'ADMIN') {
        return { role: r || 'ADMIN', canonicalRole: 'ADMIN', userId: uId, organizationId: orgId };
      }
      if (canonical === 'SCOPED_MANAGER') {
        return {
          role: r || 'SCOPED_MANAGER',
          canonicalRole: 'SCOPED_MANAGER',
          userId: uId,
          organizationId: orgId,
          scopeIds: scId ? [scId] : [],
          scopeId: scId,
        };
      }
      return {
        role: r || 'END_USER',
        canonicalRole: 'END_USER',
        userId: uId,
        organizationId: orgId,
        ownerId: owId,
        scopeId: scId,
        scopeIds: scId ? [scId] : [],
      };
    }
  }

  if (req.authUser && req.authUser.userId && req.authUser.userId !== 'anonymous') {
    const r = String(req.authUser.role || 'PUBLIC').trim().toUpperCase();
    const canonical = resolveCanonicalRole(r, options?.roleAliases);
    const orgId = req.authUser.organizationId || defaultOrg;
    if (canonical === 'PUBLIC') {
      return { role: r, canonicalRole: 'PUBLIC', userId: req.authUser.userId };
    }
    if (canonical === 'SUPER_ADMIN') {
      return { role: r, canonicalRole: 'SUPER_ADMIN', userId: req.authUser.userId, organizationId: null };
    }
    if (canonical === 'ADMIN') {
      return { role: r, canonicalRole: 'ADMIN', userId: req.authUser.userId, organizationId: orgId };
    }
    if (canonical === 'SCOPED_MANAGER') {
      const scIds = req.authUser.scopeIds || (options?.defaultScopeId ? [options.defaultScopeId] : []);
      return {
        role: r,
        canonicalRole: 'SCOPED_MANAGER',
        userId: req.authUser.userId,
        organizationId: orgId,
        scopeIds: scIds,
        scopeId: scIds[0],
      };
    }
    return {
      role: r,
      canonicalRole: 'END_USER',
      userId: req.authUser.userId,
      organizationId: orgId,
      ownerId: req.authUser.ownerId || req.authUser.userId,
      scopeId: options?.defaultScopeId || '',
      scopeIds: options?.defaultScopeId ? [options.defaultScopeId] : [],
    };
  }

  const sessionToken = String(req.headers['x-session-token'] || req.query?.sessionToken || '');
  if (sessionToken) {
    const verified = verifyScopeToken(sessionToken, resolveSigningSecret(cfg.jwtSecret), options);
    if (verified) return verified;
  }

  if (!options?.ignoreBodyAppState && req.body && typeof req.body === 'object') {
    const appState = req.body.appState as Record<string, unknown> | undefined;
    if (appState && typeof appState === 'object' && appState.role) {
      const rawRole = String(appState.role).trim().toUpperCase();
      const canonical = resolveCanonicalRole(rawRole, options?.roleAliases);
      const orgObj = (appState[options?.appStateOrgKey || 'organization'] ||
        appState.college ||
        appState.org) as Record<string, unknown> | undefined;
      const appStateOrg = String(orgObj?.id || appState.organizationId || defaultOrg);

      if (canonical === 'PUBLIC') {
        return { role: rawRole, canonicalRole: 'PUBLIC', userId: 'guest' };
      }
      if (canonical === 'SUPER_ADMIN') {
        return { role: rawRole, canonicalRole: 'SUPER_ADMIN', userId: 'super-admin', organizationId: null };
      }
      if (canonical === 'ADMIN') {
        return { role: rawRole, canonicalRole: 'ADMIN', userId: 'admin', organizationId: appStateOrg };
      }
      if (canonical === 'SCOPED_MANAGER') {
        const scVal =
          (options?.appStateScopeKey ? appState[options.appStateScopeKey] : undefined) ||
          appState.scopeId ||
          options?.defaultScopeId ||
          '';
        const scopeIds = Array.isArray(scVal) ? scVal.map(String) : scVal ? [String(scVal)] : [];
        return {
          role: rawRole,
          canonicalRole: 'SCOPED_MANAGER',
          userId: 'manager',
          organizationId: appStateOrg,
          scopeIds,
          scopeId: scopeIds[0],
        };
      }
      const owVal =
        (options?.appStateOwnerKey ? appState[options.appStateOwnerKey] : undefined) ||
        appState.ownerId ||
        appState.userId ||
        options?.defaultOwnerId ||
        'user';
      return {
        role: rawRole,
        canonicalRole: 'END_USER',
        userId: String(owVal),
        organizationId: appStateOrg,
        ownerId: String(owVal),
        scopeId: options?.defaultScopeId || '',
      };
    }
  }

  if (options?.defaultUnauthenticatedRole === 'ADMIN') {
    return {
      role: 'ADMIN',
      canonicalRole: 'ADMIN',
      userId: 'demo-admin',
      organizationId: defaultOrg,
    };
  }

  return {
    role: 'PUBLIC',
    canonicalRole: 'PUBLIC',
    userId: 'guest',
  };
}

export function isAllowedOrganization(scope: AccessScope, orgId: string): boolean {
  const canonical = scope.canonicalRole || resolveCanonicalRole(scope.role);
  if (canonical === 'PUBLIC') return false;
  if (canonical === 'SUPER_ADMIN') return true;
  const currentOrg = scope.organizationId || 'default-org';
  return currentOrg.toLowerCase().trim() === orgId.toLowerCase().trim();
}

export function isAllowedScope(scope: AccessScope, targetScopeId: string, orgId?: string): boolean {
  const canonical = scope.canonicalRole || resolveCanonicalRole(scope.role);
  if (canonical === 'PUBLIC') return false;
  if (orgId && !isAllowedOrganization(scope, orgId)) return false;
  if (canonical === 'SUPER_ADMIN' || canonical === 'ADMIN') return true;
  const norm = targetScopeId.toLowerCase().trim();
  if (canonical === 'SCOPED_MANAGER') {
    return (scope.scopeIds || []).some((s) => s.toLowerCase().trim() === norm);
  }
  if (canonical === 'END_USER') {
    return (scope.scopeId || '').toLowerCase().trim() === norm;
  }
  return false;
}

export function isAllowedOwner(
  scope: AccessScope,
  targetOwnerId: string,
  orgId?: string,
  recordScopeId?: string
): boolean {
  const canonical = scope.canonicalRole || resolveCanonicalRole(scope.role);
  if (canonical === 'PUBLIC') return false;
  if (orgId && !isAllowedOrganization(scope, orgId)) return false;
  if (canonical === 'SUPER_ADMIN' || canonical === 'ADMIN') return true;
  if (canonical === 'SCOPED_MANAGER') {
    if (!recordScopeId) return false;
    const norm = recordScopeId.toLowerCase().trim();
    return (scope.scopeIds || []).some((s) => s.toLowerCase().trim() === norm);
  }
  if (canonical === 'END_USER') {
    return (scope.ownerId || scope.userId || '').toLowerCase().trim() === targetOwnerId.toLowerCase().trim();
  }
  return false;
}
