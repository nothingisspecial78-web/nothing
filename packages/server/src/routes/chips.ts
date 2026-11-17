import express, { type Request, type Response } from 'express';
import type { ServerConfig } from '../config.ts';
import type { AssistantRepository } from '../db/assistantRepository.ts';
import { extractAccessScope } from '../security/scope.ts';
import {
  clearUserAbandonedForm,
  getUserRecentActivity,
  recordUserAbandonedForm,
} from '../tools/datasetState.ts';
import {
  clearSuggestionChipsCache,
  getSuggestionChips,
} from '../chips/suggestionChips.ts';

export function createChipsRouter(params: {
  cfg: ServerConfig;
  repository: AssistantRepository;
}): express.Router {
  const router = express.Router();
  const { cfg, repository } = params;

  // GET /api/assistant/chips?pageId=...&pathname=...&appId=...&lang=...
  router.get('/chips', async (req: Request, res: Response) => {
    const start = Date.now();
    try {
      const scope = await extractAccessScope(req, cfg, { defaultUnauthenticatedRole: 'PUBLIC' });
      const appId = String(req.query.appId || req.headers['x-app-id'] || 'khazna-ledger').trim();
      const rawPage = String(req.query.pathname || req.query.pageId || 'global');
      const pageIdParam = typeof req.query.pageId === 'string' ? req.query.pageId : undefined;
      const lang = (String(req.query.lang || 'en').toLowerCase() === 'ml' ? 'ml' : 'en') as 'en' | 'ml';

      const usages = await repository.getChipUsages(scope.userId, rawPage);
      const chipUsageMap = new Map(
        usages.map((u) => [
          u.chipId,
          { shownCount: u.shownCount, clickCount: u.clickCount, lastClickedAt: u.lastClickedAt },
        ])
      );

      const recentActivity = getUserRecentActivity(appId, scope, scope.userId);
      const dueAmount = req.query.dueAmount ? Number(req.query.dueAmount) : undefined;
      const unpaidCount = req.query.unpaidCount ? Number(req.query.unpaidCount) : undefined;
      const unassignedSectorsCount = req.query.unassignedSectorsCount
        ? Number(req.query.unassignedSectorsCount)
        : undefined;

      const result = getSuggestionChips(
        { userId: scope.userId, role: scope.role, scope },
        { pageId: pageIdParam, pathname: rawPage },
        recentActivity,
        {
          appId,
          lang,
          chipUsageMap,
          dueAmount,
          unpaidCount,
          unassignedSectorsCount,
        }
      );

      // Record impression asynchronously
      void repository.recordChipImpression(
        scope.userId,
        result.pageId,
        result.chips.map((c) => c.id)
      );

      const latencyMs = Date.now() - start;
      res.setHeader('X-Response-Time', `${latencyMs}ms`);
      res.json({
        ok: true,
        pageId: result.pageId,
        pageTitle: result.pageTitle,
        role: scope.role,
        chips: result.chips,
        latencyMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  // POST /api/assistant/chips/click
  router.post('/chips/click', async (req: Request, res: Response) => {
    try {
      const scope = await extractAccessScope(req, cfg, { defaultUnauthenticatedRole: 'PUBLIC' });
      const chipId = String(req.body?.chipId || '').trim();
      const pageId = String(req.body?.pageId || 'global').trim();

      if (!chipId) {
        res.status(400).json({ ok: false, error: 'chipId is required' });
        return;
      }

      await repository.recordChipClick(scope.userId, pageId, chipId);
      clearSuggestionChipsCache(scope.userId);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  // POST /api/assistant/activity/abandoned
  router.post('/activity/abandoned', async (req: Request, res: Response) => {
    try {
      const scope = await extractAccessScope(req, cfg, { defaultUnauthenticatedRole: 'PUBLIC' });
      const appId = String(req.body?.appId || req.headers['x-app-id'] || 'khazna-ledger').trim();
      const formType = String(req.body?.formType || 'FORM').trim();
      const title = String(req.body?.title || formType).trim();
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : undefined;
      const submitted = Boolean(req.body?.submitted);

      if (submitted) {
        clearUserAbandonedForm({ appId, scope, userId: scope.userId });
      } else {
        recordUserAbandonedForm({
          appId,
          scope,
          userId: scope.userId,
          formType,
          title,
          prompt,
        });
      }
      clearSuggestionChipsCache(scope.userId);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
