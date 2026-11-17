import { z } from 'zod';
import { guideService } from '../guides/guideService.ts';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from './types.ts';
import type { AccessScope } from '../security/scope.ts';

export const SearchGuidesInputSchema = z.object({
  query: z.string().describe('The user query, task or question to find step-by-step interactive guides for'),
});

export const StartGuideInputSchema = z.object({
  guideId: z.string().describe('The unique identifier of the authored guide to start (e.g. "admin.students.import", "public.login")'),
  startStep: z.string().optional().describe('Optional initial step ID to start from'),
});

export const searchGuidesTool: ToolDefinition = {
  name: 'search_guides',
  description:
    'Search the catalog of authored interactive on-screen guides for the current user role. Use when user asks "how do I...", "guide me", "show me how", or wants step-by-step on-screen walkthroughs.',
  risk: 'read',
  autoExecute: true,
  inputSchema: SearchGuidesInputSchema,
  jsonParameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The user query, action, or question to find a walkthrough guide for',
      },
    },
    required: ['query'],
  },
  summarize(args: Record<string, unknown>): string {
    return `Search guides for "${String(args.query || '')}"`;
  },
  async execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext & { scope?: AccessScope }
  ): Promise<ToolExecutionResult> {
    const q = String(args.query || '');
    const matches = guideService.searchGuides(q, ctx.scope, 5);

    if (matches.length === 0) {
      return {
        ok: true,
        summary: `No interactive guide found for "${q}".`,
        data: { matches: [] },
      };
    }

    return {
      ok: true,
      summary: `Found ${matches.length} matching interactive guide(s).`,
      data: {
        matches: matches.map((m) => ({
          guideId: m.guideId,
          title: m.title,
          summary: m.summary,
          stepCount: m.stepCount,
          startRoute: m.startRoute,
        })),
      },
    };
  },
};

export const startGuideTool: ToolDefinition = {
  name: 'start_guide',
  description:
    'Starts an interactive on-screen guide with 3D avatar, spotlight, and voice narration. Emits an event that closes the chat panel and starts the walkthrough.',
  risk: 'read',
  autoExecute: true,
  uiTrigger: true,
  inputSchema: StartGuideInputSchema,
  jsonParameters: {
    type: 'object',
    properties: {
      guideId: {
        type: 'string',
        description: 'The unique guide ID to launch',
      },
      startStep: {
        type: 'string',
        description: 'Optional initial step ID to start from',
      },
    },
    required: ['guideId'],
  },
  summarize(args: Record<string, unknown>): string {
    return `Start interactive guide "${String(args.guideId || '')}"`;
  },
  async execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext & { scope?: AccessScope }
  ): Promise<ToolExecutionResult> {
    const guideId = String(args.guideId || '');
    const startStep = typeof args.startStep === 'string' ? args.startStep : undefined;

    const guide = guideService.getGuideById(guideId, ctx.scope);
    if (!guide) {
      return {
        ok: false,
        summary: "This guide isn't available for your account.",
        data: { error: 'UNAUTHORIZED_OR_NOT_FOUND', guideId },
      };
    }

    // Record initial start in progress tracker
    guideService.recordProgress({
      userId: ctx.userId || 'guest',
      guideId,
      stepId: startStep || guide.steps[0]?.stepId || 'start',
      status: 'started',
      updatedAt: new Date().toISOString(),
    });

    return {
      ok: true,
      summary: `Starting interactive guide: ${guide.title.en}. Follow the 3D avatar on screen!`,
      data: {
        guideId,
        title: guide.title.en,
        startStep: startStep || guide.steps[0]?.stepId,
        stepCount: guide.steps.length,
        startRoute: guide.startRoute,
      },
      uiAction: {
        action: 'refresh',
        label: `Start guide ${guide.title.en}`,
        appCommand: {
          command: 'start_guide',
          payload: {
            guideId,
            startStep,
          },
        },
      },
    };
  },
};

export const GUIDE_TOOLS = [searchGuidesTool, startGuideTool];
