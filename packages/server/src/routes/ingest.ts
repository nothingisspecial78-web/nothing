import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { logger } from '../config.ts';
import type { ProfileRegistry } from '../profiles/loader.ts';
import type { Embedder } from '../rag/embedder.ts';
import { ingestAllProfiles, ingestAppDocs } from '../rag/retriever.ts';
import type { VectorStore } from '../rag/store.ts';
import type { ResponseCache } from '../security/limits.ts';

const IngestBodySchema = z.object({
  appId: z.string().min(1).optional(),
});

export function createIngestRouter(params: {
  profiles: ProfileRegistry;
  embedder: Embedder;
  vectorStore: VectorStore;
  cache: ResponseCache;
}): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const parsed = IngestBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid ingest request.' });
      return;
    }

    const { appId } = parsed.data;
    try {
      if (appId) {
        if (!params.profiles.getProfile(appId)) {
          res.status(404).json({ error: `Unknown appId "${appId}".` });
          return;
        }
        const result = await ingestAppDocs({
          appId,
          profiles: params.profiles,
          embedder: params.embedder,
          store: params.vectorStore,
        });
        params.cache.clearForApp(appId);
        logger.info(result, 'Ingested app docs');
        res.json({ ok: true, results: [result] });
        return;
      }

      const results = await ingestAllProfiles({
        profiles: params.profiles,
        embedder: params.embedder,
        store: params.vectorStore,
      });
      for (const r of results) params.cache.clearForApp(r.appId);
      logger.info({ results }, 'Ingested all profile docs');
      res.json({ ok: true, results });
    } catch (err) {
      logger.error({ err }, 'Ingestion failed');
      res.status(500).json({ error: 'Document ingestion failed.' });
    }
  });

  return router;
}
