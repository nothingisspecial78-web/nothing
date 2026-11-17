import type {
  AvailableRouteHint,
  GuideClarificationOption,
  GuideStepAction,
  GuideStepResponse,
  PageMapElement,
} from './schemas.ts';

export const ALLOWED_GUIDE_ACTIONS = [
  'navigate',
  'point_and_wait',
  'click_safe',
  'complete',
] as const;

export type CoreGuideAction = (typeof ALLOWED_GUIDE_ACTIONS)[number];

export const MAX_GUIDE_STEPS = 10;

export const OPENROUTER_GUIDE_MODELS = [
  'google/gemini-2.5-flash',
  'groq/llama-3.3-70b-versatile',
] as const;

/**
 * Compact system prompt kept strictly below 250 tokens for OpenRouter /api/guide-step.
 */
export const GUIDE_SYSTEM_PROMPT = `You are a concise DOM co-browsing guide. Pick ONE step toward the user's goal using ONLY provided pageMap and routes.
Reply ONLY with valid JSON:
{"action":"navigate"|"point_and_wait"|"click_safe"|"complete"|"clarify","targetId":"str","route":"str","totalSteps":int,"tip":"max 12 words","question":"if clarify","options":[{"id":"str","label":"str","description":"short hint","refinedGoal":"str","targetId":"str","route":"str"}]}
Rules:
1. Step=1 & confirmedPath=false: if 2+ tasks, login roles, tabs, or routes fit, return action="clarify" with 2-5 options.
2. Otherwise use ONLY: navigate, point_and_wait, click_safe, complete. Set totalSteps to exact required steps (skip optional fields, 1-10).
3. NEVER auto-click sensitive:true, demo buttons (unless asked), or inputs; use point_and_wait.
4. Never invent targetId/route. Return "complete" as soon as the task is done.`;

/**
 * Conservative token estimator used for unit assertions on prompt budgets.
 */
export function estimateApproxTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const charsEstimate = Math.ceil(text.length / 3.8);
  return Math.max(words, charsEstimate);
}

/**
 * Caps instruction text cleanly to at most `maxWords` words (default 12).
 */
export function truncateTipWords(tip: string, maxWords = 12): string {
  const cleaned = tip.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Follow the highlighted control on screen.';
  const words = cleaned.split(' ');
  if (words.length <= maxWords) return cleaned;
  return `${words.slice(0, maxWords).join(' ').replace(/[,:;.\-!?]+$/, '')}.`;
}

/**
 * Hybrid chat router: detects explicit guidance phrasing while keeping
 * direct data-edit queries ("update user table", "add student", etc.)
 * in inline chat mode.
 */
export function shouldTriggerGuideMode(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  // Guard against direct inline-table edits accidentally triggering co-browsing
  const looksLikeDirectBulkEdit =
    /\bupdate\s+(?:the\s+)?(?:user|student|students|ledger|records?)\s+table\b/.test(lower) &&
    !/\bhow do i\b|\bshow me where\b|\bguide me\b/.test(lower);
  if (looksLikeDirectBulkEdit) return false;

  // Explicit "guide ...", "how do I...", "show me where...", "walk me through...", "help me login...", or opening demo/domo mode
  const hasGuideCue =
    /^(?:please\s+)?guide\b|\bguide\s+me\b|\bhow do i\b|\bhow to\b|\bshow me where\b|\bshow me how\b|\bwhere do i\b|\bwhere can i\b|\bwhere is\b|\bwalk me through\b|\bpoint me to\b|\btake me to\b|^(?:please\s+)?help me\s+(?:with\s+|to\s+|on\s+)?(?:log\s*in|sign\s*in|register|export|import|add|create|edit|delete|void|pay|manage|find|open|demo|domo)\b/.test(
      lower
    );

  const hasDemoGuideCue =
    /\b(?:open|start|launch|enter|use|try|access|load)\s+(?:the\s+|a\s+)?(?:demo|domo)(?:\s+(?:mode|model|account|accounts|portal|workspace|session))?\b|\b(?:demo|domo)\s+(?:mode|model)\b/.test(
      lower
    );

  const hasDirectLoginRoleCue =
    /^(?:please\s+)?(?:i\s+want\s+to\s+|let\s+me\s+)?(?:log\s*in|sign\s*in|login|signin)\s+(?:as\s+)?(?:a\s+|an\s+)?(?:student|manager|sector\s+manager|admin|super\s+admin)\b/.test(
      lower
    );

  return hasGuideCue || hasDemoGuideCue || hasDirectLoginRoleCue;
}

function isInputLikeElement(el: PageMapElement): boolean {
  const tag = el.tag.toLowerCase();
  return tag === 'input' || tag === 'select' || tag === 'textarea';
}

function isDemoControl(el: PageMapElement): boolean {
  return /\b(?:demo|domo)\b|try-demo|sample-account|quick-demo/i.test(`${el.id} ${el.label}`);
}

function isAuthRoutePath(route: string): boolean {
  const lower = (route || '').toLowerCase();
  return (
    lower === '/login' ||
    lower === '/signin' ||
    lower.startsWith('/auth') ||
    lower.endsWith('/login') ||
    lower.endsWith('/signin')
  );
}

function isNoiseControl(el: PageMapElement, allowLogout = false): boolean {
  const text = `${el.id} ${el.label}`;
  if (allowLogout && /\b(logout|sign\s*out|signout)\b/i.test(text)) {
    return false;
  }
  return /\b(cancel|close|dismiss|back|prev|previous|next|logout|sign\s*out|signout|toggle|theme|aesthetic|forgot|copy|clear)\b/i.test(
    text
  );
}

export interface SanitizeOptions {
  allowClarify?: boolean;
  availableRoutes?: AvailableRouteHint[];
  currentRoute?: string;
}

/**
 * Server- and client-enforced safety sanitizer for any LLM or planner step:
 * 1. Hard 10-step limit.
 * 2. Strict 4-action execution whitelist (+ pre-flight clarify ONLY when allowClarify=true on step 1).
 * 3. Blocks auto-clicking elements with `sensitive: true` or input fields.
 * 4. Caps `tip` at 12 words and strips unverified targetIds/routes.
 */
export function sanitizeGuideStepDecision(
  raw: Record<string, unknown>,
  pageMap: PageMapElement[],
  stepNumber: number,
  options: SanitizeOptions = {}
): GuideStepResponse {
  if (stepNumber > MAX_GUIDE_STEPS) {
    return {
      action: 'complete',
      tip: truncateTipWords('Reached the 10-step guide limit. Please continue manually.'),
    };
  }

  const rawAction = typeof raw.action === 'string' ? raw.action.trim() : '';

  if (
    rawAction === 'clarify' &&
    options.allowClarify &&
    stepNumber === 1 &&
    Array.isArray(raw.options)
  ) {
    const validIds = new Set(pageMap.map((el) => el.id));
    const validRoutes = new Set(
      (options.availableRoutes || []).map((r) => r.route)
    );
    if (options.currentRoute && validRoutes.size > 0) {
      validRoutes.add(options.currentRoute);
    }
    const seenLabels = new Set<string>();
    const sanitizedOptions: GuideClarificationOption[] = [];

    for (let i = 0; i < raw.options.length; i += 1) {
      const item = raw.options[i] as Record<string, unknown> | undefined;
      if (!item || typeof item !== 'object') continue;
      const label = typeof item.label === 'string' ? item.label.trim().slice(0, 80) : '';
      const refinedGoal =
        typeof item.refinedGoal === 'string' && item.refinedGoal.trim()
          ? item.refinedGoal.trim().slice(0, 300)
          : label
            ? `Guide me using "${label}"`
            : '';
      if (!label || !refinedGoal) continue;
      const normLabel = label.toLowerCase();
      if (seenLabels.has(normLabel)) continue;

      const rawTargetId = typeof item.targetId === 'string' ? item.targetId.trim() : '';
      const rawRoute = typeof item.route === 'string' ? item.route.trim() : '';
      const safeTargetId = rawTargetId && validIds.has(rawTargetId) ? rawTargetId : undefined;
      const safeRoute =
        rawRoute &&
        rawRoute.startsWith('/') &&
        (validRoutes.size === 0 || validRoutes.has(rawRoute))
          ? rawRoute
          : undefined;

      seenLabels.add(normLabel);
      sanitizedOptions.push({
        id:
          typeof item.id === 'string' && item.id.trim()
            ? item.id.trim().slice(0, 120)
            : `opt-${i + 1}`,
        label,
        ...(typeof item.description === 'string' && item.description.trim()
          ? { description: item.description.trim().slice(0, 140) }
          : {}),
        refinedGoal,
        ...(safeTargetId ? { targetId: safeTargetId } : {}),
        ...(safeRoute ? { route: safeRoute } : {}),
      });

      if (sanitizedOptions.length >= 5) break;
    }

    if (sanitizedOptions.length >= 2) {
      const question =
        typeof raw.question === 'string' && raw.question.trim()
          ? raw.question.trim().slice(0, 240)
          : 'Multiple paths are available. Which one would you like to use?';
      return {
        action: 'clarify',
        question,
        options: sanitizedOptions,
        tip: truncateTipWords(
          typeof raw.tip === 'string' && raw.tip.trim()
            ? raw.tip
            : 'Choose an option in chat to start the guide.'
        ),
      };
    }
  }

  if (rawAction === 'refresh_and_retry') {
    return {
      action: 'refresh_and_retry',
      refreshApp: true,
      tip: truncateTipWords(
        typeof raw.tip === 'string' && raw.tip.trim()
          ? raw.tip
          : 'Refreshing the web app now. Please try again.',
        14
      ),
    };
  }

  if (rawAction === 'ask_user') {
    const q =
      typeof raw.question === 'string' && raw.question.trim()
        ? raw.question.trim().slice(0, 260)
        : typeof raw.tip === 'string' && raw.tip.trim()
          ? raw.tip.trim().slice(0, 260)
          : 'Could you confirm so I can help with the next step?';
    const askStage =
      raw.askStage === 'follow_up_guide' ? 'follow_up_guide' : 'diagnostic';
    const quickReplies = Array.isArray(raw.quickReplies)
      ? raw.quickReplies
          .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'))
          .slice(0, 5)
          .map((r, i) => ({
            id: typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 60) : `qr-${i + 1}`,
            label: typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 60) : 'Option',
            value: typeof r.value === 'string' && r.value.trim() ? r.value.trim().slice(0, 160) : 'yes',
            ...(r.variant === 'primary' || r.variant === 'secondary' || r.variant === 'danger'
              ? { variant: r.variant as 'primary' | 'secondary' | 'danger' }
              : {}),
          }))
      : undefined;

    return {
      action: 'ask_user',
      askStage,
      question: q,
      tip: truncateTipWords(
        typeof raw.tip === 'string' && raw.tip.trim() ? raw.tip : q,
        16
      ),
      ...(quickReplies && quickReplies.length > 0 ? { quickReplies } : {}),
    };
  }

  const action: GuideStepAction = (ALLOWED_GUIDE_ACTIONS as readonly string[]).includes(rawAction)
    ? (rawAction as GuideStepAction)
    : 'point_and_wait';

  const targetId = typeof raw.targetId === 'string' ? raw.targetId.trim() : '';
  const route = typeof raw.route === 'string' ? raw.route.trim() : '';
  const rawTip = typeof raw.tip === 'string' ? raw.tip : 'Follow the highlighted control.';
  const rawTotalSteps =
    typeof raw.totalSteps === 'number' && Number.isFinite(raw.totalSteps)
      ? Math.max(stepNumber, Math.min(MAX_GUIDE_STEPS, Math.round(raw.totalSteps)))
      : undefined;

  if (action === 'complete') {
    return {
      action: 'complete',
      totalSteps: Math.max(1, Math.min(MAX_GUIDE_STEPS, stepNumber)),
      tip: truncateTipWords(rawTip || 'Guide finished. Complete any final review.'),
    };
  }

  if (action === 'navigate') {
    const safeRoute = route.startsWith('/') ? route : '/';
    return {
      action: 'navigate',
      route: safeRoute,
      ...(rawTotalSteps ? { totalSteps: rawTotalSteps } : {}),
      tip: truncateTipWords(rawTip || `Opening ${safeRoute}.`),
    };
  }

  const matched = targetId ? pageMap.find((el) => el.id === targetId) : undefined;
  if (!matched) {
    const fallbackEl = pageMap[0];
    if (!fallbackEl) {
      return {
        action: 'complete',
        totalSteps: Math.max(1, Math.min(MAX_GUIDE_STEPS, stepNumber)),
        tip: truncateTipWords('No interactive controls found on this view.'),
      };
    }
    const sensitive = Boolean(fallbackEl.sensitive);
    return {
      action: 'point_and_wait',
      targetId: fallbackEl.id,
      ...(rawTotalSteps ? { totalSteps: rawTotalSteps } : {}),
      sensitiveBlocked: sensitive || undefined,
      tip: truncateTipWords(
        sensitive
          ? `Click ${fallbackEl.label || fallbackEl.id} manually to continue.`
          : rawTip || `Use ${fallbackEl.label || fallbackEl.id} here.`
      ),
    };
  }

  // Block AI from auto-clicking sensitive buttons or input fields
  if (action === 'click_safe' && (matched.sensitive || isInputLikeElement(matched))) {
    const sensitive = Boolean(matched.sensitive);
    return {
      action: 'point_and_wait',
      targetId: matched.id,
      ...(rawTotalSteps ? { totalSteps: rawTotalSteps } : {}),
      sensitiveBlocked: sensitive || undefined,
      tip: truncateTipWords(
        sensitive
          ? `Confirm and click "${matched.label || matched.id}" manually.`
          : `Enter your value here, then press Next.`
      ),
    };
  }

  return {
    action,
    targetId: matched.id,
    ...(rawTotalSteps ? { totalSteps: rawTotalSteps } : {}),
    sensitiveBlocked: matched.sensitive ? true : undefined,
    tip: truncateTipWords(rawTip),
  };
}

interface RouteHint {
  route: string;
  keywords: string[];
  label: string;
}

const FALLBACK_ROUTE_HINTS: RouteHint[] = [
  { route: '/login', keywords: ['demo', 'domo', 'demo mode', 'demo model', 'login', 'log in', 'sign in', 'signin', 'logout', 'log out', 'sign out', 'signout'], label: 'Portal Login & Demo' },
  { route: '/admin/students/import', keywords: ['import', 'excel', 'csv', 'spreadsheet'], label: 'Student Import' },
  { route: '/admin/students', keywords: ['add student', 'enroll student', 'student', 'students', 'class', 'admission'], label: 'Students' },
  { route: '/admin/sectors', keywords: ['sector', 'department', 'add sector', 'edit sector'], label: 'Sectors' },
  { route: '/admin/admins', keywords: ['manager', 'admin', 'invite', 'staff', 'permissions'], label: 'Managers' },
  { route: '/admin/institution', keywords: ['institution', 'logo', 'seal', 'signatory', 'signature', 'college profile', 'qr expiry'], label: 'Institution Profile' },
  { route: '/admin/issued-reports', keywords: ['issued report', 'revoke', 'qr'], label: 'Issued Reports' },
  { route: '/admin/audit', keywords: ['audit log', 'audit logs', 'audit', 'activity history', 'audit history'], label: 'Audit Log' },
  { route: '/m/dept-fiqh/bulk', keywords: ['bulk', 'batch entry', 'all students'], label: 'Bulk Entry' },
  { route: '/m/dept-fiqh/batches', keywords: ['batch history', 'batches'], label: 'Batches' },
  { route: '/m/dept-fiqh/reports', keywords: ['report', 'pdf', 'statement', 'export pdf'], label: 'Reports' },
  { route: '/m/dept-fiqh/ledger', keywords: ['new entry', 'credit', 'debit', 'payment', 'fee', 'deposit', 'ledger', 'void', 'receipt', 'transaction'], label: 'Sector Ledger' },
  { route: '/app/profile', keywords: ['my profile', 'phone', 'password', 'change password'], label: 'Student Profile' },
  { route: '/app/notifications', keywords: ['notification', 'notice', 'alert', 'unread'], label: 'Notifications' },
  { route: '/app', keywords: ['my balance', 'student portal'], label: 'Student Portal' },
  { route: '/admin', keywords: ['dashboard', 'overview', 'admin'], label: 'Admin Overview' },
];

function matchesRouteHintKeyword(lowerGoal: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(lowerGoal);
}

const STOP_WORDS = new Set([
  'how',
  'do',
  'i',
  'to',
  'the',
  'a',
  'an',
  'in',
  'on',
  'at',
  'for',
  'of',
  'as',
  'by',
  'or',
  'and',
  'with',
  'use',
  'using',
  'show',
  'me',
  'where',
  'can',
  'is',
  'are',
  'guide',
  'walk',
  'through',
  'please',
  'page',
  'app',
  'new',
  'my',
  'here',
  'this',
]);

// Generic, app-agnostic UI synonym groups (no domain-specific roles or routes)
const GENERIC_INTENT_CLUSTERS: Record<string, string[]> = {
  signin: ['login', 'signin', 'auth', 'authenticate', 'sign-in', 'log-in'],
  signup: ['signup', 'register', 'registration', 'sign-up', 'onboard'],
  export: ['export', 'download', 'report', 'statement', 'print'],
  import: ['import', 'upload', 'bulk', 'batch', 'spreadsheet'],
  payment: ['pay', 'payment', 'checkout', 'billing', 'transaction', 'invoice'],
  recover: ['forgot', 'reset', 'recover', 'password'],
  settings: ['settings', 'preferences', 'profile', 'account'],
};

function stemToken(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ches') || word.endsWith('shes') || word.endsWith('xes')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) {
    return word.slice(0, -1);
  }
  return word;
}

function normalizePhraseTokens(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/\bdomo\b/g, ' demo ')
    .replace(/\bmodel\b/g, ' mode ')
    .replace(/\blog\s+in\b/g, ' login signin ')
    .replace(/\bsign\s+in\b/g, ' signin login ')
    .replace(/\bsign\s+up\b/g, ' signup register ')
    .replace(/\blog\s+out\b/g, ' logout signout ')
    .replace(/[^a-z0-9\s/-]/g, ' ');

  const rawTokens = normalized
    .split(/[\s/-]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

  return Array.from(new Set(rawTokens.map(stemToken)));
}

function expandGoalStems(goal: string): { baseTokens: string[]; expandedTokens: Set<string>; intents: Set<string> } {
  const baseTokens = normalizePhraseTokens(goal);
  const expandedTokens = new Set<string>(baseTokens);
  const intents = new Set<string>();

  for (const token of baseTokens) {
    for (const [intent, synonyms] of Object.entries(GENERIC_INTENT_CLUSTERS)) {
      if (synonyms.includes(token)) {
        intents.add(intent);
        for (const syn of synonyms) {
          expandedTokens.add(stemToken(syn));
        }
      }
    }
  }

  return { baseTokens, expandedTokens, intents };
}

function extractGoalKeywords(goal: string): string[] {
  return normalizePhraseTokens(goal);
}

function scoreElement(el: PageMapElement, keywords: string[], wantsDemo = false): number {
  if (!wantsDemo && isDemoControl(el)) return 0;
  const hay = `${el.id} ${el.label} ${el.type}`.toLowerCase();
  let score = wantsDemo && isDemoControl(el) ? 5 : 0;
  for (const kw of keywords) {
    if (hay.includes(kw)) {
      score += el.id.toLowerCase().includes(kw) ? 4 : 3;
    }
  }
  return score;
}

function extractStructuralPrefix(id: string): string {
  const clean = id
    .toLowerCase()
    .replace(/-(btn|button|link|tab|item|option|card|pill)$/, '');
  const parts = clean.split('-').filter(Boolean);
  if (parts.length >= 3) {
    return parts.slice(0, 2).join('-');
  }
  if (parts.length === 2) {
    return parts[0]!;
  }
  return '';
}

function isRepeatedRowInstanceId(id: string): { isRowInstance: boolean; taskGroup: string; taskLabel: string } {
  const lower = id.toLowerCase();
  const rowVerbMatch = /^([a-z]+)-(?:mobile-)?(edit|delete|remove|void|toggle|view|download)-([a-z0-9_-]+)$/.exec(
    lower
  );
  if (rowVerbMatch) {
    const entity = rowVerbMatch[1]!;
    const verb = rowVerbMatch[2]!;
    const suffix = rowVerbMatch[3]!;
    // Avoid misclassifying static non-row controls like `sector-edit-save-btn` or `manager-edit-remove-btn`
    const staticModalSubcontrols = /^(btn|save|cancel|submit|confirm|name|email|phone|desc|target|prefix|status|input|select)$/;
    if (!staticModalSubcontrols.test(suffix) && !suffix.endsWith('-btn') && !suffix.endsWith('-input')) {
      const capVerb = verb.charAt(0).toUpperCase() + verb.slice(1);
      return {
        isRowInstance: true,
        taskGroup: `${entity}-${verb}`,
        taskLabel: `${capVerb} ${entity}`,
      };
    }
  }
  return { isRowInstance: false, taskGroup: '', taskLabel: '' };
}

function collapseRepeatedRowControls(controls: PageMapElement[]): {
  primaryControls: PageMapElement[];
  rowTaskRepresentatives: Array<{ el: PageMapElement; taskLabel: string }>;
} {
  const primaryControls: PageMapElement[] = [];
  const rowGroups = new Map<string, { el: PageMapElement; taskLabel: string; count: number }>();

  for (const el of controls) {
    const info = isRepeatedRowInstanceId(el.id);
    if (info.isRowInstance) {
      const existing = rowGroups.get(info.taskGroup);
      if (!existing) {
        rowGroups.set(info.taskGroup, { el, taskLabel: info.taskLabel, count: 1 });
      } else {
        existing.count += 1;
      }
    } else {
      primaryControls.push(el);
    }
  }

  const rowTaskRepresentatives: Array<{ el: PageMapElement; taskLabel: string }> = [];
  for (const group of rowGroups.values()) {
    if (group.count === 1) {
      primaryControls.push(group.el);
    } else {
      rowTaskRepresentatives.push({ el: group.el, taskLabel: group.taskLabel });
    }
  }

  return { primaryControls, rowTaskRepresentatives };
}

function tokenizeOptionIdentity(label: string, id: string): string[] {
  const cleanId = id
    .toLowerCase()
    .replace(/^route-/, '')
    .replace(/-(btn|button|link|tab|item|option)$/, '');
  const normalizedLabel = label
    .toLowerCase()
    .replace(/\blog\s+in\b/g, ' login ')
    .replace(/\bsign\s+in\b/g, ' signin ')
    .replace(/\bsign\s+up\b/g, ' signup ');
  const raw = `${normalizedLabel} ${cleanId}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
    .map(stemToken);
  return Array.from(new Set(raw));
}

export interface DetectAmbiguityParams {
  goal: string;
  pageMap: PageMapElement[];
  currentRoute: string;
  availableRoutes?: AvailableRouteHint[];
  appContext?: string;
  confirmedPath?: boolean;
  stepNumber?: number;
}

/**
 * Completely app-agnostic dynamic path disambiguation.
 * Infers competing paths strictly from `pageMap`, `availableRoutes`, and `currentRoute`
 * without hardcoding any domain-specific roles, portals, or route paths.
 */
export function detectAmbiguousGuidePaths(
  params: DetectAmbiguityParams
): GuideStepResponse | null {
  const {
    goal,
    pageMap,
    currentRoute,
    availableRoutes = [],
    confirmedPath = false,
    stepNumber = 1,
  } = params;

  if (confirmedPath || stepNumber > 1) return null;

  const cleanGoal = goal.trim();
  if (!cleanGoal) return null;

  const lowerGoal = cleanGoal.toLowerCase();
  const isGenericOverviewGoal =
    lowerGoal.includes('main actions on this page') ||
    /^(?:please\s+)?(?:guide\s+me|help\s+me|what\s+can\s+i\s+do(?:\s+here)?|show\s+me\s+around)\s*\??$/.test(
      lowerGoal
    );

  const { baseTokens, expandedTokens, intents } = expandGoalStems(cleanGoal);
  if (baseTokens.length === 0 && !isGenericOverviewGoal) return null;

  const wantsDemo = /\b(demo|domo|sample|preview|trial)\b/i.test(cleanGoal);
  const wantsLogout = /\b(log\s*out|logout|sign\s*out|signout)\b/i.test(cleanGoal);

  // Actionable non-input, non-noise controls from pageMap, collapsing repeated table-row instances
  const rawActionableControls = pageMap.filter(
    (el) =>
      !isInputLikeElement(el) &&
      !isNoiseControl(el, wantsLogout) &&
      Boolean(el.label?.trim() || el.id)
  );
  const { primaryControls: nonRowControls, rowTaskRepresentatives } =
    collapseRepeatedRowControls(rawActionableControls);

  // 1. Structural sibling cluster discovery (e.g. *-role-*, *-method-*, *-mode-*, *-type-*, tab groups)
  const prefixClusters = new Map<string, PageMapElement[]>();
  for (const el of nonRowControls) {
    const prefix = extractStructuralPrefix(el.id);
    if (!prefix) continue;
    const list = prefixClusters.get(prefix) || [];
    list.push(el);
    prefixClusters.set(prefix, list);
  }

  interface CandidateGroup {
    score: number;
    elements: PageMapElement[];
    isVariantCluster: boolean;
  }

  const candidateGroups: CandidateGroup[] = [];

  for (const [prefix, els] of prefixClusters.entries()) {
    const uniqueLabels = new Set(
      els.map((e) => (e.label || e.id).trim().toLowerCase()).filter(Boolean)
    );
    if (uniqueLabels.size < 2) continue;

    const isDemoCluster = /\bdemo\b/.test(prefix);
    if (isDemoCluster && !wantsDemo) continue;

    // Score how strongly this group relates to the user's goal
    const routeTokens = normalizePhraseTokens(currentRoute);
    const prefixTokens = normalizePhraseTokens(prefix);
    const groupHayTokens = new Set([...prefixTokens, ...routeTokens]);

    let topicHits = 0;
    for (const tok of expandedTokens) {
      if (groupHayTokens.has(tok)) {
        topicHits += 1;
      }
    }
    if (intents.has('settings') && /\b(tab|section)\b/.test(prefix)) {
      topicHits += 1;
    }

    // Strip the shared prefix from each child's id before counting child-specific matches
    // so prefix tokens (like "auth" in "auth-tab-signup") don't falsely match every sibling tab.
    let matchingChildren = 0;
    for (const el of els) {
      const idSuffix = el.id.toLowerCase().startsWith(`${prefix.toLowerCase()}-`)
        ? el.id.slice(prefix.length + 1)
        : el.id;
      const childHay = `${idSuffix} ${el.label}`.toLowerCase();
      const childTokens = normalizePhraseTokens(`${idSuffix} ${el.label}`);
      const hasMatch =
        Array.from(expandedTokens).some((t) => childTokens.includes(t) || childHay.includes(t));
      if (hasMatch) matchingChildren += 1;
    }

    const isSubPathCluster =
      /\b(role|method|mode|type|provider|option|channel|format)\b/.test(prefix) ||
      (wantsDemo && isDemoCluster);
    const isVariantCluster = isSubPathCluster || /\btab\b/.test(prefix);

    // Skip mixed-intent tab clusters (e.g. "Sign in" vs "Create college") when user clearly asked for only one intent
    const isMixedTabCluster =
      !isSubPathCluster && matchingChildren > 0 && matchingChildren < els.length;
    if (isMixedTabCluster) continue;

    if (matchingChildren >= 2 || (topicHits >= 1 && els.length >= 2)) {
      let score = topicHits * 4 + matchingChildren * 3;
      if (isSubPathCluster) {
        score += 8 + els.length;
      } else if (isVariantCluster) {
        score += 2;
      }
      if (!isDemoCluster) {
        score += 2;
      } else if (wantsDemo) {
        score += 10;
      }
      candidateGroups.push({ score, elements: els, isVariantCluster });
    }
  }

  candidateGroups.sort((a, b) => b.score - a.score);
  const topCandidate = candidateGroups[0];
  const topControlGroup = topCandidate?.isVariantCluster ? topCandidate.elements : [];

  // 2. Page-section multi-task discovery:
  // If user asked a broad question about the current page's topic (e.g. "guide students" on /admin/students,
  // "guide managers" on /admin/admins, "guide ledger" on /m/.../ledger, or "what can I do here?"),
  // collect distinct page task controls + collapsed row task types.
  const currentRouteLabel = availableRoutes.find((r) => r.route === currentRoute)?.label || '';
  const currentPageTopicTokens = new Set(normalizePhraseTokens(`${currentRoute} ${currentRouteLabel}`));
  const goalMatchesCurrentPageTopic =
    isGenericOverviewGoal ||
    baseTokens.some((tok) => currentPageTopicTokens.has(tok)) ||
    (intents.has('settings') && /institution|profile|settings/i.test(`${currentRoute} ${currentRouteLabel}`));

  const isNavOrHeaderChrome = (el: PageMapElement): boolean => {
    const idLower = el.id.toLowerCase();
    if (!wantsDemo && idLower.startsWith('login-demo')) return true;
    return /^(nav-|mobile-nav-|header-|user-menu|role-switcher|sector-switcher|students-class-chip|ledger-type-|pager-)/.test(
      idLower
    );
  };

  const pageSectionTasks: Array<{ el: PageMapElement; labelOverride?: string }> = [];
  if (topControlGroup.length < 2 && goalMatchesCurrentPageTopic) {
    const pageActionControls = nonRowControls.filter(
      (el) =>
        !isNavOrHeaderChrome(el) &&
        !(/\bdemo\b/i.test(el.id) && !wantsDemo) &&
        Boolean((el.label || '').trim())
    );
    for (const el of pageActionControls) {
      pageSectionTasks.push({ el });
    }
    for (const rep of rowTaskRepresentatives) {
      pageSectionTasks.push({ el: rep.el, labelOverride: rep.taskLabel });
    }
  }

  // If no variant cluster or page-section tasks matched, still keep top non-variant prefix cluster
  const resolvedControlGroup =
    topControlGroup.length >= 2
      ? topControlGroup
      : pageSectionTasks.length >= 2
        ? []
        : topCandidate?.elements || [];

  // 3. Direct multi-control match fallback (controls not necessarily sharing a 2-part prefix)
  const directControlMatches: PageMapElement[] = [];
  if (resolvedControlGroup.length < 2 && pageSectionTasks.length < 2) {
    const scoredDirect = nonRowControls
      .filter((el) => !isNavOrHeaderChrome(el))
      .map((el) => {
        const hay = `${el.id} ${el.label}`.toLowerCase();
        const elTokens = normalizePhraseTokens(`${el.id} ${el.label}`);
        let hits = 0;
        for (const tok of baseTokens) {
          if (elTokens.includes(tok) || hay.includes(tok)) hits += 1;
        }
        return { el, hits };
      })
      .filter((x) => x.hits > 0 && !(/\bdemo\b/i.test(x.el.id) && !wantsDemo));

    if (scoredDirect.length >= 2) {
      const maxHits = Math.max(...scoredDirect.map((x) => x.hits));
      for (const item of scoredDirect) {
        if (item.hits === maxHits || item.hits >= 1) {
          directControlMatches.push(item.el);
        }
      }
    }
  }

  // 4. Dynamic route structure matches (from DOM links or host-provided availableRoutes)
  const matchingRoutes = isGenericOverviewGoal
    ? []
    : availableRoutes.filter((r) => {
        const routeHay = `${r.route} ${r.label}`.toLowerCase();
        const routeTokens = normalizePhraseTokens(`${r.route} ${r.label}`);
        for (const tok of expandedTokens) {
          if (routeTokens.includes(tok) || routeHay.includes(tok)) {
            return true;
          }
        }
        return false;
      });

  // Build deduplicated clarification options
  const rawOptions: GuideClarificationOption[] = [];
  const seenLabels = new Set<string>();

  const primaryItems: Array<{ el: PageMapElement; labelOverride?: string }> =
    topControlGroup.length >= 2
      ? topControlGroup.map((el) => ({ el }))
      : pageSectionTasks.length >= 2
        ? pageSectionTasks
        : resolvedControlGroup.length >= 2
          ? resolvedControlGroup.map((el) => ({ el }))
          : directControlMatches.length >= 2
            ? directControlMatches.map((el) => ({ el }))
            : [];

  for (const item of primaryItems) {
    const el = item.el;
    const label = (item.labelOverride || el.label || el.id).trim().slice(0, 80);
    const norm = label.toLowerCase();
    if (!label || seenLabels.has(norm)) continue;
    seenLabels.add(norm);
    rawOptions.push({
      id: el.id,
      label,
      refinedGoal: isGenericOverviewGoal
        ? `Guide me to "${label}"`
        : `${cleanGoal} using "${label}"`,
      targetId: el.id,
      route: el.currentRoute || currentRoute,
    });
  }

  const hasCurrentRouteControlGroup = resolvedControlGroup.length >= 2 || pageSectionTasks.length >= 2;
  for (const r of matchingRoutes) {
    // If we already discovered specific paths/roles inside the current page, don't add a redundant generic route for currentRoute
    if (hasCurrentRouteControlGroup && r.route === currentRoute) continue;
    const label = r.label.trim().slice(0, 80);
    const norm = label.toLowerCase();
    if (!label || seenLabels.has(norm)) continue;
    seenLabels.add(norm);
    const slug = r.route.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'route';
    rawOptions.push({
      id: `route-${slug}`,
      label,
      description: r.route,
      refinedGoal: `${cleanGoal} via "${label}"`,
      route: r.route,
    });
  }

  if (rawOptions.length < 2) return null;

  // 4. Specificity Check: did the user ALREADY choose one specific option in their prompt?
  // Broad intent synonyms (e.g. "signin", "login", "export", "report") must NOT count as specific path distinguishers.
  const topicIntentTokens = new Set<string>(['sign', 'log']);
  for (const intent of intents) {
    for (const syn of GENERIC_INTENT_CLUSTERS[intent] || []) {
      for (const part of syn.split(/[\s-]+/)) {
        if (part.length >= 2) topicIntentTokens.add(part);
      }
      topicIntentTokens.add(syn);
    }
  }

  const tokenFreq = new Map<string, number>();
  const optionTokenSets = rawOptions.map((opt) => {
    const tokens = tokenizeOptionIdentity(opt.label, opt.id);
    for (const t of tokens) {
      tokenFreq.set(t, (tokenFreq.get(t) || 0) + 1);
    }
    return tokens;
  });

  const sharedGroupTokens = new Set<string>();
  for (const [tok, count] of tokenFreq.entries()) {
    if (count > 1) sharedGroupTokens.add(tok);
  }

  const goalTokenSet = new Set(baseTokens);
  const specificScores = rawOptions.map((opt, idx) => {
    const optTokens = optionTokenSets[idx]!;
    const uniqueDistinguishers = optTokens.filter(
      (t) => !sharedGroupTokens.has(t) && !topicIntentTokens.has(t)
    );
    let matchedCount = 0;
    for (const t of uniqueDistinguishers) {
      if (goalTokenSet.has(t)) matchedCount += 1;
    }

    // Also count how many non-intent label words match the user's goal (helps distinguish "Admin" vs "Super Admin")
    const labelSpecificWords = normalizePhraseTokens(opt.label).filter(
      (t) => !topicIntentTokens.has(t)
    );
    const labelWordHits = labelSpecificWords.filter((t) => goalTokenSet.has(t)).length;
    const allLabelSpecificMatched =
      labelSpecificWords.length > 0 && labelWordHits === labelSpecificWords.length;

    const normLabel = opt.label.toLowerCase();
    const fullLabelInGoal =
      normLabel.length >= 3 &&
      !topicIntentTokens.has(normLabel) &&
      lowerGoal.includes(normLabel);

    const score =
      matchedCount * 4 +
      (allLabelSpecificMatched ? labelSpecificWords.length * 3 : 0) +
      (fullLabelInGoal ? normLabel.split(/\s+/).length * 4 : 0);

    return {
      opt,
      matchedCount,
      fullLabelInGoal,
      score,
    };
  });

  const highestSpec = Math.max(...specificScores.map((s) => s.score));
  if (highestSpec > 0) {
    const topMatches = specificScores.filter((s) => s.score === highestSpec);
    if (topMatches.length === 1) {
      // User already specified a unique path (e.g. "log in as student" or "export csv")
      return null;
    }
  }

  // Also check if an option only differs by a prefix-topic token already matched in intent
  // Ensure at least 2 distinct options remain
  const finalOptions = rawOptions.slice(0, 5);
  if (finalOptions.length < 2) return null;

  const topicPreview =
    wantsDemo
      ? 'demo'
      : intents.has('signin')
        ? 'sign-in'
        : intents.has('signup')
          ? 'registration'
          : intents.has('export')
            ? 'export'
            : intents.has('import')
              ? 'import'
              : intents.has('payment')
                ? 'payment'
                : 'available';

  return {
    action: 'clarify',
    question: `Multiple ${topicPreview} paths are available. Which one would you like me to guide you through?`,
    options: finalOptions,
    tip: truncateTipWords('Select a path in chat to start your guided walkthrough.'),
  };
}

/**
 * Matches an ambiguous user chat reply (e.g. "Student", "the second one", "2")
 * back to a pending clarification option.
 */
export function matchClarificationReply(
  replyText: string,
  options: GuideClarificationOption[]
): GuideClarificationOption | null {
  const clean = replyText.trim().toLowerCase();
  if (!clean || options.length === 0) return null;

  // Numeric and ordinal selection ("1", "option 2", "first", "2nd", "last")
  const numMatch = /^(?:option\s+|#)?(\d+)$/.exec(clean);
  if (numMatch?.[1]) {
    const idx = Number(numMatch[1]) - 1;
    if (idx >= 0 && idx < options.length) {
      return options[idx]!;
    }
  }

  const ordinalMap: Record<string, number> = {
    first: 0,
    '1st': 0,
    one: 0,
    second: 1,
    '2nd': 1,
    two: 1,
    third: 2,
    '3rd': 2,
    three: 2,
    fourth: 3,
    '4th': 3,
    four: 3,
    fifth: 4,
    '5th': 4,
    five: 4,
  };
  const cleanOrdinal = clean.replace(/\b(?:the|option|number|one)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean === 'last' || clean === 'last one') {
    return options[options.length - 1] ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(ordinalMap, cleanOrdinal)) {
    const idx = ordinalMap[cleanOrdinal]!;
    if (idx >= 0 && idx < options.length) {
      return options[idx]!;
    }
  }

  // Exact, collapsed-space, or substring label match (longest match wins so "Super Admin" beats "Admin")
  const collapsedClean = clean.replace(/\s+/g, '');
  const labelMatches = options
    .filter((opt) => {
      const lbl = opt.label.toLowerCase();
      const collapsedLbl = lbl.replace(/\s+/g, '');
      return (
        lbl === clean ||
        collapsedLbl === collapsedClean ||
        clean.includes(lbl) ||
        collapsedClean.includes(collapsedLbl) ||
        lbl.includes(clean)
      );
    })
    .sort((a, b) => b.label.length - a.label.length);

  if (labelMatches.length === 1) return labelMatches[0]!;
  if (labelMatches.length > 1 && labelMatches[0]!.label.length > labelMatches[1]!.label.length) {
    return labelMatches[0]!;
  }

  const replyTokens = normalizePhraseTokens(clean);
  if (replyTokens.length === 0) return null;

  const scored = options
    .map((opt) => {
      const optTokens = tokenizeOptionIdentity(opt.label, opt.id);
      const hits = replyTokens.filter((t) => optTokens.includes(t)).length;
      return { opt, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (scored.length === 1) return scored[0]!.opt;
  if (scored.length > 1 && scored[0]!.hits > scored[1]!.hits) {
    return scored[0]!.opt;
  }

  return null;
}

function isOptionalInputElement(el: PageMapElement): boolean {
  return /\b(guardian|phone|mobile|notes?|remark|optional|description|comment)\b/i.test(
    `${el.id} ${el.label}`
  );
}

function isFormOpenTriggerControl(el: PageMapElement, hasActiveFormInputs: boolean): boolean {
  if (hasActiveFormInputs) return false;
  return (
    el.type !== 'submit' &&
    /\b(add|new|open|create|invite|edit|bulk|batch)\b/i.test(`${el.id} ${el.label}`) &&
    !/(submit|save|confirm|export|download)/i.test(el.id)
  );
}

function isFinalSubmitOrActionButton(el: PageMapElement, hasActiveFormInputs: boolean): boolean {
  if (isInputLikeElement(el)) return false;
  if (isFormOpenTriggerControl(el, hasActiveFormInputs)) return false;
  if (el.sensitive || el.type === 'submit') return true;
  return /(submit|save|create-college|signup-submit|login-submit|confirm|pay|post|import-commit|export|download|signout|sign-out|logout)/i.test(
    `${el.id} ${el.label}`
  );
}

/**
 * Estimates the exact number of steps required for the given task based on
 * the current decision, DOM elements on screen, and previous progress.
 * Never defaults to a flat 10 for short 1–5 step workflows.
 */
export function estimateRequiredGuideSteps(params: {
  goal: string;
  currentRoute: string;
  stepNumber: number;
  pageMap: PageMapElement[];
  decision: GuideStepResponse;
  previousStepSummary?: string;
  llmTotalSteps?: number;
}): number {
  const {
    goal,
    stepNumber,
    pageMap,
    decision,
    previousStepSummary = '',
    llmTotalSteps,
  } = params;

  const safeStep = Math.max(1, Math.min(MAX_GUIDE_STEPS, stepNumber));

  if (
    decision.action === 'complete' ||
    decision.action === 'ask_user' ||
    decision.action === 'refresh_and_retry'
  ) {
    return safeStep;
  }

  const lowerGoal = goal.toLowerCase();
  const prevLower = previousStepSummary.toLowerCase();
  const coreGoalForScope = lowerGoal.replace(/\b(?:using|via)\s+"[^"]*"/gi, ' ').trim();
  const wantsDemo = /\b(demo|domo|sample|preview|trial)\b/i.test(lowerGoal);
  const wantsLogout = /\b(log\s*out|logout|sign\s*out|signout)\b/i.test(lowerGoal);
  const hasPostLoginTask =
    /\b(add|create|enroll|invite|import|upload|export|download|delete|remove|edit|update|void|pay|payment|fee|deposit|bulk|batch|report|statement|password|reset|profile|notification|notice|ledger|institution|audit|receipt|settings)\b/i.test(
      coreGoalForScope
    );
  const isLoginOnlyGoal =
    /\b(log\s*in|sign\s*in|login|signin)\b/i.test(coreGoalForScope) && !hasPostLoginTask;
  const isDemoOnlyGoal = wantsDemo && !hasPostLoginTask;

  const formInputsInMap = pageMap.filter(
    (el) =>
      isInputLikeElement(el) &&
      !el.id.includes('search') &&
      !el.id.includes('filter')
  );
  const hasActiveFormInputs = formInputsInMap.length > 0;

  let remaining = 0;

  if (decision.action === 'navigate') {
    if (isDemoOnlyGoal || wantsLogout) {
      remaining = 1;
    } else if (isLoginOnlyGoal) {
      remaining = 2;
    } else if (/\b(export|download|report|statement|pdf|csv|excel|view|audit)\b/i.test(lowerGoal)) {
      remaining = 1;
    } else if (/\b(add|create|enroll|invite|edit|import|bulk|batch|pay|fee|deposit|register|signup)\b/i.test(lowerGoal)) {
      remaining = 3;
    } else {
      remaining = 1;
    }
  } else {
    const targetEl = decision.targetId
      ? pageMap.find((el) => el.id === decision.targetId)
      : undefined;

    if (!targetEl) {
      remaining = 0;
    } else if (wantsDemo && isDemoControl(targetEl)) {
      remaining = 0;
    } else if (wantsLogout && targetEl.id === 'user-menu-btn') {
      remaining = 1;
    } else if (isFinalSubmitOrActionButton(targetEl, hasActiveFormInputs)) {
      remaining = 0;
    } else if (isInputLikeElement(targetEl)) {
      const remainingRequiredInputs = formInputsInMap.filter(
        (el) =>
          el.id !== targetEl.id &&
          !el.hasValue &&
          !prevLower.includes(el.id.toLowerCase()) &&
          !isOptionalInputElement(el)
      );
      remaining = Math.min(2, remainingRequiredInputs.length) + 1;
    } else if (isFormOpenTriggerControl(targetEl, hasActiveFormInputs)) {
      if (/\b(signup|register|college|create\s+org|create\s+college)\b/i.test(lowerGoal)) {
        remaining = 3;
      } else {
        remaining = 2;
      }
    } else if (/\brole\b/i.test(targetEl.id) && isLoginOnlyGoal) {
      remaining = 2;
    } else {
      remaining = hasActiveFormInputs ? 1 : 0;
    }
  }

  const deterministicTotal = Math.max(
    safeStep,
    Math.min(MAX_GUIDE_STEPS, safeStep + remaining)
  );

  if (
    typeof llmTotalSteps === 'number' &&
    Number.isFinite(llmTotalSteps) &&
    llmTotalSteps >= safeStep &&
    llmTotalSteps < MAX_GUIDE_STEPS
  ) {
    return Math.min(MAX_GUIDE_STEPS, Math.max(deterministicTotal, Math.round(llmTotalSteps)));
  }

  return deterministicTotal;
}

/**
 * Deterministic fallback planner used when OpenRouter is unkeyed or offline.
 * Respects all safety guardrails: 10-step cap, no sensitive auto-clicking,
 * pausing on inputs, <=12 word tips, and accurate per-task totalSteps.
 */
export function buildDeterministicGuideStep(params: {
  goal: string;
  previousStepSummary?: string;
  pageMap: PageMapElement[];
  stepNumber: number;
  currentRoute: string;
  confirmedPath?: boolean;
  preferredTargetId?: string;
  preferredRoute?: string;
  availableRoutes?: AvailableRouteHint[];
}): GuideStepResponse {
  const {
    goal,
    previousStepSummary = '',
    pageMap,
    stepNumber,
    currentRoute,
    preferredTargetId,
    preferredRoute,
    availableRoutes = [],
  } = params;

  const finalize = (rawDecision: Record<string, unknown>): GuideStepResponse => {
    const safe = sanitizeGuideStepDecision(rawDecision, pageMap, stepNumber, {
      availableRoutes,
      currentRoute,
    });
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
    };
  };

  if (stepNumber >= MAX_GUIDE_STEPS) {
    return finalize({
      action: 'complete',
      tip: 'Final step reached. Complete any remaining fields manually.',
    });
  }

  // If the user was just guided to a modal/drawer submit button and that button disappeared
  // (meaning the form submitted & closed cleanly), mark the task complete instead of looping on the background page.
  const guidedSubmitMatches = [...previousStepSummary.matchAll(/guided user to ([a-z0-9_-]+)/gi)];
  const lastGuidedId = guidedSubmitMatches[guidedSubmitMatches.length - 1]?.[1]?.toLowerCase() || '';
  if (
    lastGuidedId &&
    /(submit|save|create|confirm|pay|post|import)/i.test(lastGuidedId) &&
    !/(login|signin)/i.test(lastGuidedId) &&
    !pageMap.some((el) => el.id.toLowerCase() === lastGuidedId)
  ) {
    return finalize({
      action: 'complete',
      tip: 'Done! Your changes have been saved.',
    });
  }

  const lowerGoal = goal.toLowerCase();
  const prevLower = previousStepSummary.toLowerCase();
  const keywords = extractGoalKeywords(goal);
  const wantsDemo = /\b(demo|domo|sample|preview|trial)\b/i.test(lowerGoal);
  const wantsLogout = /\b(log\s*out|logout|sign\s*out|signout)\b/i.test(lowerGoal);
  const { intents } = expandGoalStems(goal);

  // Strict goal scoping: if user asked to log in / sign in / open demo (with no secondary post-login action),
  // complete immediately once the browser has reached a non-auth overview/portal route.
  const coreGoalForScope = lowerGoal.replace(/\b(?:using|via)\s+"[^"]*"/gi, ' ').trim();
  const hasPostLoginTask =
    /\b(add|create|enroll|invite|import|upload|export|download|delete|remove|edit|update|void|pay|payment|fee|deposit|bulk|batch|report|statement|password|reset|profile|notification|notice|ledger|institution|audit|receipt|settings)\b/i.test(
      coreGoalForScope
    );
  const isLoginOnlyGoal =
    (intents.has('signin') || /\b(log\s*in|sign\s*in|login|signin)\b/i.test(coreGoalForScope)) &&
    !hasPostLoginTask;
  const isDemoOnlyGoal = wantsDemo && !hasPostLoginTask;

  if (
    (isLoginOnlyGoal || isDemoOnlyGoal) &&
    !isAuthRoutePath(currentRoute) &&
    (stepNumber >= 2 ||
      prevLower.includes('login') ||
      prevLower.includes('sign in') ||
      prevLower.includes('signin') ||
      prevLower.includes('demo') ||
      prevLower.includes('domo') ||
      prevLower.includes('clicked'))
  ) {
    return finalize({
      action: 'complete',
      tip: isDemoOnlyGoal
        ? 'Demo mode opened and ready.'
        : 'Signed in and on the overview page.',
    });
  }

  if (wantsDemo && isAuthRoutePath(currentRoute) && prevLower.includes('login-demo-')) {
    return finalize({
      action: 'complete',
      tip: 'Opening demo workspace now.',
    });
  }

  // Filter out demo controls completely unless user explicitly asked for demo
  const candidatePool = wantsDemo ? pageMap : pageMap.filter((el) => !isDemoControl(el));

  if (wantsLogout) {
    if (isAuthRoutePath(currentRoute)) {
      return finalize({
        action: 'complete',
        tip: 'You are signed out on the Login page.',
      });
    }
    const signOutEl = candidatePool.find((el) =>
      /\b(signout|sign\s*out|logout|log\s*out)\b/i.test(`${el.id} ${el.label}`)
    );
    if (signOutEl) {
      return finalize({
        action: 'point_and_wait',
        targetId: signOutEl.id,
        tip: 'Click Sign out to end your current session.',
      });
    }
    const userMenuBtn = candidatePool.find((el) => el.id === 'user-menu-btn');
    if (userMenuBtn && !prevLower.includes('user-menu-btn')) {
      return finalize({
        action: 'click_safe',
        targetId: userMenuBtn.id,
        tip: 'Open your profile menu to find Sign out.',
      });
    }
  }

  // If user asked to open demo mode while signed into an overview/dashboard route, navigate to /login first
  if (
    wantsDemo &&
    !isAuthRoutePath(currentRoute) &&
    !candidatePool.some(isDemoControl) &&
    !prevLower.includes('navigated to /login')
  ) {
    return finalize({
      action: 'navigate',
      route: '/login',
      tip: 'Opening Portal Login for demo mode.',
    });
  }

  // If on /login for demo mode without a specific role named, highlight the demo role buttons cleanly
  if (wantsDemo && isAuthRoutePath(currentRoute) && !preferredTargetId) {
    const demoButtons = candidatePool.filter(isDemoControl);
    if (demoButtons.length > 0 && !/\b(admin|manager|student)\b/i.test(lowerGoal)) {
      return finalize({
        action: 'point_and_wait',
        targetId: demoButtons[0]!.id,
        tip: 'Pick Admin, Sector Manager, or Student to open demo.',
      });
    }
  }

  // Honor confirmed target route or target element on Step 1
  if (stepNumber === 1) {
    if (
      preferredRoute &&
      preferredRoute !== currentRoute &&
      !prevLower.includes(`navigated to ${preferredRoute.toLowerCase()}`)
    ) {
      const matchedAvail = availableRoutes.find((r) => r.route === preferredRoute);
      return finalize({
        action: 'navigate',
        route: preferredRoute,
        tip: `Opening ${matchedAvail?.label || preferredRoute}.`,
      });
    }

    if (preferredTargetId && !prevLower.includes(preferredTargetId.toLowerCase())) {
      const prefEl = candidatePool.find((el) => el.id === preferredTargetId);
      if (prefEl) {
        if (prefEl.sensitive || isInputLikeElement(prefEl)) {
          return finalize({
            action: 'point_and_wait',
            targetId: prefEl.id,
            tip: prefEl.sensitive
              ? `Review and click "${prefEl.label || prefEl.id}" manually.`
              : `Enter "${prefEl.label || prefEl.id}", then press Next.`,
          });
        }
        return finalize({
          action: 'click_safe',
          targetId: prefEl.id,
          tip: `Select "${prefEl.label || prefEl.id}".`,
        });
      }
    }
  }

  // Rank visible page controls against goal keywords (never demo unless requested)
  const ranked = [...candidatePool]
    .map((el) => ({ el, score: scoreElement(el, keywords, wantsDemo) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  // Skip already-filled inputs so step progression moves forward cleanly
  const unfilledInput = candidatePool.find(
    (el) =>
      isInputLikeElement(el) &&
      !el.hasValue &&
      !prevLower.includes(el.id.toLowerCase()) &&
      !el.id.includes('search')
  );

  // Prefer unvisited, unfilled modal/drawer/form inputs (required first, skip purely optional ones if ready to submit)
  const unvisitedFormInputs = candidatePool
    .filter(
      (el) =>
        isInputLikeElement(el) &&
        !el.hasValue &&
        !prevLower.includes(el.id.toLowerCase()) &&
        !el.id.includes('search') &&
        !el.id.includes('filter') &&
        (el.id.includes('drawer') ||
          el.id.includes('dialog') ||
          el.id.includes('modal') ||
          el.id.includes('form') ||
          el.id.includes('input'))
    )
    .sort((a, b) => Number(isOptionalInputElement(a)) - Number(isOptionalInputElement(b)));

  const unvisitedRequiredFormInputs = unvisitedFormInputs.filter(
    (el) => !isOptionalInputElement(el)
  );

  if (
    unvisitedRequiredFormInputs.length > 0 &&
    (prevLower.includes('clicked') || prevLower.includes('guided'))
  ) {
    const nextInput = unvisitedRequiredFormInputs[0]!;
    return finalize({
      action: 'point_and_wait',
      targetId: nextInput.id,
      tip: `Enter ${nextInput.label || 'required value'}, then click Next.`,
    });
  }

  const isCancelOrClose = (el: PageMapElement): boolean => {
    const text = `${el.id} ${el.label}`;
    if (wantsLogout && /\b(logout|signout|sign\s*out)\b/i.test(text)) return false;
    return /\b(cancel|close|dismiss|back|prev|logout|signout|sign\s*out)\b/i.test(text);
  };

  // When a drawer/dialog submit/save/create button is visible and required inputs are completed, guide manually to it
  const visibleSubmitBtn = candidatePool.find(
    (el) =>
      (el.sensitive || el.type === 'submit') &&
      !isCancelOrClose(el) &&
      !prevLower.includes(el.id.toLowerCase()) &&
      /(submit|save|create|confirm|pay|post|import)/i.test(`${el.id} ${el.label}`)
  );

  // Dynamic availableRoutes navigation check FIRST (app-agnostic)
  const dynamicRouteCandidates = availableRoutes
    .filter((r) => r.route !== currentRoute && !currentRoute.startsWith(r.route + '/'))
    .map((r) => {
      const hay = `${r.route} ${r.label}`.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (hay.includes(kw)) score += 3;
      }
      return { route: r.route, label: r.label, score };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score);

  const dynamicRoute = dynamicRouteCandidates[0];
  if (
    dynamicRoute &&
    !prevLower.includes(`navigated to ${dynamicRoute.route.toLowerCase()}`) &&
    (!ranked[0] || ranked[0].score < 4)
  ) {
    return finalize({
      action: 'navigate',
      route: dynamicRoute.route,
      tip: `Opening ${dynamicRoute.label} page.`,
    });
  }

  // Fallback route hints when availableRoutes wasn't supplied
  const matchedRouteHint = FALLBACK_ROUTE_HINTS.find((h) =>
    h.keywords.some((kw) => matchesRouteHintKeyword(lowerGoal, kw))
  );

  if (
    matchedRouteHint &&
    currentRoute !== matchedRouteHint.route &&
    !currentRoute.startsWith(matchedRouteHint.route) &&
    !prevLower.includes(`navigated to ${matchedRouteHint.route.toLowerCase()}`) &&
    (!ranked[0] || ranked[0].score < 4)
  ) {
    return finalize({
      action: 'navigate',
      route: matchedRouteHint.route,
      tip: `Opening ${matchedRouteHint.label} page.`,
    });
  }

  // Prefer pointing to the visible submit button once required form inputs are completed
  if (
    visibleSubmitBtn &&
    unvisitedRequiredFormInputs.length === 0 &&
    (prevLower.includes('guided') || prevLower.includes('clicked'))
  ) {
    return finalize({
      action: 'point_and_wait',
      targetId: visibleSubmitBtn.id,
      tip: `Fill optional details if needed, then click "${visibleSubmitBtn.label || visibleSubmitBtn.id}".`,
    });
  }

  // Find next strong matching element that wasn't just visited, preferring non-sensitive actions & inputs over final sensitive submit buttons
  const freshMatch =
    ranked.find(
      (item) =>
        !prevLower.includes(item.el.id.toLowerCase()) &&
        !item.el.sensitive &&
        !isCancelOrClose(item.el)
    ) ||
    ranked.find(
      (item) => !prevLower.includes(item.el.id.toLowerCase()) && !isCancelOrClose(item.el)
    );

  if (freshMatch) {
    const el = freshMatch.el;
    if (el.sensitive) {
      return finalize({
        action: 'point_and_wait',
        targetId: el.id,
        tip: `Review and click "${el.label || el.id}" manually.`,
      });
    }
    if (isInputLikeElement(el)) {
      return finalize({
        action: 'point_and_wait',
        targetId: el.id,
        tip: `Type in "${el.label || el.id}", then press Next.`,
      });
    }
    return finalize({
      action: 'click_safe',
      targetId: el.id,
      tip: `Click "${el.label || el.id}".`,
    });
  }

  // Fallback to next unfilled non-search input if user is already midway through a form
  if (unfilledInput) {
    return finalize({
      action: 'point_and_wait',
      targetId: unfilledInput.id,
      tip: `Fill "${unfilledInput.label || unfilledInput.id}", then click Next.`,
    });
  }

  // If Step 1 had a generic request (e.g. clicking "Guide Me" with empty input), highlight a main action on screen
  if (stepNumber === 1) {
    const firstAction =
      candidatePool.find(
        (el) =>
          !el.sensitive &&
          !isCancelOrClose(el) &&
          !el.id.includes('theme') &&
          !el.id.includes('aesthetic')
      ) || candidatePool[0];
    if (firstAction) {
      return finalize({
        action: 'point_and_wait',
        targetId: firstAction.id,
        tip: `Start here with "${firstAction.label || firstAction.id}".`,
      });
    }
  }

  return finalize({
    action: 'complete',
    tip: 'You are in the right place. Guide complete.',
  });
}

export function isAffirmativeReply(text: string): boolean {
  const clean = text.trim().toLowerCase().replace(/[.!?,]+$/g, '');
  return /^(?:yes|yeah|yep|yup|ya|y|sure|ok|okay|correct|true|i am|i did|registered|done|confirm|athe|അതെ)(?:\b|\s|$)/i.test(
    clean
  );
}

export function isNegativeReply(text: string): boolean {
  const clean = text.trim().toLowerCase().replace(/[.!?,]+$/g, '');
  return /^(?:no|nope|nah|n|not yet|not|never|i am not|did not|didn't|unregistered|alla|അല്ല)(?:\b|\s|$)/i.test(
    clean
  );
}

export function isCloseReply(text: string): boolean {
  const clean = text.trim().toLowerCase().replace(/[.!?,]+$/g, '');
  return /^(?:close|stop|exit|quit|done|finish|finished|cancel|dismiss|nothing|no|no\s+thanks|that'?s\s+all|bye)(?:\b|\s|$)/i.test(
    clean
  );
}

export function buildDynamicDiagnosticQuestion(params: {
  errorText: string;
  goal: string;
  currentRoute: string;
}): string {
  const errLower = params.errorText.toLowerCase();
  const goalLower = params.goal.toLowerCase();

  if (/already exists|duplicate|already registered|taken/i.test(errLower)) {
    return 'Are you trying to update an existing record rather than create a new one?';
  }

  if (
    /no student found|admission number|student id|not found|no sector manager|unregistered|not registered|account/i.test(
      errLower
    ) ||
    (/\b(student|manager|login|sign\s*in)\b/i.test(goalLower) && /incorrect|invalid|wrong|failed|error/i.test(errLower))
  ) {
    return 'Are you registered by the admin?';
  }

  if (/password|credentials|email or password/i.test(errLower)) {
    return 'Did your admin confirm or reset your login credentials?';
  }

  if (/assigned|sector/i.test(errLower)) {
    return 'Has the admin assigned your sector yet?';
  }

  if (/permission|unauthorized|forbidden|403|401/i.test(errLower)) {
    return 'Have you already been granted permission by the admin?';
  }

  if (/required|invalid|format|missing|must be/i.test(errLower)) {
    return 'Did you verify all required details with the admin?';
  }

  return 'Have you verified your details with the admin?';
}

export function resolveGuideTroubleshootingStep(params: {
  goal: string;
  currentRoute: string;
  pageErrors?: string[];
  userReply?: string;
  troubleshootingContext?: {
    errorText: string;
    questionAsked: string;
    stage: 'diagnostic' | 'follow_up_guide';
  };
}): GuideStepResponse | null {
  const { goal, currentRoute, pageErrors = [], userReply, troubleshootingContext } = params;
  const cleanReply = (userReply || '').trim();

  // Handle user reply to an active troubleshooting or follow-up question
  if (troubleshootingContext && cleanReply) {
    if (troubleshootingContext.stage === 'diagnostic') {
      if (isAffirmativeReply(cleanReply)) {
        return {
          action: 'refresh_and_retry',
          refreshApp: true,
          tip: 'Refreshing the web app now. Please try again.',
        };
      }

      if (isNegativeReply(cleanReply)) {
        const errLower = troubleshootingContext.errorText.toLowerCase();
        const advice = /student|admission|manager|account|register|credential|password|sector/i.test(
          errLower
        )
          ? 'Please contact the admin to register or verify your account.'
          : 'Please contact the admin for help resolving this issue.';
        const fullMsg = `${advice} Do you want any other guide?`;
        return {
          action: 'ask_user',
          askStage: 'follow_up_guide',
          question: fullMsg,
          tip: fullMsg,
          quickReplies: [
            { id: 'close', label: 'Close', value: 'close', variant: 'danger' },
          ],
        };
      }
    }

    if (troubleshootingContext.stage === 'follow_up_guide') {
      if (isCloseReply(cleanReply)) {
        return {
          action: 'complete',
          tip: 'Closing guide. Ask anytime if you need more help.',
        };
      }
      if (isAffirmativeReply(cleanReply)) {
        const askTopic = 'What would you like me to guide you through?';
        return {
          action: 'ask_user',
          askStage: 'follow_up_guide',
          question: askTopic,
          tip: askTopic,
          quickReplies: [
            { id: 'close', label: 'Close', value: 'close', variant: 'danger' },
          ],
        };
      }
    }
  }

  // Detect any newly visible page error when we are not already answering a question
  const firstError = pageErrors.find((e) => e.trim().length > 0)?.trim();
  if (firstError && !troubleshootingContext) {
    const question = buildDynamicDiagnosticQuestion({
      errorText: firstError,
      goal,
      currentRoute,
    });
    return {
      action: 'ask_user',
      askStage: 'diagnostic',
      question,
      tip: question,
      quickReplies: [
        { id: 'yes', label: 'Yes', value: 'yes', variant: 'primary' },
        { id: 'no', label: 'No', value: 'no', variant: 'secondary' },
      ],
    };
  }

  return null;
}
