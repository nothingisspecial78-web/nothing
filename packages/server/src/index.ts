import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { createAuthMiddleware } from './auth.ts';
import { loadConfig, logger, type ServerConfig } from './config.ts';
import { createLlmGateway, type LlmGateway } from './llm/client.ts';
import { ProfileRegistry } from './profiles/loader.ts';
import { createEmbedder, type Embedder } from './rag/embedder.ts';
import { ingestAllProfiles } from './rag/retriever.ts';
import { createVectorStore, type VectorStore } from './rag/store.ts';
import { createActionsRouter } from './routes/actions.ts';
import { createChatRouter } from './routes/chat.ts';
import { createChipsRouter } from './routes/chips.ts';
import { createGuidesRouter } from './routes/guides.ts';
import { createGuideStepRouter } from './routes/guideStep.ts';
import { createIngestRouter } from './routes/ingest.ts';
import { createTranscribeRouter } from './routes/transcribe.ts';
import { createUploadRouter } from './routes/upload.ts';
import { superAdminRouter } from './routes/superAdmin.ts';
import { ActionLogStore } from './security/confirmation.ts';
import { createIpRateLimiter, createUserRateLimiter, ResponseCache } from './security/limits.ts';
import { ToolRegistry } from './tools/registry.ts';
import { AssistantRepository } from './db/assistantRepository.ts';
import { OrgCreditStore } from './billing/creditStore.ts';
import { RazorpayPaymentProvider } from './billing/paymentProvider.ts';
import { createBillingRouter } from './routes/billing.ts';
import { createPaymentWebhookHandler, createPaymentsRouter } from './routes/payments.ts';

export interface AssistantRuntime {
  cfg: ServerConfig;
  profiles: ProfileRegistry;
  embedder: Embedder;
  vectorStore: VectorStore;
  llm: LlmGateway;
  toolRegistry: ToolRegistry;
  actionStore: ActionLogStore;
  cache: ResponseCache;
  repository: AssistantRepository;
  creditStore: OrgCreditStore;
  razorpayProvider: RazorpayPaymentProvider;
}

export async function createAssistantRuntime(
  overrides: Partial<ServerConfig> = {}
): Promise<AssistantRuntime> {
  const cfg = loadConfig(overrides);
  const profiles = new ProfileRegistry();
  await profiles.loadAll(cfg.profilesDir);

  const embedder = createEmbedder(cfg);
  const vectorStore = createVectorStore(cfg);
  const llm = createLlmGateway(cfg);
  const toolRegistry = new ToolRegistry();
  const actionStore = new ActionLogStore();
  const cache = new ResponseCache(cfg.responseCacheTtlMs);
  const repository = new AssistantRepository(cfg);
  const razorpayProvider = new RazorpayPaymentProvider(cfg);
  const creditStore = new OrgCreditStore(cfg, razorpayProvider);

  // Automatically ingest profile docs at startup so local dev & tests have ready indices
  await ingestAllProfiles({ profiles, embedder, store: vectorStore });

  return {
    cfg,
    profiles,
    embedder,
    vectorStore,
    llm,
    toolRegistry,
    actionStore,
    cache,
    repository,
    creditStore,
    razorpayProvider,
  };
}

export function mountAssistantRoutes(app: Express, runtime: AssistantRuntime): void {
  const { cfg, profiles, embedder, vectorStore, llm, toolRegistry, actionStore, cache, repository, creditStore, razorpayProvider } = runtime;

  // Dynamic per-profile CORS allowlist
  const assistantCors = cors((rawReq, callback) => {
    const req = rawReq as express.Request;
    const appId =
      (typeof req.query?.appId === 'string' && req.query.appId) ||
      (typeof req.headers['x-app-id'] === 'string' && req.headers['x-app-id']) ||
      (req.body && typeof req.body.appId === 'string' && req.body.appId) ||
      '';

    const profile = appId ? profiles.getProfile(appId) : undefined;
    const allowed = profile?.corsOrigins || ['*'];
    const origin = req.headers.origin;

    if (!origin || allowed.includes('*') || allowed.includes(origin)) {
      callback(null, { origin: true, credentials: true });
    } else {
      callback(new Error(`CORS origin "${origin}" not allowed for app "${appId}"`));
    }
  });

  const ipLimiter = createIpRateLimiter(cfg);
  const userLimiter = createUserRateLimiter(cfg);
  const authMiddleware = createAuthMiddleware(profiles, cfg);

  app.get('/health', async (_req, res) => {
    const profileSummaries = await Promise.all(
      profiles.listProfiles().map(async (p) => ({
        appId: p.appId,
        displayName: p.displayName,
        chunks: await vectorStore.count(p.appId),
      }))
    );

    res.json({
      status: 'ok',
      vectorStore: vectorStore.backend,
      embedderMode: embedder.mode,
      hasLiveLlm: llm.hasLiveProvider,
      profiles: profileSummaries,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/assistant/debug/providers', assistantCors, (_req, res) => {
    res.json({
      providers: llm.chain.getDebugStatuses(),
      timestamp: new Date().toISOString(),
    });
  });

  app.use(
    '/api/assistant',
    assistantCors,
    createChipsRouter({ cfg, repository })
  );

  app.use(
    '/api/assistant/billing',
    assistantCors,
    ipLimiter,
    createBillingRouter({ cfg, creditStore })
  );

  app.use(
    '/api/payments',
    assistantCors,
    ipLimiter,
    createPaymentsRouter({ cfg, creditStore, razorpayProvider })
  );

  app.post('/api/sync/ack', assistantCors, (req, res) => {
    const actions = Array.isArray(req.body?.actions) ? req.body.actions : [];
    res.json({
      ok: true,
      syncedCount: actions.length,
      serverTimestamp: new Date().toISOString(),
    });
  });

  app.use(
    '/api/assistant/guides',
    assistantCors,
    createGuidesRouter({ cfg, embedder, vectorStore, llm, toolRegistry, actionStore, cache, repository })
  );

  app.use(
    '/api/guide-step',
    assistantCors,
    ipLimiter,
    createGuideStepRouter({ cfg, creditStore })
  );

  app.get('/api/profiles', (_req, res) => {
    res.json({
      profiles: profiles.listProfiles().map((p) => ({
        appId: p.appId,
        displayName: p.displayName,
        languages: p.languages,
        tools: p.tools,
        templates: p.templates,
      })),
    });
  });

  app.use(
    '/api/chat',
    assistantCors,
    ipLimiter,
    authMiddleware,
    userLimiter,
    createChatRouter({ cfg, embedder, vectorStore, llm, toolRegistry, actionStore, cache, repository, creditStore })
  );

  app.use(
    '/api/upload',
    assistantCors,
    ipLimiter,
    authMiddleware,
    userLimiter,
    createUploadRouter({ cfg, profiles, actionStore, creditStore })
  );

  app.use(
    '/api/transcribe',
    assistantCors,
    ipLimiter,
    authMiddleware,
    userLimiter,
    createTranscribeRouter({ cfg, creditStore })
  );

  app.use(
    '/api/actions',
    assistantCors,
    ipLimiter,
    authMiddleware,
    userLimiter,
    createActionsRouter({ cfg, toolRegistry, actionStore })
  );

  app.use(
    '/api/super-admin',
    assistantCors,
    superAdminRouter
  );

  app.use(
    '/api/ingest',
    assistantCors,
    ipLimiter,
    createIngestRouter({ profiles, embedder, vectorStore, cache })
  );
}

export async function createStandaloneAssistantApp(
  overrides: Partial<ServerConfig> = {}
): Promise<{ app: Express; runtime: AssistantRuntime }> {
  const runtime = await createAssistantRuntime(overrides);
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      frameguard: false,
    })
  );
  app.post(
    '/api/payments/webhook',
    express.raw({ type: 'application/json', limit: '2mb' }),
    createPaymentWebhookHandler({
      cfg: runtime.cfg,
      creditStore: runtime.creditStore,
      razorpayProvider: runtime.razorpayProvider,
    })
  );
  app.use(express.json({ limit: '10mb' }));
  mountAssistantRoutes(app, runtime);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  return { app, runtime };
}

// Allow running packages/server directly if invoked as standalone backend
const isMain = process.argv[1] && process.argv[1].endsWith('packages/server/src/index.ts');
if (isMain) {
  createStandaloneAssistantApp().then(({ app, runtime }) => {
    app.listen(runtime.cfg.port, '0.0.0.0', () => {
      logger.info({ port: runtime.cfg.port }, 'Standalone AI Assistant backend listening');
    });
  });
}

export * from './config.ts';
export * from './auth.ts';
export * from './profiles/loader.ts';
export * from './rag/chunker.ts';
export * from './rag/embedder.ts';
export * from './rag/store.ts';
export * from './rag/retriever.ts';
export * from './files/parseSheet.ts';
export * from './files/validate.ts';
export * from './tools/registry.ts';
export * from './tools/types.ts';
export * from './security/confirmation.ts';
export * from './security/sanitize.ts';
export * from './security/limits.ts';
export * from './llm/client.ts';
export * from './llm/prompts.ts';
export * from './llm/agentLoop.ts';
export * from './security/scope.ts';
export * from './chips/pageRegistry.ts';
export * from './chips/suggestionChips.ts';
export * from './routes/chips.ts';
export * from './db/assistantRepository.ts';
export * from './llm/providerChain.ts';
export * from './llm/summarizer.ts';
export * from './routes/superAdmin.ts';
export * from './db/scopedDataRepository.ts';
export * from './tools/dataAccessTools.ts';
export * from './routes/guideStep.ts';
export * from './billing/types.ts';
export * from './billing/config.ts';
export * from './billing/paymentProvider.ts';
export * from './billing/creditStore.ts';
export * from './billing/checkAndConsume.ts';
export * from './routes/billing.ts';
export * from './routes/payments.ts';
export { shouldCompressHttpResponse } from './routes/chat.ts';
export * from './serverKit.ts';

