import type { ScopeGuardConfig } from '../entityRegistry.ts';
import type { AccessScope } from './scope.ts';

export type PublicQueryCategory = 'auth_help' | 'assistant_features' | 'greeting' | 'blocked';

export interface PublicQueryClassification {
  allowed: boolean;
  category: PublicQueryCategory;
}

export interface PublicGuardPolicy {
  appName?: string;
  scopeGuard?: ScopeGuardConfig;
  blockedPattern?: RegExp;
  recordIdPattern?: RegExp;
  authRoutePattern?: RegExp;
  customReplyBuilder?: (
    category: Exclude<PublicQueryCategory, 'blocked'>,
    question: string,
    lang: 'en' | 'ml'
  ) => string | null | undefined;
  customRefusalMessage?: (lang: 'en' | 'ml') => string | null | undefined;
}

const DEFAULT_AUTH_ROUTE_REGEX = /^\/(?:login|signin|signup|register|auth|super-admin\/login)(?:\/|$)/i;

const GREETING_ONLY_REGEX =
  /^(?:hi|hello|hey|hai|helo|good\s+(?:morning|afternoon|evening)|namaskaram|salam|ഹലോ|നമസ്കാരം)[!.,?\s]*$/i;

const AUTH_HELP_REGEX =
  /\b(log\s*in|login|sign\s*in|signin|sign\s*up|signup|register|registration|onboard|onboarding|forgot\s*password|reset\s*password|recover\s*password|auth\s*(?:help|reset)|demo\s*(?:mode|account|login|credentials?|try)?|try\s+demo|(?:create|start|open|setup|set\s+up)\s+(?:(?:a|an|my|new|your|our)\s+){0,2}(?:org|organization|organisation|account|workspace)|how\s+to\s+(?:sign\s*in|log\s*in|sign\s*up|register|create\s+(?:(?:a|an|new)\s+)?(?:org|organization|organisation))|ലോഗിൻ|സൈൻ\s*ഇൻ|സൈൻ\s*അപ്പ്|രജിസ്റ്റർ|പാസ്‌വേഡ്|അക്കൗണ്ട്)\b/i;

const ASSISTANT_FEATURES_REGEX =
  /\b(ai\s*assistant|this\s*assistant|assistant\s+features?|features?\s+of\s+(?:this\s+)?(?:ai|assistant)|what\s+(?:can|does)\s+(?:you|this\s+(?:ai|assistant)|it)\s+(?:do|offer|help)|what\s+are\s+(?:your|the)\s+(?:ai\s+)?(?:features?|capabilities)|how\s+does\s+(?:this\s+)?(?:ai|assistant)\s+work|guide\s*me\s+(?:feature|mode)|3d\s+(?:avatar|guide)|co-?browser|cursor\s+inspector|voice\s+(?:mode|input|transcription)|multimodal|malayalam\s+support|credit\s+system|how\s+(?:do\s+)?credits?\s+work|free\s+(?:vs|and|or)\s+premium|അസിസ്റ്റന്റ്|ഫീച്ചറുകൾ)\b/i;

const DEFAULT_BLOCKED_WORKSPACE_REGEX =
  /\b(export\s+(?:data|report|excel|csv|pdf)|import\s+(?:data|excel|csv)|audit\s+logs?|who\s+is\s+|delete\s+record)\b/i;

export function isPublicAuthRoutePath(routePath?: string, pattern?: RegExp): boolean {
  if (!routePath) return false;
  return (pattern || DEFAULT_AUTH_ROUTE_REGEX).test(routePath.trim());
}

export function isPublicAuthContext(
  scope?: AccessScope,
  routePath?: string,
  appState?: Record<string, unknown>,
  policy?: PublicGuardPolicy
): boolean {
  if (scope?.canonicalRole === 'PUBLIC' || String(scope?.role || '').toUpperCase() === 'PUBLIC') return true;
  if (appState?.role === 'public') return true;
  if (!scope && isPublicAuthRoutePath(routePath, policy?.authRoutePattern)) return true;
  if (
    !scope &&
    typeof appState?.pathname === 'string' &&
    isPublicAuthRoutePath(appState.pathname, policy?.authRoutePattern)
  ) {
    return true;
  }
  return false;
}

function matchesBlockedKeywords(question: string, policy?: PublicGuardPolicy): boolean {
  if (policy?.blockedPattern && policy.blockedPattern.test(question)) return true;
  if (policy?.recordIdPattern && policy.recordIdPattern.test(question)) return true;
  if (DEFAULT_BLOCKED_WORKSPACE_REGEX.test(question)) return true;

  const keywords = policy?.scopeGuard?.publicBlockedKeywords || [];
  if (keywords.length > 0) {
    const lower = question.toLowerCase();
    for (const kw of keywords) {
      const clean = kw.trim().toLowerCase();
      if (!clean) continue;
      if (lower.includes(clean)) return true;
    }
  }
  return false;
}

export function classifyPublicAuthQuery(
  question: string,
  opts?: {
    hasAttachments?: boolean;
    hasContext?: boolean;
    contextText?: string;
    policy?: PublicGuardPolicy;
  }
): PublicQueryClassification {
  const trimmed = (question || '').trim();

  if (opts?.hasAttachments) {
    return { allowed: false, category: 'blocked' };
  }
  if (!trimmed) {
    return { allowed: true, category: 'greeting' };
  }
  if (GREETING_ONLY_REGEX.test(trimmed)) {
    return { allowed: true, category: 'greeting' };
  }
  if (matchesBlockedKeywords(trimmed, opts?.policy)) {
    return { allowed: false, category: 'blocked' };
  }
  if (ASSISTANT_FEATURES_REGEX.test(trimmed)) {
    return { allowed: true, category: 'assistant_features' };
  }
  if (AUTH_HELP_REGEX.test(trimmed)) {
    return { allowed: true, category: 'auth_help' };
  }
  if (
    opts?.hasContext &&
    opts.contextText &&
    /\b(sign\s*in|log\s*in|create|register|email|demo|portal)\b/i.test(opts.contextText)
  ) {
    return { allowed: true, category: 'auth_help' };
  }
  return { allowed: false, category: 'blocked' };
}

export function isPublicGuideGoalAllowed(
  goal: string,
  userReply?: string,
  policy?: PublicGuardPolicy
): boolean {
  const combined = `${goal || ''} ${userReply || ''}`.trim();
  if (!combined) return true;
  if (matchesBlockedKeywords(combined, policy)) {
    return false;
  }
  return AUTH_HELP_REGEX.test(combined) || ASSISTANT_FEATURES_REGEX.test(combined);
}

export function buildPublicGuardRefusalMessage(lang: 'en' | 'ml', policy?: PublicGuardPolicy): string {
  const custom = policy?.customRefusalMessage?.(lang);
  if (custom) return custom;

  if (lang === 'ml') {
    return (
      'സൈൻ-ഇൻ / സൈൻ-അപ്പ് പേജിൽ **ലോഗിൻ ചെയ്യുന്നതിനെക്കുറിച്ചോ**, **പുതിയ അക്കൗണ്ട് തുടങ്ങുന്നതിനെക്കുറിച്ചോ**, അല്ലെങ്കിൽ **ഈ AI അസിസ്റ്റന്റിന്റെ ഫീച്ചറുകളെക്കുറിച്ചോ** മാത്രമേ എനിക്ക് സഹായിക്കാൻ കഴിയൂ.\n\n' +
      'ആപ്പിനുള്ളിലെ വിവരങ്ങൾക്കും റിപ്പോർട്ടുകൾക്കുമായി ദയവായി നിങ്ങളുടെ അക്കൗണ്ടിൽ **ലോഗിൻ (Sign In)** ചെയ്യുക.'
    );
  }
  return (
    policy?.scopeGuard?.offTopicRefusal ||
    'On the Sign-In and Sign-Up page, I can only help with **logging in**, **creating an organization**, **account recovery**, or questions about **this AI Assistant and its features**. Please **sign in** to access workspace data, reports, and tools.'
  );
}

export function buildOfflinePublicReply(
  category: Exclude<PublicQueryCategory, 'blocked'>,
  question: string,
  lang: 'en' | 'ml',
  policy?: PublicGuardPolicy
): string {
  const custom = policy?.customReplyBuilder?.(category, question, lang);
  if (custom) return custom;

  const appName = policy?.appName || 'this application';

  if (category === 'greeting') {
    if (lang === 'ml') {
      return `ഹലോ! **${appName}** സൈൻ-ഇൻ പേജിലേക്ക് സ്വാഗതം. ലോഗിൻ ചെയ്യുന്നതിനോ ഈ AI അസിസ്റ്റന്റിന്റെ ഫീച്ചറുകൾ അറിയുന്നതിനോ എന്നോട് ചോദിക്കാം.`;
    }
    return `Hi! I can help you **sign in**, **create an account**, or explain **what the ${appName} AI Assistant can do**.`;
  }

  if (category === 'assistant_features') {
    return lang === 'ml'
      ? [
          `**${appName} AI അസിസ്റ്റന്റിന്റെ പ്രധാന ഫീച്ചറുകൾ:**`,
          '- **റോൾ-അടിസ്ഥാനമാക്കിയുള്ള ഉത്തരങ്ങൾ:** ഇംഗ്ലീഷിലും മലയാളത്തിലും തത്സമയ വിവരങ്ങൾ പരിശോധിക്കാം.',
          '- **ഇന്ററാക്ടീവ് 3D ഗൈഡ് ("Guide Me"):** ഓരോ സ്റ്റെപ്പും സ്ക്രീനിൽ ചൂണ്ടിക്കാണിച്ചു തരുന്ന 3D അസിസ്റ്റന്റ്.',
          '- **ഫയൽ & സ്ക്രീൻഷോട്ട് അപ്‌ലോഡ്:** Excel/CSV, PDF, DOCX, ചിത്രങ്ങൾ എന്നിവ വിശകലനം ചെയ്യാം.',
          '- **റിപ്പോർട്ട് എക്സ്പോർട്ട്:** Excel (.xlsx), PDF, CSV, Word (.docx) ഫയലുകളായി റിപ്പോർട്ടുകൾ ഡൗൺലോഡ് ചെയ്യാം.',
          '- **ക്രെഡിറ്റ് പ്ലാനുകൾ:** Free പ്ലാനിൽ അഡ്മിന് മാസം 100 ക്രെഡിറ്റും, Premium പ്ലാനിൽ പരിധിയില്ലാത്ത ഉപയോഗവും ലഭിക്കും.',
        ].join('\n')
      : [
          `**What ${appName} AI Assistant Can Do:**`,
          '- **Role-Scoped Answers & Actions**: Query live records and run permitted workflows in **English or Malayalam** once signed in.',
          '- **Interactive 3D Co-Browser Guide**: Ask *"Guide me to…"* for step-by-step on-screen pointer and 3D avatar walkthroughs.',
          '- **Multimodal Uploads & Smart Import**: Inspect screenshots, PDFs, DOCX, and `.xlsx`/`.csv` spreadsheets with validation.',
          '- **Multi-Format Exports**: Generate downloadable reports in **Excel (.xlsx)**, **PDF**, **CSV**, and **Word (.docx)**.',
          '- **Credits & Plans**: **Free** includes 100 monthly credits for the Admin; **Premium** unlocks unlimited credits for the whole organization.',
        ].join('\n');
  }

  return lang === 'ml'
    ? 'ലോഗിൻ ചെയ്യുന്നതിനായി നിങ്ങളുടെ അക്കൗണ്ട് വിവരങ്ങൾ നൽകുക, അല്ലെങ്കിൽ **"Guide me to log in"** എന്ന് ചോദിക്കുക.'
    : `To get started in ${appName}, sign in on the portal form, create a new organization, or ask **"Guide me to log in"** for a step-by-step walkthrough.`;
}
