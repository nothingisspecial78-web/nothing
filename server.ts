import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  createAssistantRuntime,
  createPaymentWebhookHandler,
  logger,
  mountAssistantRoutes,
  shouldCompressHttpResponse,
} from '@ai-assistant/server';
import { createCollegeFinanceRouter } from './apps/demo-college-finance/server.ts';
import { createLibraryRouter } from './apps/second-demo-app/server.ts';

async function startServer() {
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  const app = express();
  app.set('trust proxy', 1);
  app.use(
    compression({
      filter: (req, res) => {
        if (!shouldCompressHttpResponse(req, res)) return false;
        return compression.filter(req, res);
      },
    })
  );
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      frameguard: false,
    })
  );

  // Initialize runtime first so raw-body webhook middleware precedes express.json()
  const runtime = await createAssistantRuntime({ port });

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

  // 1. Mount connected Demo Apps APIs
  app.use('/api/demo/college-finance', createCollegeFinanceRouter());
  app.use('/api/demo/second-demo', createLibraryRouter());

  // 2. Mount reusable AI Assistant Backend
  mountAssistantRoutes(app, runtime);

  // Guard /api/* so missing endpoints return JSON 404 instead of SPA <!doctype html>
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  // 3. Serve standalone <script> widget bundle (/widget/assistant.js)
  const widgetDistDir = path.resolve(process.cwd(), 'packages/widget/dist');
  app.use(
    '/widget',
    express.static(widgetDistDir, {
      maxAge: '1d',
    })
  );

  // 4. Serve static public files (like /embed-demo.html)
  const publicDir = path.resolve(process.cwd(), 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  // 4.5. Redirect legacy /superadmin routes cleanly to /super-admin
  app.get('/superadmin', (_req, res) => res.redirect(302, '/super-admin'));
  app.get('/superadmin/login', (_req, res) => res.redirect(302, '/super-admin/login'));

  // 5. Mount Vite dev middleware or production static build
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    // High-performance immutable caching for fingerprinted assets
    app.use(
      '/assets',
      express.static(path.join(distDir, 'assets'), {
        maxAge: '1y',
        immutable: true,
      })
    );
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    logger.info({ port, mode: isProd ? 'production' : 'development' }, 'Unified workspace server listening');
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
