import type { AccessScope } from '../security/scope.ts';

export type PublicQueryCategory = 'auth_help' | 'assistant_features' | 'greeting' | 'blocked';

export interface PublicQueryClassification {
  allowed: boolean;
  category: PublicQueryCategory;
}

const AUTH_ROUTE_REGEX = /^\/(?:login|signin|signup|register|auth|super-admin\/login)(?:\/|$)/i;

export function isPublicAuthRoutePath(routePath?: string): boolean {
  if (!routePath) return false;
  return AUTH_ROUTE_REGEX.test(routePath.trim());
}

export function isPublicAuthContext(
  scope?: AccessScope,
  routePath?: string,
  appState?: Record<string, unknown>
): boolean {
  if (scope?.role === 'PUBLIC') return true;
  if (appState?.role === 'public') return true;
  if (!scope && isPublicAuthRoutePath(routePath)) return true;
  if (!scope && typeof appState?.pathname === 'string' && isPublicAuthRoutePath(appState.pathname)) {
    return true;
  }
  return false;
}

const EXPLICIT_BLOCKED_WORKSPACE_REGEX =
  /\b(student|students|safwan|ameen|admission\s*(?:no|number)|sector\s*(?:total|balance|dues)|add\s+(?:rs|inr|₹|\d+)|credit\s+to|debit\s+to|record\s+deposit|post\s+batch|void\s+entry|unvoid|import\s+(?:students|managers|sectors|entries|excel|csv)|export\s+(?:data|students|report|excel|csv|pdf)|download\s+(?:report|statement|pdf|excel|csv)|pending\s+(?:fees?|dues?)|unpaid\s+students?|audit\s+logs?|create\s+(?:a\s+|new\s+)?sector|delete\s+student|edit\s+student|who\s+is\s+|how\s+much\s+(?:does|do)\s+\w+\s+owe)\b/i;

const EXPLICIT_STUDENT_OR_RECEIPT_ID_REGEX = /\bS\d{3,5}\b|\b(?:DF|OF|EF|TF)-\d+\b/i;

const GREETING_ONLY_REGEX =
  /^(?:hi|hello|hey|hai|helo|good\s+(?:morning|afternoon|evening)|namaskaram|salam|ഹലോ|നമസ്കാരം)[!.,?\s]*$/i;

const AUTH_HELP_REGEX =
  /\b(log\s*in|login|sign\s*in|signin|sign\s*up|signup|register|registration|onboard|onboarding|forgot\s*password|reset\s*password|recover\s*password|password\s*(?:help|reset)|demo\s*(?:mode|account|login|credentials?|try)?|try\s+demo|(?:create|start|open|setup|set\s+up)\s+(?:(?:a|an|my|new|your|our)\s+){0,2}(?:college|org|organization|organisation|account|workspace)|admin\s+login|manager\s+login|student\s+login|super\s*admin\s+login|how\s+to\s+(?:sign\s*in|log\s*in|sign\s*up|register|create\s+(?:(?:a|an|new)\s+)?(?:college|org|organization|organisation))|ലോഗിൻ|സൈൻ\s*ഇൻ|സൈൻ\s*അപ്പ്|രജിസ്റ്റർ|പാസ്‌വേഡ്|അക്കൗണ്ട്)\b/i;

const ASSISTANT_FEATURES_REGEX =
  /\b(ai\s*assistant|this\s*assistant|khazna\s*ai|assistant\s+features?|features?\s+of\s+(?:this\s+)?(?:ai|assistant)|what\s+(?:can|does)\s+(?:you|this\s+(?:ai|assistant)|it)\s+(?:do|offer|help)|what\s+are\s+(?:your|the)\s+(?:ai\s+)?(?:features?|capabilities)|how\s+does\s+(?:this\s+)?(?:ai|assistant)\s+work|guide\s*me\s+(?:feature|mode)|3d\s+(?:avatar|guide)|co-?browser|cursor\s+inspector|voice\s+(?:mode|input|transcription)|multimodal|malayalam\s+support|credit\s+system|how\s+(?:do\s+)?credits?\s+work|free\s+(?:vs|and|or)\s+premium|അസിസ്റ്റന്റ്|ഫീച്ചറുകൾ)\b/i;

export function classifyPublicAuthQuery(
  question: string,
  opts?: {
    hasAttachments?: boolean;
    hasContext?: boolean;
    contextText?: string;
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

  // Block any student/fee/ledger/write/export queries even on login page
  if (
    EXPLICIT_BLOCKED_WORKSPACE_REGEX.test(trimmed) ||
    EXPLICIT_STUDENT_OR_RECEIPT_ID_REGEX.test(trimmed)
  ) {
    return { allowed: false, category: 'blocked' };
  }

  if (ASSISTANT_FEATURES_REGEX.test(trimmed)) {
    return { allowed: true, category: 'assistant_features' };
  }

  if (AUTH_HELP_REGEX.test(trimmed)) {
    return { allowed: true, category: 'auth_help' };
  }

  // Allow contextual explanation strictly if user inspected a login/signup control itself
  if (
    opts?.hasContext &&
    opts.contextText &&
    /\b(sign\s*in|log\s*in|create\s*college|register|password|email|demo|portal)\b/i.test(
      opts.contextText
    )
  ) {
    return { allowed: true, category: 'auth_help' };
  }

  return { allowed: false, category: 'blocked' };
}

export function isPublicGuideGoalAllowed(goal: string, userReply?: string): boolean {
  const combined = `${goal || ''} ${userReply || ''}`.trim();
  if (!combined) return true;
  if (
    EXPLICIT_BLOCKED_WORKSPACE_REGEX.test(combined) ||
    EXPLICIT_STUDENT_OR_RECEIPT_ID_REGEX.test(combined)
  ) {
    return false;
  }
  return AUTH_HELP_REGEX.test(combined) || ASSISTANT_FEATURES_REGEX.test(combined);
}

export function buildPublicGuardRefusalMessage(lang: 'en' | 'ml'): string {
  if (lang === 'ml') {
    return (
      'സൈൻ-ഇൻ / സൈൻ-അപ്പ് പേജിൽ **ലോഗിൻ ചെയ്യുന്നതിനെക്കുറിച്ചോ**, **പുതിയ കോളേജ് (Organization) തുടങ്ങുന്നതിനെക്കുറിച്ചോ**, അല്ലെങ്കിൽ **ഈ AI അസിസ്റ്റന്റിന്റെ ഫീച്ചറുകളെക്കുറിച്ചോ** മാത്രമേ എനിക്ക് സഹായിക്കാൻ കഴിയൂ.\n\n' +
      'വിദ്യാർത്ഥികളുടെ വിവരങ്ങൾ, ഫീസ് കണക്കുകൾ, റിപ്പോർട്ടുകൾ, അല്ലെങ്കിൽ മറ്റ് കാര്യങ്ങൾക്കായി ദയവായി നിങ്ങളുടെ അക്കൗണ്ടിൽ **ലോഗിൻ (Sign In)** ചെയ്യുക അല്ലെങ്കിൽ പുതിയൊരു **Organization ക്രിയേറ്റ് (Create College)** ചെയ്യുക.'
    );
  }
  return (
    'On the Sign-In and Sign-Up page, I can only help with **logging in**, **creating an organization**, **password recovery**, or questions about **this AI Assistant and its features**.\n\n' +
    'Please **sign in** to your account or **create an organization** (via the Create College tab) to access campus data, ledgers, exports, or other questions.'
  );
}

export function buildOfflinePublicReply(
  category: Exclude<PublicQueryCategory, 'blocked'>,
  question: string,
  lang: 'en' | 'ml'
): string {
  if (category === 'greeting') {
    if (lang === 'ml') {
      return (
        'ഹലോ! സൈൻ-ഇൻ പേജിലേക്ക് സ്വാഗതം. താങ്കൾക്ക് **ലോഗിൻ** ചെയ്യുന്നതിനോ, പുതിയൊരു **കോളേജ് (Organization)** തുടങ്ങുന്നതിനോ, അല്ലെങ്കിൽ **ഈ AI അസിസ്റ്റന്റിന്റെ ഫീച്ചറുകൾ** അറിയുന്നതിനോ എന്നോട് ചോദിക്കാം.'
      );
    }
    return (
      'Hi! I can help you **sign in**, **create a new organization (college account)**, recover a password, or explain **what this AI Assistant can do**.'
    );
  }

  if (category === 'assistant_features') {
    if (lang === 'ml') {
      return [
        '**ഖസ്ന AI അസിസ്റ്റന്റിന്റെ പ്രധാന ഫീച്ചറുകൾ:**',
        '- **സ്മാർട്ട് ലെഡ്ജർ ചോദ്യങ്ങൾ:** ഇംഗ്ലീഷിലും മലയാളത്തിലും വിദ്യാർത്ഥികളുടെ ഫീസ് ബാക്കി, സെക്ടർ കണക്കുകൾ, രസീതുകൾ എന്നിവ പരിശോധിക്കാം.',
        '- **ഇന്ററാക്ടീവ് 3D ഗൈഡ് ("Guide Me"):** ഓരോ സ്റ്റെപ്പും സ്ക്രീനിൽ ചൂണ്ടിക്കാണിച്ചു തരുന്ന 3D അസിസ്റ്റന്റ്.',
        '- **ഫയൽ & സ്ക്രീൻഷോട്ട് അപ്‌ലോഡ്:** ലോഗിൻ ചെയ്ത ശേഷം Excel/CSV, PDF, DOCX, രസീത് ചിത്രങ്ങൾ എന്നിവ പരിശോധിക്കാം.',
        '- **റിപ്പോർട്ട് എക്സ്പോർട്ട്:** Excel (.xlsx), PDF, CSV, Word (.docx), JSON ഫയലുകളായി റിപ്പോർട്ടുകൾ ഡൗൺലോഡ് ചെയ്യാം.',
        '- **ക്രെഡിറ്റ് പ്ലാനുകൾ:** Free പ്ലാനിൽ അഡ്മിന് മാസം 100 ക്രെഡിറ്റും, Premium പ്ലാനിൽ എല്ലാ റോളുകൾക്കും പരിധിയില്ലാത്ത ഉപയോഗവും ലഭിക്കും.',
        '',
        'തുടങ്ങുന്നതിനായി ദയവായി **ലോഗിൻ** ചെയ്യുക അല്ലെങ്കിൽ പുതിയ **Organization** നിർമ്മിക്കുക.',
      ].join('\n');
    }
    return [
      '**What Khazna AI Assistant Can Do:**',
      '- **Role-Scoped Answers & Ledger Actions**: Query balances, pending dues, receipts, and post entries in **English or Malayalam** once signed in.',
      '- **Interactive 3D Co-Browser Guide**: Ask *"Guide me to…"* for step-by-step on-screen pointer and 3D avatar walkthroughs.',
      '- **Multimodal Uploads & Smart Excel Import**: Inspect screenshots, receipt photos, PDFs, DOCX, and multi-sheet `.xlsx`/`.csv` files with row-by-row validation.',
      '- **Multi-Format Exports**: Generate downloadable reports in **Excel (.xlsx)**, **PDF**, **CSV**, **Word (.docx)**, **JSON**, and **TXT**.',
      '- **Voice Input & Cursor Inspector**: Speak via microphone or point at UI elements for instant explanations.',
      '- **Organization Credits & Plans**: **Free** includes 100 monthly credits for the Admin; **Premium** unlocks unlimited credits for Admin, Sector Managers, staff, and Students.',
      '',
      'To use these workspace features, please **sign in** or **create an organization** from the login tabs.',
    ].join('\n');
  }

  // auth_help
  const q = question.toLowerCase();
  if (/create|register|sign\s*up|signup|organization|organisation|college/i.test(q)) {
    return lang === 'ml'
      ? [
          '**പുതിയ Organization (കോളേജ്) തുടങ്ങുന്ന വിധം:**',
          '1. ലോഗിൻ പേജിലെ **Create College** ടാബ് തിരഞ്ഞെടുക്കുക.',
          '2. കോളേജിന്റെ പേര്, അഡ്മിൻ പേര്, ഇമെയിൽ, പാസ്‌വേഡ് എന്നിവ നൽകുക.',
          '3. സബ്മിറ്റ് ചെയ്യുന്നതോടെ നിങ്ങളുടെ പുതിയ ഓർഗനൈസേഷൻ ഡാഷ്‌ബോർഡ് തുറക്കും.',
        ].join('\n')
      : [
          '**How to Create a New Organization (Sign Up):**',
          '1. Switch to the **Create College** tab on this page.',
          '2. Enter your **College / Organization Name**, **Admin Name**, **Email**, and **Password**.',
          '3. Click **Create College** to launch your new Admin workspace.',
          '',
          'Source: ai-assistant-features.md — Logging In & Creating an Organization',
        ].join('\n');
  }

  if (/password|forgot|reset/i.test(q)) {
    return lang === 'ml'
      ? 'പാസ്‌വേഡ് റീസെറ്റ് ചെയ്യാൻ ലോഗിൻ ഫോമിലെ **Forgot Password?** ക്ലിക്ക് ചെയ്യുക, അല്ലെങ്കിൽ നിങ്ങളുടെ കോളേജ് അഡ്മിനുമായി ബന്ധപ്പെടുക.'
      : 'To reset your password, click **Forgot Password?** on the Sign In form or ask your organization Admin to reset your credentials.\n\nSource: ai-assistant-features.md — Logging In & Creating an Organization';
  }

  if (/demo/i.test(q)) {
    return [
      '**Try the Demo Workspace:**',
      '- Use the **Quick Demo** role cards on `/login` for **College Admin** (`/admin`), **Dept Fiqh Sector Manager** (`/m/dept-fiqh`), or **Student** (`/app`).',
      '- Or click **Guide me to log in** if you want a step-by-step on-screen walkthrough.',
      '',
      'Source: onboarding-demo.md — Demo Credentials & Quick Try Demo',
    ].join('\n');
  }

  return lang === 'ml'
    ? [
        '**ലോഗിൻ ചെയ്യുന്ന വിധം:**',
        '1. **Sign In** ടാബിൽ നിങ്ങളുടെ ഇമെയിലും പാസ്‌വേഡും നൽകി ലോഗിൻ ചെയ്യുക (അല്ലെങ്കിൽ Demo കാർഡുകൾ ഉപയോഗിക്കുക).',
        '2. പുതിയ കോളേജ് തുടങ്ങാൻ **Create College** ടാബ് ഉപയോഗിക്കുക.',
        '3. പ്ലാറ്റ്‌ഫോം സൂപ്പർ അഡ്മിൻ ലോഗിനിനായി `/super-admin/login` സന്ദർശിക്കുക.',
      ].join('\n')
    : [
        '**How to Sign In or Get Started:**',
        '1. **Sign In**: Enter your institutional email and password on the **Sign In** tab (or select a **Demo** role card to explore right away).',
        '2. **Create an Organization**: Click **Create College** to register a new organization as Admin.',
        '3. Need a walkthrough? Ask **"Guide me to log in"** or **"Guide me to register my college"**.',
        '',
        'Source: ai-assistant-features.md — Logging In & Creating an Organization',
      ].join('\n');
}
