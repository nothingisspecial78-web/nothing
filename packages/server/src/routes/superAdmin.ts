import express, { type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { createScopeToken, verifyScopeToken, type AccessScope } from '../security/scope.ts';
import { scopedRepository } from '../db/scopedDataRepository.ts';

export interface PlatformSuperAdmin {
  id: string;
  email: string;
  passwordHash: string;
  role: 'SUPER_ADMIN';
  organizationId: null;
  status: 'active';
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

function resolveDataFile(fileName: string): string {
  const tmpPath = path.join('/tmp', 'khazna-platform-data', fileName);
  if (fs.existsSync(tmpPath)) return tmpPath;
  const candidates = [
    path.resolve(process.cwd(), 'data', fileName),
    path.resolve(import.meta.dirname, '../../../../data', fileName),
    path.resolve(import.meta.dirname, '../../../data', fileName),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function resolveWritableDataFile(fileName: string): string {
  if (process.env.VERCEL) {
    return path.join('/tmp', 'khazna-platform-data', fileName);
  }
  return resolveDataFile(fileName);
}

export function loadSuperAdminStore(): PlatformSuperAdmin[] {
  const storePath = resolveDataFile('platform_admins.json');
  if (!fs.existsSync(storePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(storePath, 'utf-8');
    return JSON.parse(raw) as PlatformSuperAdmin[];
  } catch {
    return [];
  }
}

export function saveSuperAdminStore(admins: PlatformSuperAdmin[]): void {
  const target = resolveWritableDataFile('platform_admins.json');
  try {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(target, JSON.stringify(admins, null, 2), 'utf-8');
  } catch {
    const fallback = path.join('/tmp', 'khazna-platform-data', 'platform_admins.json');
    fs.mkdirSync(path.dirname(fallback), { recursive: true });
    fs.writeFileSync(fallback, JSON.stringify(admins, null, 2), 'utf-8');
  }
}

const router = express.Router();

// Rate limiting & lockout state: 5 failures within 15 mins -> 15 min lockout
interface AttemptRecord {
  failures: number;
  lockedUntil?: number;
}
const loginAttempts = new Map<string, AttemptRecord>();

function getAttemptKey(req: Request, email: string): string {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `${ip}::${email.toLowerCase().trim()}`;
}

function checkRateLimit(key: string): { allowed: boolean; waitSec?: number } {
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (!rec) return { allowed: true };
  if (rec.lockedUntil && rec.lockedUntil > now) {
    return { allowed: false, waitSec: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  return { allowed: true };
}

function recordFailure(key: string): { locked: boolean } {
  const now = Date.now();
  const rec = loginAttempts.get(key) || { failures: 0 };
  rec.failures += 1;
  if (rec.failures >= 5) {
    rec.lockedUntil = now + 15 * 60 * 1000; // 15 mins
    loginAttempts.set(key, rec);
    return { locked: true };
  }
  loginAttempts.set(key, rec);
  return { locked: false };
}

function recordSuccess(key: string): void {
  loginAttempts.delete(key);
}

// Platform audit log store
export function logSuperAdminAction(adminId: string, action: string, details: Record<string, unknown>): void {
  try {
    const readFile = resolveDataFile('platform_audit_logs.json');
    let logs: Array<Record<string, unknown>> = [];
    if (fs.existsSync(readFile)) {
      logs = JSON.parse(fs.readFileSync(readFile, 'utf-8'));
    }
    logs.unshift({
      id: `sa-log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      adminId,
      action,
      details,
      timestamp: new Date().toISOString(),
    });
    const writeFile = resolveWritableDataFile('platform_audit_logs.json');
    const dir = path.dirname(writeFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // keep last 500 logs
    fs.writeFileSync(writeFile, JSON.stringify(logs.slice(0, 500), null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write platform audit log:', err);
  }
}

// Authentication Middleware
export function requireSuperAdminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  const token = authHeader.slice(7).trim();
  const scope = verifyScopeToken(token);

  if (!scope || scope.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Forbidden: Platform Super Admin role required.' });
  }

  (req as Request & { superAdminScope: AccessScope }).superAdminScope = scope;
  next();
}

// 1. Super Admin Login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const rateKey = getAttemptKey(req, cleanEmail);
  const rateCheck = checkRateLimit(rateKey);

  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: `Too many failed login attempts. Account locked for ${rateCheck.waitSec} seconds.`,
    });
  }

  const admins = loadSuperAdminStore();
  const admin = admins.find((a) => a.email.toLowerCase() === cleanEmail && a.status === 'active');

  if (!admin || !bcrypt.compareSync(password, admin.passwordHash)) {
    const status = recordFailure(rateKey);
    return res.status(401).json({
      error: status.locked
        ? 'Account locked for 15 minutes due to 5 consecutive failed attempts.'
        : 'Invalid email or password.',
    });
  }

  recordSuccess(rateKey);

  // Update last login timestamp
  admin.lastLoginAt = new Date().toISOString();
  saveSuperAdminStore(admins);

  const scope: AccessScope = {
    role: 'SUPER_ADMIN',
    userId: admin.id,
    organizationId: null,
  };

  const token = createScopeToken(scope, undefined, '8h');
  logSuperAdminAction(admin.id, 'LOGIN', { ip: req.ip, email: admin.email });

  return res.json({
    ok: true,
    token,
    admin: {
      id: admin.id,
      email: admin.email,
      role: 'SUPER_ADMIN',
      mustChangePassword: admin.mustChangePassword,
      lastLoginAt: admin.lastLoginAt,
    },
  });
});

// 2. Logout
router.post('/logout', requireSuperAdminAuth, (req: Request, res: Response) => {
  const scope = (req as Request & { superAdminScope: AccessScope }).superAdminScope;
  logSuperAdminAction(scope.userId, 'LOGOUT', {});
  return res.json({ ok: true, message: 'Logged out successfully' });
});

// 3. Me
router.get('/me', requireSuperAdminAuth, (req: Request, res: Response) => {
  const scope = (req as Request & { superAdminScope: AccessScope }).superAdminScope;
  const admins = loadSuperAdminStore();
  const admin = admins.find((a) => a.id === scope.userId);
  if (!admin) return res.status(404).json({ error: 'Super Admin not found' });
  return res.json({
    id: admin.id,
    email: admin.email,
    role: admin.role,
    mustChangePassword: admin.mustChangePassword,
    lastLoginAt: admin.lastLoginAt,
  });
});

// 4. List all organizations
router.get('/organizations', requireSuperAdminAuth, async (req: Request, res: Response) => {
  const scope = (req as Request & { superAdminScope: AccessScope }).superAdminScope;
  const orgs = await scopedRepository.listOrganizations(scope);
  return res.json({ ok: true, organizations: orgs });
});

// 5. Organization drill-down
router.get('/organizations/:id', requireSuperAdminAuth, async (req: Request, res: Response) => {
  const scope = (req as Request & { superAdminScope: AccessScope }).superAdminScope;
  const orgId = req.params.id;
  const orgs = await scopedRepository.listOrganizations(scope);
  const found = orgs.find((o) => o.id === orgId);
  if (!found) return res.status(404).json({ error: 'Organization not found' });

  // Scoped read for that specific organization
  const orgScope: AccessScope = {
    role: 'ADMIN',
    userId: scope.userId,
    organizationId: orgId,
  };
  const sectors = await scopedRepository.findSectors('', orgScope);
  return res.json({ ok: true, organization: found, sectors });
});

// 6. Platform Usage Analytics
router.get('/analytics', requireSuperAdminAuth, async (req: Request, res: Response) => {
  const scope = (req as Request & { superAdminScope: AccessScope }).superAdminScope;
  const usage = await scopedRepository.summarizePlatformUsage(scope);
  return res.json({ ok: true, analytics: usage });
});

// 7. Audit Logs
router.get('/audit-logs', requireSuperAdminAuth, (_req: Request, res: Response) => {
  let logs: Array<Record<string, unknown>> = [];
  const auditFile = resolveDataFile('platform_audit_logs.json');
  if (fs.existsSync(auditFile)) {
    try {
      logs = JSON.parse(fs.readFileSync(auditFile, 'utf-8'));
    } catch {
      logs = [];
    }
  }
  return res.json({ ok: true, auditLogs: logs });
});

// 8. Change Password
router.post('/change-password', requireSuperAdminAuth, (req: Request, res: Response) => {
  const scope = (req as Request & { superAdminScope: AccessScope }).superAdminScope;
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }

  if (typeof newPassword !== 'string' || newPassword.length < 12) {
    return res.status(400).json({ error: 'New password must be at least 12 characters long.' });
  }

  const admins = loadSuperAdminStore();
  const admin = admins.find((a) => a.id === scope.userId);
  if (!admin) return res.status(404).json({ error: 'Super Admin not found.' });

  if (!bcrypt.compareSync(currentPassword, admin.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const salt = bcrypt.genSaltSync(12);
  admin.passwordHash = bcrypt.hashSync(newPassword, salt);
  admin.mustChangePassword = false;
  admin.updatedAt = new Date().toISOString();
  saveSuperAdminStore(admins);

  logSuperAdminAction(admin.id, 'CHANGE_PASSWORD', {});
  return res.json({ ok: true, message: 'Password changed successfully.' });
});

export { router as superAdminRouter };
