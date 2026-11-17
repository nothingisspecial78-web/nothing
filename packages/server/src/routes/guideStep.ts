import { GoogleGenAI } from '@google/genai';
import { Router, type Request, type Response } from 'express';
import {
  buildDeterministicGuideStep,
  detectAmbiguousGuidePaths,
  estimateRequiredGuideSteps,
  GUIDE_SYSTEM_PROMPT,
  GuideStepRequestSchema,
  MAX_GUIDE_STEPS,
  OPENROUTER_GUIDE_MODELS,
  resolveGuideTroubleshootingStep,
  sanitizeGuideStepDecision,
  type AvailableRouteHint,
  type GuideStepResponse,
  type GuideTroubleshootingContext,
  type PageMapElement,
} from '@ai-assistant/core';
import { logger, type ServerConfig } from '../config.ts';
import { checkAndConsume } from '../billing/checkAndConsume.ts';
import type { OrgCreditStore } from '../billing/creditStore.ts';
import { extractAccessScope } from '../security/scope.ts';
import { isPublicAuthContext, isPublicGuideGoalAllowed } from '../llm/publicGuard.ts';

export interface GuideStepRouteDeps {
  cfg: Pick<ServerConfig, 'openRouterApiKey' | 'llmTimeoutMs' | 'jwtSecret'> &
    Partial<Pick<ServerConfig, 'geminiApiKey' | 'groqApiKey'>>;
  creditStore?: OrgCreditStore;
  fetchImpl?: typeof fetch;
}

export interface OpenRouterGuidePayload {
  models: string[];
  route: 'fallback';
  response_format: { type: 'json_object' };
  temperature: number;
  max_tokens: number;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
}

export function parseGuideJsonResponse(rawText: string): Record<string, unknown> | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(withoutFence);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const firstBrace = withoutFence.indexOf('{');
    const lastBrace = withoutFence.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        const sliced = JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
        return sliced && typeof sliced === 'object' && !Array.isArray(sliced)
          ? (sliced as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildCompactGuideUserJson(params: {
  goal: string;
  previousStepSummary: string;
  currentRoute: string;
  stepNumber: number;
  pageMap: PageMapElement[];
  confirmedPath?: boolean;
  preferredTargetId?: string;
  preferredRoute?: string;
  availableRoutes?: AvailableRouteHint[];
  appContext?: string;
}): string {
  const compactElements = params.pageMap.slice(0, 60).map((el) => ({
    id: el.id,
    tag: el.tag,
    type: el.type,
    label: el.label,
    hasValue: el.hasValue,
    ...(el.sensitive ? { sensitive: true } : {}),
  }));

  const compactPrev =
    params.previousStepSummary.length > 380
      ? params.previousStepSummary.slice(-380)
      : params.previousStepSummary;

  const userPayload: Record<string, unknown> = {
    goal: params.goal,
    route: params.currentRoute,
    step: params.stepNumber,
    prev: compactPrev,
    pageMap: compactElements,
  };

  if (typeof params.confirmedPath === 'boolean') {
    userPayload.confirmedPath = params.confirmedPath;
  }
  if (params.preferredTargetId) {
    userPayload.preferredTargetId = params.preferredTargetId;
  }
  if (params.preferredRoute) {
    userPayload.preferredRoute = params.preferredRoute;
  }
  if (params.availableRoutes && params.availableRoutes.length > 0) {
    userPayload.routes = params.availableRoutes.slice(0, 25);
  }
  if (params.appContext) {
    userPayload.ctx = params.appContext.slice(0, 240);
  }

  return JSON.stringify(userPayload);
}

/**
 * Builds the token-minimized OpenRouter chat completions payload.
 * Sends ONLY compact pageMap JSON, goal, route, stepNumber, previousStepSummary,
 * and (on unconfirmed step 1) compact route/app hints for dynamic disambiguation.
 */
export function buildOpenRouterGuidePayload(params: {
  goal: string;
  previousStepSummary: string;
  currentRoute: string;
  stepNumber: number;
  pageMap: PageMapElement[];
  confirmedPath?: boolean;
  preferredTargetId?: string;
  preferredRoute?: string;
  availableRoutes?: AvailableRouteHint[];
  appContext?: string;
}): OpenRouterGuidePayload {
  return {
    models: [...OPENROUTER_GUIDE_MODELS],
    route: 'fallback',
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: params.stepNumber === 1 && !params.confirmedPath ? 360 : 180,
    messages: [
      { role: 'system', content: GUIDE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildCompactGuideUserJson(params),
      },
    ],
  };
}

export async function resolveGuideStepDecision(params: {
  goal: string;
  previousStepSummary: string;
  currentRoute: string;
  stepNumber: number;
  pageMap: PageMapElement[];
  confirmedPath?: boolean;
  preferredTargetId?: string;
  preferredRoute?: string;
  availableRoutes?: AvailableRouteHint[];
  appContext?: string;
  pageErrors?: string[];
  userReply?: string;
  troubleshootingContext?: GuideTroubleshootingContext;
  openRouterApiKey?: string;
  geminiApiKey?: string;
  groqApiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<GuideStepResponse> {
  const {
    goal: rawGoal,
    previousStepSummary: rawPreviousStepSummary,
    currentRoute,
    stepNumber: rawStepNumber,
    pageMap,
    confirmedPath: rawConfirmedPath = false,
    preferredTargetId,
    preferredRoute,
    availableRoutes = [],
    appContext,
    pageErrors = [],
    userReply,
    troubleshootingContext,
    openRouterApiKey = '',
    geminiApiKey = '',
    groqApiKey = '',
    timeoutMs = 12000,
    fetchImpl = fetch,
  } = params;

  // Dynamic error recovery & follow-up guide handling
  const troubleshootingDecision = resolveGuideTroubleshootingStep({
    goal: rawGoal,
    currentRoute,
    pageErrors,
    userReply,
    troubleshootingContext,
  });
  if (troubleshootingDecision) {
    return {
      ...troubleshootingDecision,
      totalSteps: Math.max(1, Math.min(MAX_GUIDE_STEPS, rawStepNumber)),
      provider: 'guide-troubleshooting',
    };
  }

  // If user answered the follow-up prompt ("Do you want any other guide?") with a new topic,
  // restart step planning seamlessly for that new goal.
  const switchingToNewGuide =
    troubleshootingContext?.stage === 'follow_up_guide' && Boolean(userReply?.trim());
  const goal = switchingToNewGuide ? userReply!.trim() : rawGoal;
  const previousStepSummary = switchingToNewGuide ? '' : rawPreviousStepSummary;
  const stepNumber = switchingToNewGuide ? 1 : rawStepNumber;
  const confirmedPath = switchingToNewGuide ? false : rawConfirmedPath;

  // Hard 10-step limit enforced before any LLM call
  if (stepNumber > MAX_GUIDE_STEPS) {
    return {
      ...sanitizeGuideStepDecision({ action: 'complete' }, pageMap, stepNumber),
      totalSteps: MAX_GUIDE_STEPS,
    };
  }

  const allowClarify = stepNumber === 1 && !confirmedPath;
  const localClarify = allowClarify
    ? detectAmbiguousGuidePaths({
        goal,
        pageMap,
        currentRoute,
        availableRoutes,
        appContext,
        confirmedPath,
        stepNumber,
      })
    : null;

  const lowerGoal = goal.toLowerCase();
  const coreGoalForScope = lowerGoal.replace(/\b(?:using|via)\s+"[^"]*"/gi, ' ').trim();
  const wantsDemo = /\b(demo|domo|sample|preview|trial)\b/i.test(lowerGoal);
  const wantsLogout = /\b(log\s*out|logout|sign\s*out|signout)\b/i.test(lowerGoal);
  const isAuthRoute =
    /^\/(?:login|signin|auth)(?:\/|$)|\/(?:login|signin)$/i.test(currentRoute);
  const hasPostLoginTask =
    /\b(add|create|enroll|invite|import|upload|export|download|delete|remove|edit|update|void|pay|payment|fee|deposit|bulk|batch|report|statement|password|reset|profile|notification|notice|ledger|institution|audit|receipt|settings)\b/i.test(
      coreGoalForScope
    );
  const isLoginOnlyGoal =
    /\b(log\s*in|sign\s*in|login|signin)\b/i.test(coreGoalForScope) && !hasPostLoginTask;
  const isDemoOnlyGoal = wantsDemo && !hasPostLoginTask;

  // Hard stop once login-only or demo-only goal has reached a non-auth overview route
  if (
    (isLoginOnlyGoal || isDemoOnlyGoal) &&
    !isAuthRoute &&
    (stepNumber >= 2 ||
      /login|sign\s*in|signin|demo|domo|clicked/i.test(previousStepSummary))
  ) {
    return {
      ...sanitizeGuideStepDecision(
        {
          action: 'complete',
          tip: isDemoOnlyGoal
            ? 'Demo mode opened and ready.'
            : 'Signed in and on the overview page.',
        },
        pageMap,
        stepNumber
      ),
      totalSteps: stepNumber,
      provider: 'goal-guard',
    };
  }

  // Use deterministic local clarification directly for demo/logout sibling clusters so typos like "domo model" never elicit "I can't find..."
  if (allowClarify && localClarify && (wantsDemo || wantsLogout)) {
    return {
      ...localClarify,
      provider: 'deterministic-dom-clarify',
    };
  }

  // Fast-path mid-guide form progression & verified completion (<1ms) so users never stall on "Finding next step..."
  if (stepNumber >= 2) {
    const fastCandidate = buildDeterministicGuideStep({
      goal,
      previousStepSummary,
      pageMap,
      stepNumber,
      currentRoute,
      confirmedPath,
      preferredTargetId,
      preferredRoute,
      availableRoutes,
    });
    const targetEl = fastCandidate.targetId
      ? pageMap.find((el) => el.id === fastCandidate.targetId)
      : undefined;
    const isInputStep =
      fastCandidate.action === 'point_and_wait' &&
      targetEl &&
      ['input', 'select', 'textarea'].includes(targetEl.tag);
    const isSubmitStep =
      fastCandidate.action === 'point_and_wait' &&
      targetEl &&
      /(submit|save|create|confirm|pay|post|import)/i.test(`${targetEl.id} ${targetEl.label}`);

    if (fastCandidate.action === 'complete' || isInputStep || isSubmitStep) {
      return {
        ...fastCandidate,
        provider: 'deterministic-fast-path',
      };
    }
  }

  // When user clicked a clarification option with an explicit preferredTargetId, execute that exact control directly
  if (
    stepNumber === 1 &&
    confirmedPath &&
    preferredTargetId &&
    pageMap.some((el) => el.id === preferredTargetId)
  ) {
    return {
      ...buildDeterministicGuideStep({
        goal,
        previousStepSummary,
        pageMap,
        stepNumber,
        currentRoute,
        confirmedPath,
        preferredTargetId,
        preferredRoute,
        availableRoutes,
      }),
      provider: 'confirmed-target',
    };
  }

  const finalizeParsedDecision = (
    parsed: Record<string, unknown>,
    providerName: string
  ): GuideStepResponse => {
    const safe = sanitizeGuideStepDecision(parsed, pageMap, stepNumber, {
      allowClarify,
      availableRoutes,
      currentRoute,
    });

    // Block LLM from picking a demo button unless the user explicitly asked for a demo
    if (!wantsDemo && safe.targetId) {
      const targetEl = pageMap.find((el) => el.id === safe.targetId);
      const targetHay = `${safe.targetId} ${targetEl?.label || ''}`;
      if (/\bdemo\b|try-demo|sample-account|quick-demo/i.test(targetHay)) {
        return {
          ...buildDeterministicGuideStep({
            goal,
            previousStepSummary,
            pageMap,
            stepNumber,
            currentRoute,
            confirmedPath,
            preferredTargetId,
            preferredRoute,
            availableRoutes,
          }),
          provider: `${providerName}:filtered`,
        };
      }
    }

    // Enforce crisp localClarify when a clear sibling cluster exists and LLM either guessed one or got confused by typos
    if (
      allowClarify &&
      localClarify &&
      (safe.action !== 'clarify' ||
        /can'?t find|cannot find|not found/i.test(safe.question || '') ||
        !safe.options?.some((o) => Boolean(o.targetId || o.route)))
    ) {
      return {
        ...localClarify,
        provider: providerName,
      };
    }

    const totalSteps = estimateRequiredGuideSteps({
      goal,
      currentRoute,
      stepNumber,
      pageMap,
      decision: safe,
      previousStepSummary,
      llmTotalSteps: safe.totalSteps,
    });

    return {
      ...safe,
      totalSteps,
      provider: providerName,
    };
  };

  const guideLlmTimeoutMs = Math.max(800, Math.min(timeoutMs, 3500));

  // 1. Primary OpenRouter call (google/gemini-2.5-flash -> groq/llama-3.3-70b-versatile fallback)
  if (openRouterApiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), guideLlmTimeoutMs);
    try {
      const payload = buildOpenRouterGuidePayload({
        goal,
        previousStepSummary,
        currentRoute,
        stepNumber,
        pageMap,
        confirmedPath,
        preferredTargetId,
        preferredRoute,
        availableRoutes,
        appContext,
      });

      const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openRouterApiKey}`,
          'X-Title': 'Interactive Guide Co-Browser',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (res.ok) {
        const data = (await res.json()) as {
          model?: string;
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === 'string') {
          const parsed = parseGuideJsonResponse(content);
          if (parsed) {
            return finalizeParsedDecision(parsed, data.model || 'openrouter');
          }
        }
      }
    } catch {
      // Fall through cleanly to next configured live provider or local DOM planner
    } finally {
      clearTimeout(timer);
    }
  }

  // 2. Direct Gemini fallback via @google/genai when GEMINI_API_KEY is configured
  if (geminiApiKey) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ai = new GoogleGenAI({
        apiKey: geminiApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      const userJson = buildCompactGuideUserJson({
        goal,
        previousStepSummary,
        currentRoute,
        stepNumber,
        pageMap,
        confirmedPath,
        preferredTargetId,
        preferredRoute,
        availableRoutes,
        appContext,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Gemini guide-step timeout')), guideLlmTimeoutMs);
      });

      const response = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: [
            {
              role: 'user',
              parts: [{ text: userJson }],
            },
          ],
          config: {
            systemInstruction: GUIDE_SYSTEM_PROMPT,
            responseMimeType: 'application/json',
          },
        }),
        timeoutPromise,
      ]);

      const rawText = response.text || '';
      const parsed = parseGuideJsonResponse(rawText);
      if (parsed) {
        return finalizeParsedDecision(parsed, 'gemini:gemini-4-hydrogen');
      }
      logger.warn({ rawLen: rawText.length }, 'Gemini guide-step returned non-JSON or empty output');
    } catch (err) {
      logger.warn({ err }, 'Gemini guide-step fallback failed');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // 3. Direct Groq fallback when GROQ_API_KEY is configured
  if (groqApiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), guideLlmTimeoutMs);
    try {
      const userJson = buildCompactGuideUserJson({
        goal,
        previousStepSummary,
        currentRoute,
        stepNumber,
        pageMap,
        confirmedPath,
        preferredTargetId,
        preferredRoute,
        availableRoutes,
        appContext,
      });

      const res = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqApiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: allowClarify ? 360 : 180,
          messages: [
            { role: 'system', content: GUIDE_SYSTEM_PROMPT },
            { role: 'user', content: userJson },
          ],
        }),
        signal: controller.signal,
      });

      if (res.ok) {
        const data = (await res.json()) as {
          model?: string;
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === 'string') {
          const parsed = parseGuideJsonResponse(content);
          if (parsed) {
            return finalizeParsedDecision(parsed, `groq:${data.model || 'llama-3.3-70b-versatile'}`);
          }
        }
      }
    } catch {
      // Fall through cleanly to deterministic local DOM planner
    } finally {
      clearTimeout(timer);
    }
  }

  if (localClarify) {
    return {
      ...localClarify,
      provider: 'deterministic-dom-fallback',
    };
  }

  const deterministic = buildDeterministicGuideStep({
    goal,
    previousStepSummary,
    pageMap,
    stepNumber,
    currentRoute,
    confirmedPath,
    preferredTargetId,
    preferredRoute,
    availableRoutes,
  });

  return {
    ...deterministic,
    provider: 'deterministic-dom-fallback',
  };
}

export function createGuideStepRouter({ cfg, creditStore, fetchImpl }: GuideStepRouteDeps): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const parsed = GuideStepRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid guide-step request payload',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const scope = await extractAccessScope(req, cfg as ServerConfig, {
      defaultUnauthenticatedRole: 'PUBLIC',
    });

    if (isPublicAuthContext(scope, parsed.data.currentRoute)) {
      if (!isPublicGuideGoalAllowed(parsed.data.goal, parsed.data.userReply)) {
        res.json({
          action: 'complete',
          totalSteps: parsed.data.stepNumber,
          tip: 'On the sign-in screen I can guide you to log in, reset your password, or create an organization. Please sign in first for other tasks.',
          provider: 'public-auth-guard',
        });
        return;
      }
    }

    let consumedOrgId: string | null = null;
    let consumptionId: string | undefined;
    if (creditStore && scope.role !== 'PUBLIC') {
      const orgId =
        'organizationId' in scope && scope.organizationId ? scope.organizationId : 'demo';
      const gate = await checkAndConsume(creditStore, orgId, scope.userId, scope.role, 'guide');
      if (!gate.allowed) {
        res.status(gate.errorCode === 'UPGRADE_REQUIRED' ? 403 : 402).json({
          error: gate.message,
          errorCode: gate.errorCode,
          plan: gate.plan,
          creditsRemaining: gate.creditsRemaining,
          creditsMonthlyAllowance: gate.creditsMonthlyAllowance,
          resetDate: gate.resetDate,
        });
        return;
      }
      consumedOrgId = orgId;
      consumptionId = gate.consumptionId;
    }

    const {
      goal,
      previousStepSummary,
      currentRoute,
      stepNumber,
      pageMap,
      confirmedPath,
      preferredTargetId,
      preferredRoute,
      availableRoutes,
      appContext,
      pageErrors,
      userReply,
      troubleshootingContext,
    } = parsed.data;

    try {
      const decision = await resolveGuideStepDecision({
        goal,
        previousStepSummary,
        currentRoute,
        stepNumber,
        pageMap,
        confirmedPath,
        preferredTargetId,
        preferredRoute,
        availableRoutes,
        appContext,
        pageErrors,
        userReply,
        troubleshootingContext,
        openRouterApiKey: cfg.openRouterApiKey,
        geminiApiKey: cfg.geminiApiKey,
        groqApiKey: cfg.groqApiKey,
        timeoutMs: cfg.llmTimeoutMs,
        fetchImpl,
      });

      res.json(decision);
    } catch (err) {
      if (creditStore && consumedOrgId && consumptionId) {
        await creditStore.refundConsumption(
          consumedOrgId,
          consumptionId,
          err instanceof Error ? err.message : 'Guide step failed'
        );
      }
      res.status(500).json({ error: 'Guide step failed.' });
    }
  });

  return router;
}
