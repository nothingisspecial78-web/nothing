import { beforeAll, describe, expect, it } from 'vitest';
import type { AppProfile } from '@ai-assistant/core';
import { ActionLogStore } from '../packages/server/src/security/confirmation.ts';
import { loadConfig } from '../packages/server/src/config.ts';
import { ProfileRegistry } from '../packages/server/src/profiles/loader.ts';
import { KHAZNA_BUILTIN_TOOLS } from '../packages/server/src/tools/khaznaTools.ts';

let khaznaProfile: AppProfile;

beforeAll(async () => {
  const cfg = loadConfig();
  const registry = new ProfileRegistry();
  await registry.loadAll(cfg.profilesDir);
  khaznaProfile = registry.getProfile('khazna-ledger')!;
});

function makeCtx(appState: Record<string, unknown>) {
  return {
    appId: 'khazna-ledger',
    profile: khaznaProfile,
    userId: 'mgr-fiqh',
    authToken: '',
    cfg: loadConfig(),
    actionStore: new ActionLogStore(),
    appState,
  };
}

describe('Khazna Sector Debit Count & Logout Fixes', () => {
  it('counts students with debit entries and negative-balance dues accurately in Manager mode', async () => {
    const res = await KHAZNA_BUILTIN_TOOLS.khaznaListStudents.execute(
      { hasDebit: true },
      makeCtx({
        role: 'manager',
        managerSector: 'dept-fiqh',
        sectors: [{ slug: 'dept-fiqh', name: 'Dept Fiqh', receiptPrefix: 'DF-' }],
        students: [
          { id: 'S0125', name: 'Safwan K.', className: 'Fiqh 2', credit: 0, debit: 500, balance: -500 },
          { id: 'S0126', name: 'Amina R.', className: 'Fiqh 2', credit: 1000, debit: 800, balance: 200 },
          { id: 'S0127', name: 'Bilal P.', className: 'Fiqh 1', credit: 500, debit: 0, balance: 500 },
        ],
      })
    );

    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({
      total: 2,
      totalStudentsInScope: 3,
      totalDebit: 1300,
      dueCount: 1,
      totalDue: 500,
    });
    expect(res.summary).toContain('**2** student(s) with debit entries');
    expect(res.summary).toContain('**1** currently have unpaid dues totaling ₹500');
  });

  it('filters pendingOnly students using negative balance = unpaid due', async () => {
    const res = await KHAZNA_BUILTIN_TOOLS.khaznaListStudents.execute(
      { pendingOnly: true },
      makeCtx({
        role: 'manager',
        managerSector: 'dept-fiqh',
        sectors: [{ slug: 'dept-fiqh', name: 'Dept Fiqh', receiptPrefix: 'DF-' }],
        students: [
          { id: 'S0125', name: 'Safwan K.', className: 'Fiqh 2', credit: 0, debit: 500, balance: -500 },
          { id: 'S0126', name: 'Amina R.', className: 'Fiqh 2', credit: 1000, debit: 800, balance: 200 },
        ],
      })
    );

    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ total: 1, totalDue: 500 });
    expect(res.summary).toContain('Safwan K.');
    expect(res.summary).not.toContain('Amina R.');
  });

  it('allows signing out to /login across any role', async () => {
    for (const role of ['admin', 'manager', 'student']) {
      const res = await KHAZNA_BUILTIN_TOOLS.khaznaNavigate.execute(
        { route: '/login' },
        makeCtx({ role, pathname: '/m/dept-fiqh' })
      );
      expect(res.ok).toBe(true);
      expect(res.uiAction?.appCommand?.payload).toMatchObject({
        route: '/login',
        signOut: true,
      });
    }
  });
});
