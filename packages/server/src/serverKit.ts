import crypto from 'node:crypto';
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import {
  type AssistantConfig,
  type AssistantEntityConfig,
  type AssistantAdapters,
  type UserContext,
  validateAssistantConfig,
  getPlugins,
  ChatRequestSchema,
} from '@ai-assistant/core';
import { createChatRouter, type ServerDeps } from './routes/chat.ts';
import { createPaymentsRouter } from './routes/payments.ts';
import { createUploadRouter } from './routes/upload.ts';
import { createIpRateLimiter, createUserRateLimiter } from './security/limits.ts';
import { logger } from './config.ts';
import { registerEntityConfig } from './entityRegistry/searchEngine.ts';

export interface ServerKitOptions {
  config: AssistantConfig | AssistantEntityConfig | any;
  adapters?: AssistantAdapters;
  deps?: Partial<ServerDeps>;
  auditHook?: (event: { action: string; user?: UserContext; orgId?: string; details?: unknown; timestamp: string }) => Promise<void> | void;
}

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  checks: {
    config: { valid: boolean; errors?: string[] };
    env: { present: string[]; missing: string[] };
    server: { uptimeSeconds: number; memoryUsageMb: number };
    model: { configured: boolean; provider: string; modelName: string };
    adapters: { dataAdapterReady: boolean; testQuerySuccess: boolean; testCount?: number };
    theme: { loaded: boolean; mode: string; primaryColor: string };
  };
}

/**
 * Creates drop-in Express router containing all assistant endpoints.
 */
export function createAssistantServerRouter(options: ServerKitOptions): Router {
  const router = Router();
  const config = options.config;
  const adapters = options.adapters;

  if (config && ('entities' in config || 'appId' in config)) {
    registerEntityConfig(config as any);
  }

  // Rate limiting middleware
  const ipLimiter = createIpRateLimiter(120, 60 * 1000); // 120 req/min
  router.use(ipLimiter);

  // Request size limit & JSON parser
  router.use(express.json({ limit: '10mb' }));
  router.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Audit logging middleware & tenant scope extraction
  router.use((req: Request, _res: Response, next: NextFunction) => {
    const orgId =
      (req.headers['x-organization-id'] as string) ||
      (req.headers['x-org-id'] as string) ||
      (req.query.orgId as string) ||
      (req.body && req.body.orgId) ||
      'default-org';

    (req as any).organizationId = orgId;

    // Structured logging without secrets
    logger.info({
      msg: 'Assistant request received',
      method: req.method,
      path: req.path,
      orgId,
    });

    next();
  });

  // ============================================================================
  // 1. Health & Doctor Endpoint (/health)
  // ============================================================================
  router.get('/health', async (_req: Request, res: Response) => {
    let configValidation = validateAssistantConfig(config);
    if (!configValidation.valid && (config as any)?.appId) {
      configValidation = { valid: true, errors: [], summary: 'Valid AssistantEntityConfig' };
    }

    const checkedEnvVars = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'JWT_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'SUPABASE_URL'];
    const presentEnvs: string[] = [];
    const missingEnvs: string[] = [];
    for (const v of checkedEnvVars) {
      if (process.env[v]) presentEnvs.push(v);
      else missingEnvs.push(v);
    }

    let testQuerySuccess = false;
    let testCount = 0;
    if (adapters?.data) {
      try {
        const firstEntity = config.entities?.[0]?.collection || config.entities?.[0]?.type || 'default';
        const results = await adapters.data.search(firstEntity, '', {}, { id: 'health-check', role: 'SUPER_ADMIN' });
        testQuerySuccess = true;
        testCount = results.length;
      } catch {
        testQuerySuccess = false;
      }
    } else {
      testQuerySuccess = true; // default memory or embedded
    }

    const checks: HealthCheckResult['checks'] = {
      config: {
        valid: configValidation.valid,
        errors: configValidation.errors,
      },
      env: {
        present: presentEnvs,
        missing: missingEnvs,
      },
      server: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      model: {
        configured: Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY),
        provider: config.ai?.providerOrder?.[0] || 'gemini',
        modelName: config.ai?.models?.default || 'gemini-2.5-flash',
      },
      adapters: {
        dataAdapterReady: Boolean(adapters?.data),
        testQuerySuccess,
        testCount,
      },
      theme: {
        loaded: Boolean(config.theme),
        mode: config.theme?.mode || 'auto',
        primaryColor: config.theme?.colors?.primary || '#0ea5e9',
      },
    };

    const overallStatus: HealthCheckResult['status'] =
      configValidation.valid && checks.model.configured ? 'ok' : 'degraded';

    res.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  // ============================================================================
  // 2. Chat / Assistant Unified Route (/assistant & /chat)
  // ============================================================================
  const chatHandler = async (req: Request, res: Response) => {
    // If runtime deps provided, route through LLM agent loop
    if (options.deps && options.deps.llm) {
      const chatRouter = createChatRouter(options.deps as ServerDeps);
      return chatRouter(req, res, () => {});
    }

    // Generic fallback streaming response for lightweight deployments
    const body = req.body || {};
    const message = body.message || (Array.isArray(body.messages) ? body.messages[body.messages.length - 1]?.content : '');

    // Set streaming SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const appName = (config as any)?.app?.name || (config as any)?.appName || 'the application';
    const reply = `I received your request regarding ${appName}: "${message}".`;
    res.write(`event: token\ndata: ${JSON.stringify({ token: reply })}\n\n`);
    res.write(`event: done\ndata: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

    // Trigger audit hook
    if (options.auditHook) {
      options.auditHook({
        action: 'chat_completed',
        orgId: (req as any).organizationId,
        details: { messageLength: message.length },
        timestamp: new Date().toISOString(),
      });
    }
  };

  router.post('/assistant', chatHandler);
  router.post('/chat', chatHandler);

  // ============================================================================
  // 3. Payments Routes (/payments/create-order, /payments/verify, /payments/webhook)
  // ============================================================================
  router.post('/payments/create-order', async (req: Request, res: Response) => {
    try {
      const { planId = 'premium_monthly' } = req.body || {};
      const orgId = (req as any).organizationId || 'default-org';

      if (adapters?.billing) {
        const session = await adapters.billing.createCheckout(planId, orgId);
        res.json(session);
        return;
      }

      // Default mock Razorpay order
      const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      res.json({
        orderId,
        amount: 49900,
        currency: 'INR',
        keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_mock',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to create checkout order' });
    }
  });

  router.post('/payments/verify', async (req: Request, res: Response) => {
    try {
      const { orderId, paymentId, signature, planId } = req.body || {};
      if (!orderId || !paymentId) {
        res.status(400).json({ error: 'Missing orderId or paymentId' });
        return;
      }

      if (adapters?.billing) {
        const result = await adapters.billing.verify({ orderId, paymentId, signature, planId });
        res.json(result);
        return;
      }

      res.json({
        verified: true,
        plan: {
          planId: planId || 'premium_monthly',
          isPremium: true,
          creditsRemaining: 1000,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Payment verification failed' });
    }
  });

  router.post('/payments/webhook', async (req: Request, res: Response) => {
    logger.info({ msg: 'Payment webhook received', event: req.body?.event });
    res.json({ status: 'ok' });
  });

  // ============================================================================
  // 4. Export & Import Routes (/export, /import)
  // ============================================================================
  router.post('/export', async (req: Request, res: Response) => {
    const { format = 'csv', entityType, columns, data } = req.body || {};
    res.json({
      success: true,
      format,
      entityType,
      recordCount: Array.isArray(data) ? data.length : 0,
      timestamp: new Date().toISOString(),
    });
  });

  router.post('/import', async (req: Request, res: Response) => {
    const { entityType, rows } = req.body || {};
    res.json({
      success: true,
      entityType,
      importedCount: Array.isArray(rows) ? rows.length : 0,
    });
  });

  return router;
}

/**
 * Drop-in handler for Next.js (App Router route.ts or Pages Router API)
 */
export function createAssistantNextHandler(options: ServerKitOptions) {
  const router = createAssistantServerRouter(options);

  return async function nextHandler(req: any, res?: any) {
    if (res && typeof res.status === 'function') {
      // Pages Router: handler(req, res)
      return new Promise<void>((resolve) => {
        router(req, res, () => resolve());
      });
    }

    // Next.js App Router: handler(request: Request)
    const url = new URL(req.url);
    const mockReq: any = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: Object.fromEntries(req.headers.entries()),
      body: req.method !== 'GET' ? await req.json().catch(() => ({})) : {},
    };

    let statusCode = 200;
    let responseHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    let responseBody = '';

    const mockRes: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      setHeader(k: string, v: string) {
        responseHeaders[k] = v;
        return this;
      },
      json(data: any) {
        responseBody = JSON.stringify(data);
        return this;
      },
      write(chunk: string) {
        responseBody += chunk;
      },
      end() {},
    };

    await new Promise<void>((resolve) => {
      router(mockReq, mockRes, () => resolve());
    });

    return new Response(responseBody, {
      status: statusCode,
      headers: responseHeaders,
    });
  };
}
