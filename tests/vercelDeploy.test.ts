import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_FINANCE_TOKEN, createCollegeFinanceApp } from '../apps/demo-college-finance/server.ts';
import { DEMO_LIBRARY_TOKEN, createLibraryApp } from '../apps/second-demo-app/server.ts';
import {
  registerLocalExpressApp,
  resolveAppBaseUrl,
  verifyUserToken,
} from '../packages/server/src/auth.ts';
import { loadConfig } from '../packages/server/src/config.ts';
import { ProfileRegistry } from '../packages/server/src/profiles/loader.ts';
import { getAssistantVercelApp } from '../packages/server/src/vercel.ts';

async function listenOnEphemeralPort(app: import('express').Express) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

describe('Vercel multi-service deployment & service bindings', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    registerLocalExpressApp(null);
  });

  it('1. vercel.json defines services, service bindings on api, valid per-service config, and ordered rewrites', () => {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8');
    const cfg = JSON.parse(raw) as {
      buildCommand?: unknown;
      outputDirectory?: unknown;
      functions?: unknown;
      framework?: unknown;
      installCommand?: unknown;
      devCommand?: unknown;
      ignoreCommand?: unknown;
      services: Record<
        string,
        {
          root: string;
          framework?: string;
          runtime?: string;
          entrypoint?: string;
          buildCommand?: string;
          outputDirectory?: string;
          functions?: Record<string, { includeFiles?: string; maxDuration?: number }>;
          bindings?: Array<{ type: string; service: string; format: string; env: string }>;
        }
      >;
      rewrites: Array<{ source: string; destination: { service: string } }>;
    };

    // Services mode forbids build/runtime keys at top level
    expect(cfg.buildCommand).toBeUndefined();
    expect(cfg.outputDirectory).toBeUndefined();
    expect(cfg.functions).toBeUndefined();
    expect(cfg.framework).toBeUndefined();
    expect(cfg.installCommand).toBeUndefined();
    expect(cfg.devCommand).toBeUndefined();
    expect(cfg.ignoreCommand).toBeUndefined();

    expect(cfg.services.app).toMatchObject({
      root: '.',
      framework: 'vite',
      buildCommand: 'npm run build',
      outputDirectory: 'dist',
    });

    expect(cfg.services.api).toMatchObject({
      root: '.',
      runtime: 'node',
      entrypoint: 'packages/server/src/vercel.ts',
    });
    expect(cfg.services.api.functions?.['packages/server/src/vercel.ts']?.includeFiles).toContain('profiles');
    expect(cfg.services.api.functions?.['packages/server/src/vercel.ts']?.includeFiles).toContain('data');
    expect(cfg.services.api.bindings).toEqual([
      {
        type: 'service',
        service: 'demo-college-finance',
        format: 'url',
        env: 'DEMO_COLLEGE_FINANCE_URL',
      },
      {
        type: 'service',
        service: 'second-demo-app',
        format: 'url',
        env: 'SECOND_DEMO_APP_URL',
      },
    ]);

    expect(cfg.services['demo-college-finance']).toEqual({
      root: 'apps/demo-college-finance',
      runtime: 'node',
      entrypoint: 'server.ts',
    });
    expect(cfg.services['second-demo-app']).toEqual({
      root: 'apps/second-demo-app',
      runtime: 'node',
      entrypoint: 'server.ts',
    });

    // Catch-all rewrite MUST come last after specific service prefixes
    expect(cfg.rewrites[cfg.rewrites.length - 1]).toEqual({
      source: '/(.*)',
      destination: { service: 'app' },
    });
    expect(cfg.rewrites.slice(0, -1)).toEqual(
      expect.arrayContaining([
        { source: '/api/demo/college-finance/(.*)', destination: { service: 'demo-college-finance' } },
        { source: '/api/demo/second-demo/(.*)', destination: { service: 'second-demo-app' } },
        { source: '/api/(.*)', destination: { service: 'api' } },
        { source: '/health', destination: { service: 'api' } },
      ])
    );

    expect(fs.existsSync(path.resolve(process.cwd(), 'packages/server/src/vercel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(process.cwd(), 'apps/demo-college-finance/server.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(process.cwd(), 'apps/second-demo-app/server.ts'))).toBe(true);
  });

  it('2. api, demo-college-finance, and second-demo-app run independently and communicate via bound service URLs', async () => {
    const [apiApp, financeApp, libraryApp] = [
      await getAssistantVercelApp(),
      createCollegeFinanceApp(),
      createLibraryApp(),
    ];
    const [apiSrv, financeSrv, librarySrv] = await Promise.all([
      listenOnEphemeralPort(apiApp),
      listenOnEphemeralPort(financeApp),
      listenOnEphemeralPort(libraryApp),
    ]);

    process.env.DEMO_COLLEGE_FINANCE_URL = `http://127.0.0.1:${financeSrv.port}`;
    process.env.SECOND_DEMO_APP_URL = `http://127.0.0.1:${librarySrv.port}`;

    try {
      const [healthRes, profilesRes, financeRes, libraryRes, guideRes] = await Promise.all([
        fetch(`http://127.0.0.1:${apiSrv.port}/health`),
        fetch(`http://127.0.0.1:${apiSrv.port}/api/profiles`),
        fetch(`http://127.0.0.1:${financeSrv.port}/api/demo/college-finance/students`, {
          headers: { Authorization: `Bearer ${DEMO_FINANCE_TOKEN}` },
        }),
        fetch(`http://127.0.0.1:${librarySrv.port}/api/demo/second-demo/books`, {
          headers: { Authorization: `Bearer ${DEMO_LIBRARY_TOKEN}` },
        }),
        fetch(`http://127.0.0.1:${apiSrv.port}/api/guide-step`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal: 'show me where to login',
            previousStepSummary: '',
            currentRoute: '/',
            stepNumber: 1,
            pageMap: [
              {
                id: 'login-btn',
                tag: 'button',
                type: 'button',
                label: 'Sign In',
                currentRoute: '/',
                hasValue: false,
              },
            ],
          }),
        }),
      ]);

      expect(healthRes.status).toBe(200);
      expect(profilesRes.status).toBe(200);
      expect(financeRes.status).toBe(200);
      expect(libraryRes.status).toBe(200);
      expect(guideRes.status).toBe(200);

      // Verify /me token verification resolves across service bindings when PORT 59999 is not listening
      const cfg = loadConfig({ port: 59999 });
      const registry = new ProfileRegistry();
      await registry.loadAll(cfg.profilesDir);

      const financeUser = await verifyUserToken({
        token: `Bearer ${DEMO_FINANCE_TOKEN}`,
        profile: registry.getProfile('college-finance')!,
        cfg,
      });
      expect(financeUser?.userId).toBe('bursar-01');

      const libraryUser = await verifyUserToken({
        token: `Bearer ${DEMO_LIBRARY_TOKEN}`,
        profile: registry.getProfile('second-demo')!,
        cfg,
      });
      expect(libraryUser?.userId).toBe('librarian-01');

      // Verify authenticated /api/chat read tool calls demo-college-finance via DEMO_COLLEGE_FINANCE_URL binding
      const chatRes = await fetch(`http://127.0.0.1:${apiSrv.port}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEMO_FINANCE_TOKEN}`,
        },
        body: JSON.stringify({
          appId: 'college-finance',
          messages: [{ role: 'user', content: 'how many students are enrolled?' }],
        }),
      });
      expect(chatRes.status).toBe(200);
    } finally {
      await Promise.all([
        new Promise<void>((resolve) => apiSrv.server.close(() => resolve())),
        new Promise<void>((resolve) => financeSrv.server.close(() => resolve())),
        new Promise<void>((resolve) => librarySrv.server.close(() => resolve())),
      ]);
    }
  });

  it('3. resolveAppBaseUrl uses bound service env vars when configured and falls back cleanly otherwise', () => {
    expect(
      resolveAppBaseUrl('https://external-app.example.com/api', 3000, 'external-app', {})
    ).toBe('https://external-app.example.com/api');

    expect(
      resolveAppBaseUrl('http://localhost:3000/api/demo/college-finance', 3000, 'college-finance', {
        DEMO_COLLEGE_FINANCE_URL: 'https://demo-college-finance.internal/',
      })
    ).toBe('https://demo-college-finance.internal/api/demo/college-finance');

    expect(
      resolveAppBaseUrl('http://localhost:3000/api/demo/second-demo', 3000, 'second-demo', {
        SECOND_DEMO_APP_URL: 'https://second-demo-app.internal',
      })
    ).toBe('https://second-demo-app.internal/api/demo/second-demo');
  });
});
