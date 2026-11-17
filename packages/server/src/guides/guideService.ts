import { AUTHORED_GUIDES, type GuideDef } from '@ai-assistant/core';
import type { AccessScope } from '../security/scope.ts';

export interface GuideSearchResult {
  guideId: string;
  title: string;
  summary: string;
  roles: string[] | string;
  startRoute?: string;
  stepCount: number;
}

export interface GuideProgressRecord {
  userId: string;
  guideId: string;
  stepId: string;
  status: 'started' | 'step_reached' | 'completed' | 'abandoned';
  updatedAt: string;
}

// In-memory fallback store for guide progress & analytics
const progressStore = new Map<string, GuideProgressRecord>();
const analyticsEvents: Array<{
  userId: string;
  guideId: string;
  stepId?: string;
  event: string;
  deviceType?: string;
  timestamp: string;
}> = [];

/**
 * Normalizes user queries for transliteration & fuzzy keyword matching
 * (English, Malayalam script, Manglish phonetics)
 */
export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .trim()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
    .replace(/\s+/g, ' ');
}

export class GuideService {
  /**
   * Filters guides accessible by the given user's AccessScope.
   * If scope is not provided or role is unauthenticated, only 'public' guides are returned.
   */
  getGuidesForScope(scope?: AccessScope | null): GuideDef[] {
    if (!scope) {
      return AUTHORED_GUIDES.filter((g) => g.roles === 'public');
    }

    if (scope.role === 'SUPER_ADMIN') {
      return AUTHORED_GUIDES;
    }

    return AUTHORED_GUIDES.filter((g) => {
      if (g.roles === 'public') return true;
      if (Array.isArray(g.roles)) {
        return g.roles.includes(scope.role as any);
      }
      return false;
    });
  }

  /**
   * Retrieves a single guide by ID, enforcing role access check.
   */
  getGuideById(guideId: string, scope?: AccessScope | null): GuideDef | null {
    const guide = AUTHORED_GUIDES.find((g) => g.guideId === guideId) || null;
    if (!guide) return null;

    if (!scope) {
      return guide.roles === 'public' ? guide : null;
    }

    if (scope.role === 'SUPER_ADMIN') return guide;

    if (guide.roles === 'public') return guide;
    if (Array.isArray(guide.roles) && guide.roles.includes(scope.role as any)) {
      return guide;
    }

    return null;
  }

  /**
   * Performs semantic/keyword search over the allowed guides catalog.
   * Returns top matching guides up to limit (default 5).
   */
  searchGuides(query: string, scope?: AccessScope | null, limit = 5): GuideSearchResult[] {
    const allowed = this.getGuidesForScope(scope);
    const normalized = normalizeQuery(query);
    const tokens = normalized.split(' ').filter(Boolean);

    const scored = allowed.map((guide) => {
      let score = 0;
      const guideIdLower = guide.guideId.toLowerCase();
      const titleEn = guide.title.en.toLowerCase();
      const titleMl = (guide.title.ml || '').toLowerCase();
      const summaryEn = guide.summary.en.toLowerCase();
      const summaryMl = (guide.summary.ml || '').toLowerCase();

      // Exact phrase match in keywords
      for (const kw of guide.keywords) {
        const kwLower = kw.toLowerCase();
        if (normalized === kwLower) {
          score += 20;
        } else if (normalized.includes(kwLower) || kwLower.includes(normalized)) {
          score += 10;
        } else {
          // Token matches with stem/substring tolerance
          for (const token of tokens) {
            if (token.length >= 3 && (kwLower.includes(token) || token.includes(kwLower))) {
              score += 5;
            }
          }
        }
      }

      // Title & Summary matches
      if (titleEn.includes(normalized)) score += 8;
      if (titleMl.includes(normalized)) score += 8;
      if (summaryEn.includes(normalized)) score += 4;
      if (summaryMl.includes(normalized)) score += 4;
      if (guideIdLower.includes(normalized)) score += 5;

      return { guide, score };
    });

    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ guide }) => ({
        guideId: guide.guideId,
        title: guide.title.en,
        summary: guide.summary.en,
        roles: guide.roles,
        startRoute: guide.startRoute,
        stepCount: guide.steps.length,
      }));
  }

  /**
   * Records user progress for a guide.
   */
  recordProgress(record: GuideProgressRecord): void {
    const key = `${record.userId}:${record.guideId}`;
    progressStore.set(key, record);
    analyticsEvents.push({
      userId: record.userId,
      guideId: record.guideId,
      stepId: record.stepId,
      event: record.status,
      timestamp: record.updatedAt,
    });
  }

  /**
   * Retrieves user's latest progress on a guide.
   */
  getProgress(userId: string, guideId: string): GuideProgressRecord | null {
    const key = `${userId}:${guideId}`;
    return progressStore.get(key) || null;
  }

  /**
   * Simple analytics aggregation
   */
  getAnalytics(): { totalStarted: number; totalCompleted: number; events: typeof analyticsEvents } {
    const totalStarted = analyticsEvents.filter((e) => e.event === 'started').length;
    const totalCompleted = analyticsEvents.filter((e) => e.event === 'completed').length;
    return {
      totalStarted,
      totalCompleted,
      events: analyticsEvents.slice(-100),
    };
  }
}

export const guideService = new GuideService();
