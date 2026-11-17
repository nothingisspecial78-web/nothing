import { Router, type Response } from 'express';
import { ConfirmActionRequestSchema } from '@ai-assistant/core';
import type { AuthedRequest } from '../auth.ts';
import { logger, type ServerConfig } from '../config.ts';
import { verifyConfirmationToken, type ActionLogStore } from '../security/confirmation.ts';
import type { ToolRegistry } from '../tools/registry.ts';

export function createActionsRouter(params: {
  cfg: ServerConfig;
  toolRegistry: ToolRegistry;
  actionStore: ActionLogStore;
}): Router {
  const router = Router();

  router.get('/', (req: AuthedRequest, res: Response) => {
    const profile = req.appProfile;
    const authUser = req.authUser;
    if (!profile || !authUser) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const actions = params.actionStore.listActions(profile.appId, authUser.userId);
    res.json({ actions });
  });

  router.post('/:id/confirm', async (req: AuthedRequest, res: Response) => {
    const profile = req.appProfile;
    const authUser = req.authUser;
    if (!profile || !authUser) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const actionId = String(req.params.id);
    const parsed = ConfirmActionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid confirmation payload.',
        issues: parsed.error.issues.map((i) => i.message),
      });
      return;
    }

    const tokenCheck = verifyConfirmationToken(
      parsed.data.confirmationToken,
      { actionId, appId: profile.appId, userId: authUser.userId },
      params.cfg.confirmationSecret
    );

    if (!tokenCheck.valid) {
      res.status(403).json({ error: tokenCheck.reason });
      return;
    }

    const idemKey = parsed.data.idempotencyKey || req.header('X-Idempotency-Key') || undefined;
    if (idemKey) {
      const prior = params.actionStore.getExecutedIdempotencyResult(`${profile.appId}:${actionId}:${idemKey}`);
      if (prior) {
        res.json(prior);
        return;
      }
    }

    const action = params.actionStore.getAction(actionId);
    if (!action || action.appId !== profile.appId) {
      res.status(404).json({ error: 'Action not found.' });
      return;
    }

    if (action.status !== 'pending') {
      res.status(409).json({ error: `Action is already "${action.status}".` });
      return;
    }

    if (parsed.data.decision === 'cancel') {
      const updated = params.actionStore.updateAction(actionId, {
        status: 'cancelled',
        executedAt: new Date().toISOString(),
      });
      res.json({ ok: true, action: updated });
      return;
    }

    const tool = params.toolRegistry.getTool(profile, action.toolName);
    if (!tool) {
      res.status(404).json({ error: `Tool "${action.toolName}" is not available.` });
      return;
    }

    const pendingArgs = params.actionStore.getPendingArgs(actionId) || action.args;

    try {
      const result = await tool.execute(pendingArgs, {
        appId: profile.appId,
        profile,
        userId: authUser.userId,
        authToken: authUser.rawToken,
        cfg: params.cfg,
        actionStore: params.actionStore,
        appState: parsed.data.appState,
      });

      const updated = params.actionStore.updateAction(actionId, {
        status: result.ok ? 'executed' : 'failed',
        result: result.data,
        createdIds: result.createdIds || [],
        executedAt: new Date().toISOString(),
      });

      logger.info(
        {
          actionId,
          appId: profile.appId,
          userId: authUser.userId,
          toolName: action.toolName,
          createdCount: (result.createdIds || []).length,
        },
        'Confirmed write action executed'
      );

      const responsePayload = {
        ok: result.ok,
        summary: result.summary,
        result: result.data,
        uiAction: result.uiAction,
        action: updated,
      };
      if (idemKey) {
        params.actionStore.recordExecutedIdempotencyResult(
          `${profile.appId}:${actionId}:${idemKey}`,
          responsePayload
        );
      }

      res.json(responsePayload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action execution failed';
      params.actionStore.updateAction(actionId, {
        status: 'failed',
        result: { error: message },
        executedAt: new Date().toISOString(),
      });
      logger.error({ actionId, appId: profile.appId, err }, 'Confirmed action failed');
      res.status(500).json({ error: message });
    }
  });

  router.post('/:id/undo', async (req: AuthedRequest, res: Response) => {
    const profile = req.appProfile;
    const authUser = req.authUser;
    if (!profile || !authUser) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const actionId = String(req.params.id);
    const action = params.actionStore.getAction(actionId);
    const isOwner =
      action &&
      action.appId === profile.appId &&
      (action.userId === authUser.userId ||
        authUser.userId === 'anonymous' ||
        action.userId === 'anonymous');
    if (!action || !isOwner) {
      res.status(404).json({ error: 'Action log entry not found.' });
      return;
    }

    if (action.status !== 'executed') {
      res.status(409).json({ error: `Cannot undo action in status "${action.status}".` });
      return;
    }

    const tool = params.toolRegistry.getTool(profile, action.toolName);
    if (!tool || !tool.undo) {
      res.status(400).json({ error: `Tool "${action.toolName}" does not support undo.` });
      return;
    }

    try {
      const undoRes = await tool.undo(action.createdIds, action.args, {
        appId: profile.appId,
        profile,
        userId: authUser.userId,
        authToken: authUser.rawToken,
        cfg: params.cfg,
        actionStore: params.actionStore,
      });

      const updated = params.actionStore.updateAction(actionId, {
        status: 'undone',
        undoneAt: new Date().toISOString(),
      });

      logger.info({ actionId, appId: profile.appId, userId: authUser.userId }, 'Action undone');
      res.json({
        ok: true,
        summary: undoRes.summary,
        result: undoRes.data,
        undoUiAction: undoRes.uiAction,
        action: updated,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Undo failed';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
