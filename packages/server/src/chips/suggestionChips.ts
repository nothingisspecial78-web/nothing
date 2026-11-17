import type {
  AssistantEntityConfig,
  EntityScopeRole,
  PageActionConfig,
  PageDefinitionConfig,
} from '@ai-assistant/core';
import { getRegisteredEntityConfig } from '../entityRegistry/searchEngine.ts';
import type { AccessScope } from '../security/scope.ts';
import type { UserRecentActivity } from '../tools/datasetState.ts';
import { getRankedChips, resolvePageId } from './pageRegistry.ts';

export type SuggestionChipSlot = 'personal' | 'page' | 'general';

export interface SuggestionChipItem {
  id: string;
  slot: SuggestionChipSlot;
  label: string;
  prompt: string;
  icon?: string;
  priority: number;
}

export interface SuggestionChipUser {
  userId: string;
  role: EntityScopeRole;
  scope?: AccessScope;
}

export type SuggestionChipPageInput =
  | string
  | {
      pageId?: string;
      pathname?: string;
      title?: string;
    };

export interface SuggestionChipsOptions {
  appId?: string;
  config?: AssistantEntityConfig;
  lang?: 'en' | 'ml';
  chipUsageMap?: Map<string, { shownCount: number; clickCount: number; lastClickedAt?: string }>;
  rotationSeed?: number;
  dueAmount?: number;
  unpaidCount?: number;
  unassignedSectorsCount?: number;
  bypassCache?: boolean;
}

export interface SuggestionChipsResponse {
  pageId: string;
  pageTitle: string;
  chips: SuggestionChipItem[];
}

interface CacheEntry {
  expiresAt: number;
  value: SuggestionChipsResponse;
}

const CHIP_CACHE = new Map<string, CacheEntry>();
const USER_ROTATION_COUNTER = new Map<string, number>();
const CACHE_TTL_MS = 15_000;

export function clearSuggestionChipsCache(userId?: string): void {
  if (!userId) {
    CHIP_CACHE.clear();
    return;
  }
  for (const key of CHIP_CACHE.keys()) {
    if (key.includes(`::${userId}::`)) {
      CHIP_CACHE.delete(key);
    }
  }
}

export function clampChipWords(text: string, maxWords = 8): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const words = clean.split(' ');
  if (words.length <= maxWords) return clean;
  return `${words.slice(0, maxWords).join(' ')}…`;
}

function matchRoutePattern(pattern: string, pathname: string): boolean {
  const normPat = pattern.toLowerCase().replace(/\/+$/, '') || '/';
  const normPath = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (normPat === normPath) return true;
  if (!normPat.includes('*')) return false;
  const escaped = normPat
    .split('*')
    .map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
  return new RegExp(`^${escaped}$`, 'i').test(normPath);
}

function specificityScore(pattern: string): number {
  const clean = pattern.replace(/\*/g, '');
  return clean.length * 10 - (pattern.match(/\*/g)?.length || 0) * 3;
}

export function resolveConfiguredPage(
  currentPage: SuggestionChipPageInput,
  config?: AssistantEntityConfig
): { pageId: string; pageTitle: string; pageDef?: PageDefinitionConfig } {
  const rawPath =
    typeof currentPage === 'string'
      ? currentPage
      : currentPage.pathname || currentPage.pageId || '';
  const rawPageId =
    typeof currentPage === 'string'
      ? (currentPage.includes('/') ? '' : currentPage)
      : currentPage.pageId || '';
  const explicitTitle = typeof currentPage === 'object' ? currentPage.title : undefined;

  const pages = config?.pages || [];
  const trimmedPath = rawPath.trim();

  // 1. Exact pageId match
  if (rawPageId) {
    const byId = pages.find((p) => p.pageId === rawPageId);
    if (byId) {
      return {
        pageId: byId.pageId,
        pageTitle: explicitTitle || byId.title,
        pageDef: byId,
      };
    }
  }

  // 2. Match routePatterns generically by highest specificity
  if (trimmedPath.startsWith('/')) {
    let bestPage: PageDefinitionConfig | undefined;
    let bestScore = -Infinity;
    for (const p of pages) {
      for (const pat of p.routePatterns || []) {
        if (matchRoutePattern(pat, trimmedPath)) {
          const score = specificityScore(pat);
          if (score > bestScore) {
            bestScore = score;
            bestPage = p;
          }
        }
      }
    }
    if (bestPage) {
      return {
        pageId: bestPage.pageId,
        pageTitle: explicitTitle || bestPage.title,
        pageDef: bestPage,
      };
    }
  }

  // 3. Fallback to legacy Khazna resolvePageId or clean derived title
  const fallbackPageId = trimmedPath.includes('/')
    ? resolvePageId(trimmedPath)
    : rawPageId || 'global';
  const matchedByFallback = pages.find((p) => p.pageId === fallbackPageId);
  const derivedTitle =
    explicitTitle ||
    matchedByFallback?.title ||
    (trimmedPath && trimmedPath !== '/'
      ? trimmedPath
          .split('/')
          .filter(Boolean)
          .slice(-1)[0]
          .replace(/[-_]+/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : config?.appName || 'Overview');

  return {
    pageId: fallbackPageId,
    pageTitle: derivedTitle,
    pageDef: matchedByFallback,
  };
}

function isActionAllowedForRole(action: PageActionConfig, role: EntityScopeRole): boolean {
  if (!action.roles || action.roles.length === 0) return role !== 'PUBLIC';
  if (role === 'PUBLIC') return action.roles.includes('PUBLIC');
  return action.roles.includes(role);
}

function pickLocalized(action: PageActionConfig, lang: 'en' | 'ml'): { label: string; prompt: string } {
  const label = lang === 'ml' && action.labelMl ? action.labelMl : action.label;
  const prompt = lang === 'ml' && action.promptMl ? action.promptMl : action.prompt;
  return { label: clampChipWords(label, 8), prompt };
}

function scoreActionWithUsage(
  action: PageActionConfig,
  usageMap?: Map<string, { shownCount: number; clickCount: number; lastClickedAt?: string }>
): number {
  const base = action.priority ?? 80;
  const usage = usageMap?.get(action.id);
  if (!usage) return base;
  let score = base + usage.clickCount * 4;
  if (usage.shownCount >= 5 && usage.clickCount === 0) score -= 5;
  if (usage.lastClickedAt) {
    const hrs = (Date.now() - new Date(usage.lastClickedAt).getTime()) / 3_600_000;
    if (hrs < 24) score += 4;
  }
  return score;
}

function buildRolePopularFallback(
  role: EntityScopeRole,
  lang: 'en' | 'ml',
  appId?: string
): { id: string; label: string; prompt: string; icon?: string } {
  if (appId === 'second-demo') {
    return {
      id: 'personal.fallback.library',
      label: 'Find books by author or shelf',
      prompt: 'List all available books in the catalog',
      icon: 'BookOpen',
    };
  }
  if (appId === 'leave-log') {
    return role === 'STUDENT'
      ? {
          id: 'personal.fallback.leave-self',
          label: 'View my leave requests',
          prompt: 'Show my leave requests',
          icon: 'Calendar',
        }
      : {
          id: 'personal.fallback.leave-summary',
          label: 'Export approved leaves report',
          prompt: 'Show all approved leave requests',
          icon: 'Calendar',
        };
  }
  if (role === 'PUBLIC') {
    return {
      id: 'personal.fallback.public',
      label: lang === 'ml' ? 'ലോഗിൻ സഹായം' : 'Guide me to log in',
      prompt: 'Guide me to log in step by step',
      icon: 'Compass',
    };
  }
  if (role === 'STUDENT') {
    return {
      id: 'personal.fallback.student',
      label: lang === 'ml' ? 'എന്റെ ഫീസ് ബാക്കി കാണുക' : 'Check my current fee balance',
      prompt: 'What is my current fee balance and total dues?',
      icon: 'Wallet',
    };
  }
  if (role === 'SECTOR_MANAGER') {
    return {
      id: 'personal.fallback.manager',
      label: lang === 'ml' ? 'എന്റെ സെക്ടറിലെ കുടിശ്ശികക്കാർ' : 'Students owing in my sector',
      prompt: 'Which students in my sector have unpaid fee balances?',
      icon: 'Users',
    };
  }
  return {
    id: 'personal.fallback.admin',
    label: lang === 'ml' ? 'നെഗറ്റീവ് ബാലൻസ് വിദ്യാർത്ഥികൾ' : 'Students with negative balance',
    prompt: 'give the list of net worth minus',
    icon: 'TrendingDown',
  };
}

function getGeneralFallbackPool(role: EntityScopeRole, appId?: string): PageActionConfig[] {
  if (role === 'PUBLIC') {
    return [
      {
        id: 'gen.fallback.assistant-features',
        label: 'What can this AI assistant do?',
        prompt: 'What can this AI assistant do and what are its features?',
        roles: ['PUBLIC'],
      },
      {
        id: 'gen.fallback.login',
        label: 'Create a new organization',
        prompt: 'How do I create a new organization college account?',
        roles: ['PUBLIC'],
      },
    ];
  }
  if (role === 'STUDENT') {
    return [
      {
        id: 'gen.fallback.receipts',
        label: 'Show my recent fee receipts',
        prompt: 'Show my last 5 payments and receipt numbers.',
        roles: ['STUDENT'],
      },
      {
        id: 'gen.fallback.statement',
        label: 'Download my fee statement PDF',
        prompt: 'Download my fee statement PDF',
        roles: ['STUDENT'],
      },
    ];
  }
  if (appId === 'second-demo') {
    return [
      {
        id: 'gen.fallback.library.csv',
        label: 'Export available books as CSV',
        prompt: 'export available books as CSV',
        roles: ['ADMIN', 'SUPER_ADMIN', 'SECTOR_MANAGER'],
      },
    ];
  }
  if (appId === 'leave-log') {
    return [
      {
        id: 'gen.fallback.leave.excel',
        label: 'Export approved leaves as Excel',
        prompt: 'export approved leave requests as Excel',
        roles: ['ADMIN', 'SUPER_ADMIN', 'SECTOR_MANAGER'],
      },
    ];
  }
  return [
    {
      id: 'gen.fallback.safwan',
      label: 'Who is Safwan K and his due?',
      prompt: 'Who is Safwan K and how much does he owe?',
      roles: ['ADMIN', 'SUPER_ADMIN', 'SECTOR_MANAGER'],
    },
    {
      id: 'gen.fallback.highest-class',
      label: 'Which class has highest pending dues?',
      prompt: 'Which class has the highest pending dues?',
      roles: ['ADMIN', 'SUPER_ADMIN', 'SECTOR_MANAGER'],
    },
  ];
}

export function getSuggestionChips(
  user: SuggestionChipUser,
  currentPage: SuggestionChipPageInput,
  recentActivity?: UserRecentActivity,
  options: SuggestionChipsOptions = {}
): SuggestionChipsResponse {
  const appId = options.appId || 'khazna-ledger';
  const lang: 'en' | 'ml' = options.lang === 'ml' ? 'ml' : 'en';
  const config = options.config || getRegisteredEntityConfig(appId);
  const { pageId, pageTitle, pageDef } = resolveConfiguredPage(currentPage, config);

  const activityStamp = recentActivity
    ? `${recentActivity.lastAbandonedForm?.abandonedAt || 0}-${recentActivity.lastFailedRequest?.failedAt || 0}-${recentActivity.lastDataset?.savedAt || 0}-${recentActivity.lastDataset?.exported ? 1 : 0}-${recentActivity.lastSuccessfulQuery?.at || 0}`
    : 'none';
  const cacheKey = `${appId}::${user.role}::${user.userId}::${pageId}::${lang}::${activityStamp}`;

  if (!options.bypassCache) {
    const cached = CHIP_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
  }

  const usedPrompts = new Set<string>();
  const usedLabels = new Set<string>();
  const chips: SuggestionChipItem[] = [];

  const markUsed = (chip: SuggestionChipItem) => {
    usedPrompts.add(chip.prompt.toLowerCase().trim());
    usedLabels.add(chip.label.toLowerCase().trim());
  };

  const isDuplicate = (label: string, prompt: string) =>
    usedPrompts.has(prompt.toLowerCase().trim()) || usedLabels.has(label.toLowerCase().trim());

  // ------------------------------------------------------------------
  // CHIP 1: PERSONAL / RECENT
  // Priority: abandoned form -> failed/unfinished request -> unexported dataset -> next action -> role popular task
  // ------------------------------------------------------------------
  let personalChip: SuggestionChipItem | undefined;
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (
    recentActivity?.lastAbandonedForm &&
    now - recentActivity.lastAbandonedForm.abandonedAt < oneDayMs
  ) {
    const f = recentActivity.lastAbandonedForm;
    personalChip = {
      id: 'chip.personal.abandoned-form',
      slot: 'personal',
      label: clampChipWords(`Resume: ${f.title}`, 8),
      prompt: f.prompt,
      icon: 'RotateCcw',
      priority: 120,
    };
  } else if (
    recentActivity?.lastFailedRequest &&
    now - recentActivity.lastFailedRequest.failedAt < oneDayMs
  ) {
    const errReq = recentActivity.lastFailedRequest;
    personalChip = {
      id: 'chip.personal.retry-failed',
      slot: 'personal',
      label: clampChipWords(errReq.label || `Retry: ${errReq.prompt}`, 8),
      prompt: errReq.prompt,
      icon: 'RefreshCw',
      priority: 115,
    };
  } else if (
    recentActivity?.lastDataset &&
    !recentActivity.lastDataset.exported &&
    user.role !== 'PUBLIC'
  ) {
    personalChip = {
      id: 'chip.personal.export-last',
      slot: 'personal',
      label: 'Export last list as Excel',
      prompt: 'export this as Excel',
      icon: 'FileSpreadsheet',
      priority: 110,
    };
  } else if (recentActivity?.lastSuccessfulQuery) {
    const q = recentActivity.lastSuccessfulQuery;
    personalChip = {
      id: 'chip.personal.recent-query',
      slot: 'personal',
      label: clampChipWords(`Again: ${q.label}`, 8),
      prompt: q.prompt,
      icon: 'History',
      priority: 105,
    };
  }

  if (!personalChip) {
    const fb = buildRolePopularFallback(user.role, lang, appId);
    personalChip = {
      id: fb.id,
      slot: 'personal',
      label: clampChipWords(fb.label, 8),
      prompt: fb.prompt,
      icon: fb.icon,
      priority: 100,
    };
  }
  chips.push(personalChip);
  markUsed(personalChip);

  // ------------------------------------------------------------------
  // CHIP 2: THIS PAGE (Generic config-driven first, legacy CHIP_REGISTRY fallback)
  // ------------------------------------------------------------------
  const pageActions: PageActionConfig[] = (pageDef?.actions || []).filter((a) =>
    isActionAllowedForRole(a, user.role)
  );
  const scoredPageActions = [...pageActions].sort(
    (a, b) => scoreActionWithUsage(b, options.chipUsageMap) - scoreActionWithUsage(a, options.chipUsageMap)
  );

  let pageChip: SuggestionChipItem | undefined;
  for (const act of scoredPageActions) {
    const loc = pickLocalized(act, lang);
    if (!isDuplicate(loc.label, loc.prompt)) {
      pageChip = {
        id: act.id,
        slot: 'page',
        label: loc.label,
        prompt: loc.prompt,
        icon: act.icon || 'Sparkles',
        priority: scoreActionWithUsage(act, options.chipUsageMap),
      };
      break;
    }
  }

  if (!pageChip && user.scope) {
    const rankedLegacy = getRankedChips({
      scope: user.scope,
      pageId,
      lang,
      chipUsageMap: options.chipUsageMap,
      context: {
        scope: user.scope,
        dueAmount: options.dueAmount,
        unpaidCount: options.unpaidCount,
        unassignedSectorsCount: options.unassignedSectorsCount,
      },
      limit: 6,
    });
    for (const c of rankedLegacy) {
      const clampedLabel = clampChipWords(c.label, 8);
      if (!isDuplicate(clampedLabel, c.prompt)) {
        pageChip = {
          id: c.id,
          slot: 'page',
          label: clampedLabel,
          prompt: c.prompt,
          icon: c.icon,
          priority: c.priority,
        };
        break;
      }
    }
  }

  if (!pageChip) {
    // Fallback to another role-permitted page action across app config
    const allConfigActions = (config?.pages || [])
      .flatMap((p) => p.actions)
      .filter((a) => isActionAllowedForRole(a, user.role));
    for (const act of allConfigActions) {
      const loc = pickLocalized(act, lang);
      if (!isDuplicate(loc.label, loc.prompt)) {
        pageChip = {
          id: act.id,
          slot: 'page',
          label: loc.label,
          prompt: loc.prompt,
          icon: act.icon,
          priority: act.priority ?? 75,
        };
        break;
      }
    }
  }

  if (pageChip) {
    chips.push(pageChip);
    markUsed(pageChip);
  }

  // ------------------------------------------------------------------
  // CHIP 3: GENERAL (Cross-app capability showcase, rotating across eligible pool)
  // ------------------------------------------------------------------
  const configuredGeneral = (config?.generalChips || []).filter((g) =>
    isActionAllowedForRole(g, user.role)
  );
  const fallbackGeneral = getGeneralFallbackPool(user.role, appId);
  const generalPool = (configuredGeneral.length > 0 ? configuredGeneral : fallbackGeneral).filter(
    (g) => {
      const loc = pickLocalized(g, lang);
      return !isDuplicate(loc.label, loc.prompt);
    }
  );

  if (generalPool.length > 0) {
    const rotKey = `${appId}::${user.role}::${user.userId}`;
    const nextIdx =
      options.rotationSeed !== undefined
        ? options.rotationSeed
        : (USER_ROTATION_COUNTER.get(rotKey) ?? 0);
    if (options.rotationSeed === undefined) {
      USER_ROTATION_COUNTER.set(rotKey, (nextIdx + 1) % 10_000);
    }
    const chosen = generalPool[Math.abs(nextIdx) % generalPool.length];
    const loc = pickLocalized(chosen, lang);
    const generalChip: SuggestionChipItem = {
      id: chosen.id,
      slot: 'general',
      label: loc.label,
      prompt: loc.prompt,
      icon: chosen.icon || 'Compass',
      priority: chosen.priority ?? 70,
    };
    chips.push(generalChip);
    markUsed(generalChip);
  } else {
    for (const alt of [...fallbackGeneral, ...scoredPageActions]) {
      const loc = pickLocalized(alt, lang);
      if (!isDuplicate(loc.label, loc.prompt)) {
        const generalChip: SuggestionChipItem = {
          id: alt.id,
          slot: 'general',
          label: loc.label,
          prompt: loc.prompt,
          icon: alt.icon,
          priority: alt.priority ?? 65,
        };
        chips.push(generalChip);
        markUsed(generalChip);
        break;
      }
    }
  }

  const finalResult: SuggestionChipsResponse = {
    pageId,
    pageTitle,
    chips: chips.slice(0, 3),
  };

  if (!options.bypassCache) {
    if (CHIP_CACHE.size > 500) {
      const oldestKey = CHIP_CACHE.keys().next().value;
      if (oldestKey) CHIP_CACHE.delete(oldestKey);
    }
    CHIP_CACHE.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: finalResult,
    });
  }

  return finalResult;
}
