import type { ChatAttachment, RightClickContext } from '@ai-assistant/core';
import type { ToolDefinition } from '../tools/types.ts';
import { getConversationFocus } from '../db/scopedDataRepository.ts';
import type { AccessScope } from '../security/scope.ts';

export function shouldUseAgentLoop(
  question: string,
  toolsCountOrProfile: number | { tools: string[]; customTools?: unknown[] },
  attachments: ChatAttachment[] = []
): boolean {
  const hasTools =
    typeof toolsCountOrProfile === 'number'
      ? toolsCountOrProfile > 0
      : toolsCountOrProfile.tools.length > 0 || (toolsCountOrProfile.customTools || []).length > 0;

  if (!hasTools) return false;
  if (attachments.some((a) => a.type === 'file')) return true;

  const lower = question.trim().toLowerCase();
  const hasGuideTools =
    typeof toolsCountOrProfile !== 'number' &&
    (toolsCountOrProfile.tools.includes('search_guides') ||
      toolsCountOrProfile.tools.includes('start_guide'));

  const isGuideQuestion =
    /\b(guide\s+me|walkthrough|walk\s+me\s+through|step[\s-]by[\s-]step|show\s+me\s+how|how\s+(?:do|can|to)\s+i|how\s+to)\b/i.test(
      lower
    ) || /(?:ഗൈഡ്|സഹായിക്കുക|എങ്ങനെ)/.test(question);

  if (hasGuideTools && isGuideQuestion) {
    return true;
  }

  // Entity / person / item / status / location queries MUST use tool-calling first
  if (
    /\b(who\s+is|who's|who\s+are|where\s+is|tell\s+me\s+about|how\s+much\s+(?:does|do)\s+.+\s+owe|on\s+leave)\b/i.test(
      lower
    )
  ) {
    return true;
  }

  if (
    /^(how\s+(do|can|to)|what\s+(is|are|does|do|columns|files)|why\s+(did|does|is)|explain|describe)\b/i.test(lower) &&
    !/\b(owe|due|dues|my balance|my fees?|how much.*(owe|pay|due|pending)|dept-[a-z0-9_-]+|budget and balance|applied sciences|engineering|commerce|audit|signator|issued report|notice|batch|organization|platform|defaulter|his|her|their|net\s+worth|highest|lowest|top\s+\d+)\b/i.test(
      lower
    ) &&
    !/'s\s+(?:balance|dues|fees?|phone|email|class|department|role|status|location|shelf|record|id|leave)\b/i.test(lower)
  ) {
    return false;
  }
  if (/^can\s+i\b/i.test(lower) && !/\b(create|add|download|export|get|have|see|open|update|compare)\b/i.test(lower)) {
    return false;
  }

  const actionVerbRegex =
    /\b(create|add|enroll|enrol|register|insert|import|list|show|give|tell|get|view|fetch|find|search|filter|check|lookup|look\s+up|clear|open|switch|go\s+to|navigate|log\s*out|logout|sign\s*out|signout|session|section|borrow|checkout|check\s+out|issue|lend|return|mark|unmark|unpay|revert|pay|paid|pending|settle|collect|dues|owe|approve|click|do\s+this|do\s+it\s+for\s+me|run|execute|please\s+make|post|void|unvoid|restore|cancel|deposit|credit|debit|charge|batch|batches|dark|light|demo|domo|model|try|download|export|print|pdf|excel|xlsx|xls|csv|word|docx|doc|json|txt|sheet|spreadsheet|same\s+as|this\s+list|this\s+data|given\s+data|pages|numbers|odt|rtf|xml|edit|update|rename|remove|delete|invite|assign|revoke|extend|toggle|form|account|stable|status|state|ledger|signup|sign\s*up|college|campus|display|report|reports|overview|summary|summarize|balance|net\s+worth|minus|negative|positive|sort|order\s+by|highest|lowest|top\s+\d+|only|include|too|above|below|greater|less|under|over|bulk|upload|phone|notice|notices|notifications|workspace|audit|signatory|signatories|issued|organization|organizations|platform|defaulter|defaulters|fund|funds|collection|collections|class|classes|receipt|receipts|manager|managers|user|users|student|students|teacher|teachers|principal|staff|clerk|union|book|books|shelf|shelves|isbn|leave|employee|who\s+is|where\s+is|how\s+many|guide|walkthrough|compare|comparison|versus|vs)\b/i;

  return actionVerbRegex.test(lower);
}

function cleanEntityQueryCandidate(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(
      /^(?:the\s+)?(?:student|teacher|usthad|professor|prof\.?|principal|sector\s+manager|union\s+manager|union\s+member|office\s+staff|office\s+admin|staff\s+member|staff|clerk|manager|employee|book|titled|called|named|shelf|leave\s+request(?:\s+for)?)\s+/i,
      ''
    )
    .replace(/^(?:the|a|an|mr\.?|ms\.?|mrs\.?|dr\.?)\s+/i, '')
    .replace(/[?.!,;:]+$/g, '')
    .trim();

  if (!cleaned || cleaned.length < 2) return null;
  if (
    /^(?:my|me|mine|his|her|their|all|students?|teachers?|principals?|staff|managers?|sectors?|classes?|books?|shelves?|loans?|notices?|reports?|audit|demo|login|campus|khazna|this|that|it|someone|anyone|defaulters?|funds?|payments?|organizations?|colleges?)$/i.test(
      cleaned
    )
  ) {
    return null;
  }
  return cleaned;
}

export function extractEntitySearchQuery(question: string): { query: string } | null {
  const q = question.trim();
  if (!q) return null;
  const lower = q.toLowerCase();

  // Do not hijack write/export/navigate/onboarding commands
  if (
    /\b(add|enroll|enrol|create|delete|remove|void|unvoid|import|upload|download|export|print|post|collect|settle|mark|open|navigate|switch\s+to|go\s+to|log\s*out|sign\s*out|guide\s+me|how\s+do\s+i|how\s+to|demo|password|credential)\b/i.test(
      lower
    ) &&
    !/^(?:who\s+is|who's|where\s+is|tell\s+me\s+about|how\s+much\s+(?:does|do)\s+.+\s+owe|is\s+.+\s+on\s+leave)\b/i.test(
      lower
    )
  ) {
    return null;
  }

  const patterns: RegExp[] = [
    /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:who\s+is|who's|who\s+are)\s+(.+?)[?.!]*$/i,
    /^(?:please\s+|can\s+you\s+|could\s+you\s+)?where\s+is\s+(.+?)[?.!]*$/i,
    /^(?:please\s+|can\s+you\s+|could\s+you\s+)?is\s+([A-Za-z][A-Za-z0-9 .'-]{1,50}?)\s+on\s+leave[?.!]*$/i,
    /^(?:please\s+|can\s+you\s+|could\s+you\s+)?how\s+much\s+(?:does|do)\s+([A-Za-z0-9 .'-]{2,50}?)\s+owe[?.!]*$/i,
    /^(?:please\s+|can\s+you\s+|could\s+you\s+)?tell\s+me\s+about\s+(.+?)[?.!]*$/i,
    /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:search(?:\s+for)?|find|look\s*up|lookup)\s+(.+?)[?.!]*$/i,
    /\b(?:details|profile|info|information|record|status|balance|dues|fees?|location|shelf)\s+(?:for|of|about)\s+([A-Za-z0-9 .'-]{2,50}?)(?=\s+(?:in|under|from|at)\s+(?:department|dept|sector|office|library)\b|\s*[?,.;!]|$)/i,
    /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:what\s+(?:is|are)\s+)?([A-Za-z][A-Za-z0-9 .'-]{1,40}?)'s\s+(?:balance|dues|fees?|phone|email|class|department|role|status|location|shelf|record|id|leave)\b/i,
  ];

  for (const re of patterns) {
    const m = re.exec(q);
    if (m?.[1]) {
      const candidate = cleanEntityQueryCandidate(m[1]);
      if (candidate) return { query: candidate };
    }
  }
  return null;
}

function detectExportFormatToken(question: string): string | undefined {
  const lower = question.toLowerCase();
  if (/\b(excel|xlsx|xls|spreadsheet|sheet|sheets)\b/i.test(lower)) return 'xlsx';
  if (/\bpdf\b/i.test(lower)) return 'pdf';
  if (/\bcsv\b/i.test(lower)) return 'csv';
  if (/\b(word|docx|ms\s*word)\b/i.test(lower)) return 'docx';
  if (/\bjson\b/i.test(lower)) return 'json';
  if (/\b(plain\s*text|txt)\b/i.test(lower)) return 'txt';

  const unsupportedM = /\b(?:as|to|in)\s+(?:an?\s+)?(?:apple\s+)?(pages|numbers|odt|rtf|xml|yaml|yml|tsv|ods)\b/i.exec(
    lower
  );
  if (unsupportedM) return unsupportedM[1];
  return undefined;
}

function extractRequestedExportColumns(question: string): string[] | undefined {
  const colMatch =
    /\b(?:with\s+)?(?:only\s+(?:columns?|fields?)?\s*|columns?\s*[:=]?\s*|fields?\s*[:=]?\s*)([a-z0-9_.,&\s'-]{2,90}?)(?=\s+(?:as|in|to|from|for|where|with|into)\b|\s*[?.!]|$)/i.exec(
      question
    );
  if (!colMatch?.[1]) return undefined;

  const raw = colMatch[1]
    .replace(/\b(?:columns?|fields?|only|please|the|their)\b/gi, ' ')
    .trim();
  const cols = raw
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map((s) => s.trim().replace(/[?.!;]+$/, ''))
    .filter((s) => s.length >= 2 && !/^(excel|xlsx|pdf|csv|word|docx|json|txt)$/i.test(s));

  return cols.length > 0 ? cols : undefined;
}

export function extractExportToolCall(question: string): { name: 'export_data'; args: Record<string, unknown> } | null {
  const lower = question.toLowerCase().trim();

  // Never intercept upload templates ("download students CSV template") or guide questions
  if (/\btemplate\b/i.test(lower)) return null;
  if (/\b(how\s+(?:do|can|to)\s+i|how\s+to|guide\s+me|walkthrough|show\s+me\s+how)\b/i.test(lower)) {
    return null;
  }

  const detectedFormat = detectExportFormatToken(question);
  const isFollowUpPhrase =
    /\b(same\s+(?:as|in|to)|this\s+(?:list|data|table|result|report)|that\s+(?:list|data|table|result|report)|(?:this|the)\s+given\s+data|given\s+data|above\s+(?:list|data|table|results?)|previous\s+(?:list|data|result)|export\s+(?:it|this|that|above)|download\s+(?:it|this|that|above)|convert\s+(?:it|this|that)|now\s+as|also\s+as)\b/i.test(
      lower
    ) ||
    /^(?:as\s+)?(?:excel|xlsx|pdf|csv|word|docx|json|txt|pages|numbers|xml|odt|rtf)(?:\s+file)?$/i.test(
      lower.replace(/[?.!]+$/, '').trim()
    );

  if (isFollowUpPhrase && (detectedFormat || /\b(export|download)\b/i.test(lower))) {
    const columns = extractRequestedExportColumns(question);
    return {
      name: 'export_data',
      args: {
        usePrevious: true,
        ...(detectedFormat ? { format: detectedFormat } : {}),
        ...(columns ? { columns } : {}),
      },
    };
  }

  const hasExplicitExportVerb = /\b(export|download|generate\s+(?:an?\s+)?(?:excel|pdf|csv|word|docx|json|file)|save\s+as)\b/i.test(
    lower
  );
  const hasGiveMeListVerb =
    /\b(?:give\s+me|get\s+me|pull|extract|prepare)\b.*\b(all|students?|teachers?|principals?|managers?|staff|union|sectors?|books?|shelves?|leave(?:\s+requests?)?|list|report|defaulters?)\b/i.test(
      lower
    );

  if (!hasExplicitExportVerb && !(hasGiveMeListVerb && (detectedFormat || /\b(give\s+me\s+all|all\s+[a-z0-9 ]+\s+students?)\b/i.test(lower)))) {
    return null;
  }

  // Detect entityType app-agnostically
  let entityType: string | undefined;
  if (/\b(leave\s+requests?|leaves?|employees?\s+on\s+leave)\b/i.test(lower)) entityType = 'leave_request';
  else if (/\bbooks?\b/i.test(lower)) entityType = 'book';
  else if (/\bshelves?|shelf\b/i.test(lower)) entityType = 'shelf';
  else if (/\bteachers?|faculty\b/i.test(lower)) entityType = 'teacher';
  else if (/\bprincipals?\b/i.test(lower)) entityType = 'principal';
  else if (/\bsector\s+managers?|managers?\b/i.test(lower)) entityType = 'sector_manager';
  else if (/\boffice\s+staff\b/i.test(lower)) entityType = 'office_staff';
  else if (/\bunion\s+(?:members?|managers?)\b/i.test(lower)) entityType = 'union_member';
  else if (/\bsectors?\b/i.test(lower) && !/\bin\s+(?:my\s+)?sector\b/i.test(lower)) entityType = 'sector';
  else if (/\b(students?|class\s+report|statement|defaulters?|dues|pending\s+fees?)\b/i.test(lower)) {
    entityType = 'student';
  }

  // Extract filters (className, sector/department, status, leaveType)
  const filters: Record<string, string | number | boolean> = {};
  const classMatch =
    /\b((?:fiqh|thanawiyya|civil|eng|cs|sci)\s*\d+|hifz)\b/i.exec(question);
  if (classMatch) {
    filters.className = classMatch[1].replace(/\s+/g, ' ').trim();
  }

  const sectorMatch =
    /\b(dept-[a-z0-9_-]+|ihsan-union|velitcham-welfare)\b/i.exec(question) ||
    /\b(?:in|for|under)\s+(?:sector|dept|department)\s+([a-z0-9_-]+)/i.exec(question);
  if (sectorMatch) {
    filters.sectorId = sectorMatch[1].trim();
  }

  const deptMatch = /\bdepartment\s+(?:of\s+)?([A-Za-z][A-Za-z &-]{2,30}?)(?=\s+(?:with|as|in|only)\b|\s*[?.!]|$)/i.exec(
    question
  );
  if (deptMatch && entityType === 'leave_request') {
    filters.department = deptMatch[1].trim();
  }

  const statusMatch = /\b(available|checked\s*out|borrowed|approved|pending|rejected)\b/i.exec(lower);
  if (statusMatch && entityType && entityType !== 'student') {
    filters.status = statusMatch[1].trim();
  }

  const pendingOnly = /\b(pending\s*(?:fee|fees|dues?)?|unpaid|defaulters?|owing|with\s+dues?)\b/i.test(lower);
  const columns = extractRequestedExportColumns(question);
  const isPersonalStatement = /\bmy\s+(?:own\s+)?(?:fee\s+)?(?:statement|record|summary)\b/i.test(lower);
  const bulkRequest = !isPersonalStatement;

  return {
    name: 'export_data',
    args: {
      ...(entityType ? { entityType } : {}),
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      ...(pendingOnly ? { pendingOnly: true } : {}),
      ...(columns ? { columns } : {}),
      ...(detectedFormat ? { format: detectedFormat } : {}),
      bulkRequest,
    },
  };
}

export interface ParsedQueryIntent {
  entityType?: string;
  filters?: Record<string, string | number | boolean>;
  numericFilters?: Array<{ field: string; op: '<' | '<=' | '>' | '>=' | '=' | '!='; value: number }>;
  pendingOnly?: boolean;
  sort?: { field: string; dir: 'asc' | 'desc' };
  limit?: number;
  columns?: string[];
  addColumns?: string[];
  removeColumns?: string[];
  title?: string;
  assumption?: string;
  usePrevious?: boolean;
}

export function parseQueryIntent(question: string): ParsedQueryIntent | null {
  const q = question.trim();
  const lower = q.toLowerCase();
  if (!q) return null;

  // Never intercept templates, guides, write actions, navigation, or explicit file export phrases handled by export_data
  if (
    /\b(template|guide\s+me|walkthrough|how\s+do\s+i|how\s+to|add\s+student|create\s+sector|void|unvoid|mark\s+.+\s+paid|collect|deposit|post\s+batch|open\s+|switch\s+to|go\s+to|log\s*out)\b/i.test(
      lower
    )
  ) {
    return null;
  }

  // Let explicit file download/export phrases route to export_data unless it's a view mutation
  if (/\b(export|download|generate\s+.*\b(?:pdf|excel|xlsx|csv|word|docx|json)\b)\b/i.test(lower)) {
    return null;
  }

  const classMatch = /\b((?:fiqh|thanawiyya|civil|eng|cs|sci)\s*\d+|hifz)\b/i.exec(q);
  const sectorMatch =
    /\b(dept-[a-z0-9_-]+|ihsan-union|velitcham-welfare)\b/i.exec(q) ||
    /\b(?:in|for|under|only)\s+(?:sector|dept|department)\s+([a-z0-9_-]+)/i.exec(q);

  const includeDebitCredit =
    /\b(debit\s+and\s+credit|credit\s+and\s+debit|debit.*credit.*too|credit.*debit.*too|billed\s+and\s+paid|all\s+financial\s+columns)\b/i.test(
      lower
    );
  const wantPhone = /\b(phone|mobile|contact(?:\s+number)?)\b/i.test(lower);
  const wantEmail = /\b(email|mail)\b/i.test(lower);
  const wantGuardian = /\b(guardian|parent|father)\b/i.test(lower);

  const sortDueHigh = /\b(?:sort(?:\s+by)?|order(?:\s+by)?)\s+(?:highest|most|top|largest|desc)?\s*(?:pending\s*)?(?:dues?|owed|pending(?:\s+fee)?|balance)|highest\s+(?:pending\s+)?dues?\s+first\b/i.test(
    lower
  );
  const sortDueLow = /\b(?:sort(?:\s+by)?|order(?:\s+by)?)\s+(?:lowest|least|smallest|asc)\s*(?:pending\s*)?(?:dues?|owed|balance)\b/i.test(
    lower
  );
  const sortNameAsc = /\b(?:sort(?:\s+by)?|order(?:\s+by)?)\s+(?:name|alphabetical|a-z)\b/i.test(lower);
  const sort = sortDueHigh
    ? ({ field: 'pendingFee', dir: 'desc' } as const)
    : sortDueLow
      ? ({ field: 'pendingFee', dir: 'asc' } as const)
      : sortNameAsc
        ? ({ field: 'name', dir: 'asc' } as const)
        : undefined;

  const limitMatch = /\b(?:top|first|only)\s+(\d{1,3})\b/i.exec(lower);
  const limit = limitMatch ? Math.min(Number(limitMatch[1]), 100) : undefined;

  // 1. Follow-up view mutations on previous dataset ("add phone number", "only Fiqh 2", "sort by highest due", "debit and credit too")
  const isAddColumnFollowUp =
    /^(?:please\s+|can\s+you\s+|also\s+)?(?:add|include|show|with)\s+(?:the\s+|their\s+)?(?:phone(?:\s+numbers?)?|mobile|email|guardian|debit\s+and\s+credit|credit\s+and\s+debit)\b/i.test(
      lower
    ) ||
    /\b(?:debit\s+and\s+credit|credit\s+and\s+debit|phone(?:\s+number)?|email|guardian)\s+(?:too|as\s+well|also)\b/i.test(
      lower
    );

  const isRemoveColFollowUp =
    /^(?:please\s+)?(?:remove|hide|drop|without)\s+(?:the\s+)?(phone|email|guardian|class|class\s*name|debit|credit|balance|due|dues|id)\b/i.exec(
      lower
    );

  const isFilterFollowUp =
    /^(?:please\s+|show\s+|filter(?:\s+by)?\s+)?(?:only|just|filter\s+(?:by|to))\s+(?:the\s+)?(?:(fiqh\s*\d+|thanawiyya\s*\d+|civil\s*\d+|hifz)|pending|unpaid|(?:dept-[a-z0-9_-]+))\b/i.test(
      lower
    ) || /^(?:sort|order)\s+by\b/i.test(lower) || /^(?:highest|lowest)\s+(?:due|dues|balance)\s*(?:first)?$/i.test(lower);

  const isInitialNegOrStudentQuery =
    /\b(?:net\s*worth\s*(?:is\s+)?minus|minus\s+net\s*worth|negative\s+(?:net\s*worth|balance|net\s+balance)|balance\s*(?:<|below|under|less\s+than)\s*0|give\s+(?:the\s+|me\s+)?list|students?\s+with)\b/i.test(
      lower
    );

  if (
    !isInitialNegOrStudentQuery &&
    (isAddColumnFollowUp || isRemoveColFollowUp || isFilterFollowUp) &&
    !/\bwho\s+is\b/i.test(lower)
  ) {
    const addCols: string[] = [];
    if (wantPhone) addCols.push('phone');
    if (wantEmail) addCols.push('email');
    if (wantGuardian) addCols.push('guardian');
    if (includeDebitCredit) addCols.push('debitTotal', 'paidTotal');
    else if (/\bdebit\b/i.test(lower) && /\b(add|include|too|also)\b/i.test(lower)) addCols.push('debitTotal');
    else if (/\bcredit\b/i.test(lower) && /\b(add|include|too|also)\b/i.test(lower)) addCols.push('paidTotal');

    const removeCols: string[] = [];
    if (isRemoveColFollowUp?.[1]) {
      const tok = isRemoveColFollowUp[1].toLowerCase();
      if (tok === 'class' || tok === 'class name') removeCols.push('className');
      else if (tok === 'due' || tok === 'dues') removeCols.push('pendingFee');
      else if (tok === 'debit') removeCols.push('debitTotal');
      else if (tok === 'credit') removeCols.push('paidTotal');
      else removeCols.push(tok);
    }

    const filters: Record<string, string | number | boolean> = {};
    if (classMatch) filters.className = classMatch[1].replace(/\s+/g, ' ').trim();
    if (sectorMatch) filters.sectorId = sectorMatch[1].trim();

    return {
      usePrevious: true,
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      ...(sort ? { sort } : {}),
      ...(limit ? { limit } : {}),
      ...(addCols.length > 0 ? { addColumns: addCols } : {}),
      ...(removeCols.length > 0 ? { removeColumns: removeCols } : {}),
      ...(isFilterFollowUp && /\b(pending|unpaid)\b/i.test(lower) ? { pendingOnly: true } : {}),
    };
  }

  // 2. "Net worth minus" / negative balance queries -> show ONLY negative-balance students with ID, Name, Class, Due only
  const isNegNetWorth =
    /\b(?:net\s*worth\s*(?:is\s+)?minus|minus\s+net\s*worth|negative\s+(?:net\s*worth|balance|net\s+balance)|net\s*balance\s*(?:<|below|under|less\s+than)\s*0|balance\s*(?:<|below|under|less\s+than)\s*0|minus\s+balance|net\s+worth\s+negative)\b/i.test(
      lower
    );

  if (isNegNetWorth) {
    const filters: Record<string, string | number | boolean> = {};
    if (classMatch) filters.className = classMatch[1].replace(/\s+/g, ' ').trim();
    if (sectorMatch) filters.sectorId = sectorMatch[1].trim();

    const cols = ['id', 'name', 'className', 'pendingFee'];
    if (includeDebitCredit) {
      cols.push('debitTotal', 'paidTotal', 'balance');
    }
    if (wantPhone) cols.push('phone');
    if (wantEmail) cols.push('email');
    if (wantGuardian) cols.push('guardian');

    return {
      entityType: 'student',
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      numericFilters: [{ field: 'balance', op: '<', value: 0 }],
      columns: cols,
      sort: sort || { field: 'pendingFee', dir: 'desc' },
      ...(limit ? { limit } : {}),
      title: classMatch
        ? `${classMatch[1].trim()} Students with Negative Balance`
        : 'Students with Negative Balance',
      ...(includeDebitCredit
        ? {}
        : {
            assumption:
              'Interpreted "net worth minus" as negative balance (net balance < 0) and included Due only. Say "debit and credit too" if you also want billed/paid columns.',
          }),
    };
  }

  // 3. Explicit numeric comparative filters on students (e.g. "dues > 1000", "due above 500", "top 5 students with pending dues")
  const numCmpMatch =
    /\b(dues?|pending(?:\s+fees?)?|balance|credit|paid|debit|billed)\s*(?:is\s+|of\s+)?(<=|>=|<|>|=|above|over|more\s+than|greater\s+than|below|under|less\s+than|at\s+least|at\s+most)\s*[₹$]?\s*(-?\d[\d,]*)/i.exec(
      lower
    );

  const isTopDuesQuery =
    /\b(?:top\s+\d+|highest|sort\s+by\s+highest)\b/i.test(lower) &&
    /\bstudents?\b/i.test(lower) &&
    /\b(dues?|pending|unpaid|balance|defaulters?)\b/i.test(lower);

  const isSpecificStudentMetricList =
    (/\b(list|show|give|get|find|which)\b.*\bstudents?\b/i.test(lower) || /\bstudents?\s+(?:with|having)\b/i.test(lower)) &&
    (Boolean(numCmpMatch) ||
      isTopDuesQuery ||
      Boolean(limit) ||
      Boolean(sort) ||
      Boolean(extractRequestedExportColumns(question)) ||
      (Boolean(classMatch) && /\b(pending|dues?|unpaid)\b/i.test(lower)));

  if (isSpecificStudentMetricList) {
    const filters: Record<string, string | number | boolean> = {};
    if (classMatch) filters.className = classMatch[1].replace(/\s+/g, ' ').trim();
    if (sectorMatch) filters.sectorId = sectorMatch[1].trim();

    const numericFilters: Array<{ field: string; op: '<' | '<=' | '>' | '>=' | '=' | '!='; value: number }> = [];
    let metricCol = 'pendingFee';

    if (numCmpMatch) {
      const rawMetric = numCmpMatch[1];
      const rawOp = numCmpMatch[2];
      const val = Number(numCmpMatch[3].replace(/,/g, ''));
      const field =
        rawMetric.startsWith('bal')
          ? 'balance'
          : rawMetric.startsWith('cred') || rawMetric.startsWith('paid')
            ? 'paidTotal'
            : rawMetric.startsWith('deb') || rawMetric.startsWith('bill')
              ? 'debitTotal'
              : 'pendingFee';
      metricCol = field;
      let op: '<' | '<=' | '>' | '>=' | '=' = '=';
      if (rawOp === '<' || rawOp === 'below' || rawOp === 'under' || rawOp.includes('less')) op = '<';
      else if (rawOp === '<=' || rawOp.includes('most')) op = '<=';
      else if (rawOp === '>' || rawOp === 'above' || rawOp === 'over' || rawOp.includes('more') || rawOp.includes('greater')) op = '>';
      else if (rawOp === '>=' || rawOp.includes('least')) op = '>=';
      numericFilters.push({ field, op, value: val });
    }

    const pendingOnly = !numCmpMatch && /\b(pending|unpaid|dues?|owe|owing|defaulters?)\b/i.test(lower);
    const explicitCols = extractRequestedExportColumns(question);
    const cols = explicitCols
      ? explicitCols
      : Array.from(
          new Set([
            'id',
            'name',
            'className',
            metricCol,
            ...(includeDebitCredit ? ['debitTotal', 'paidTotal'] : []),
            ...(wantPhone ? ['phone'] : []),
            ...(wantEmail ? ['email'] : []),
          ])
        );

    return {
      entityType: 'student',
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      ...(numericFilters.length > 0 ? { numericFilters } : {}),
      ...(pendingOnly ? { pendingOnly: true } : {}),
      columns: cols,
      ...(sort ? { sort } : isTopDuesQuery ? { sort: { field: 'pendingFee', dir: 'desc' } } : {}),
      ...(limit ? { limit } : {}),
      title: classMatch
        ? `${classMatch[1].trim()} Students${pendingOnly ? ' with Pending Dues' : ''}`
        : pendingOnly
          ? 'Students with Pending Dues'
          : 'Filtered Students',
    };
  }

  return null;
}

function normalizeFundingOption(text: string): 'Student Fees' | 'Charity' | 'Government Grant' | 'Endowment' | undefined {
  const lower = text.toLowerCase();
  if (/\bcharity\b/.test(lower)) return 'Charity';
  if (/\b(government\s+grant|govt\s+grant|grant)\b/.test(lower)) return 'Government Grant';
  if (/\bendowment\b/.test(lower)) return 'Endowment';
  if (/\bstudent\s+fees?\b/.test(lower)) return 'Student Fees';
  return undefined;
}

function parseAddStudentArgs(question: string): Record<string, unknown> | null {
  const emailMatch = /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i.exec(question);
  const admMatch = /\b([A-Z]{2,5}-\d{4}-\d{1,6})\b/i.exec(question);
  const sectorMatch =
    /\b(?:sector(?:\s+code)?\s*(?:is|:|=)?\s*|in\s+|for\s+)([A-Z]{2,8})\b/.exec(question) ||
    /\bsector(?:\s+code)?\s*(?:is|:|=)?\s*([a-z]{2,8})\b/i.exec(question) ||
    /,\s*(ENG|SCI|COM|ART|BIO)\b/i.exec(question);
  const feeMatch =
    /\b(?:fee(?:\s+amount)?|amount|fees?)\s*(?:is|:|=|of)?\s*[₹$]?\s*(\d[\d,]*)/i.exec(question) ||
    /,\s*[₹$]?\s*(\d{4,7})\b/.exec(question);
  const unionMatch =
    /\bunion(?:\s+name)?\s*(?:is|:|=)?\s*([A-Za-z0-9 &'-]{2,40}?)(?=,|\s+(?:sector|fee|funding|email|admission)|$)/i.exec(
      question
    );
  const fundingOption = normalizeFundingOption(question);

  // Extract name after "student [named]"
  const nameStart =
    /\bstudent(?:\s+named|\s+name)?\s*[:=]?\s*(.+)$/i.exec(question) ||
    /\b(?:enroll|enrol)\s+(?!a\s+student|new\s+student)(.+)$/i.exec(question);

  if (!nameStart?.[1]) return null;

  let rawTail = nameStart[1].trim();
  // Strip known metadata tokens without truncating names that follow an admission number/email
  if (emailMatch) rawTail = rawTail.replace(emailMatch[0], ' ');
  if (admMatch) rawTail = rawTail.replace(admMatch[0], ' ');
  rawTail = rawTail
    .replace(/\b(?:with|and|having)\s+(?:email|admission(?:\s+no)?|sector(?:\s+code)?|union(?:\s+name)?|funding(?:\s+option)?|fee(?:\s+amount)?)\b.*$/i, '')
    .replace(/\b(?:email(?:\s+address)?|admission(?:\s+no)?|sector(?:\s+code)?|union(?:\s+name)?|funding(?:\s+option)?|fee(?:\s+amount)?)\b.*$/i, '')
    .replace(/^[\s,:-]+/, '')
    .replace(/,.*$/, '')
    .replace(/\s+(?:in|for)\s+(?:[A-Z]{2,8}|sector)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!rawTail || rawTail.length < 2) return null;

  const args: Record<string, unknown> = { fullName: rawTail };
  if (emailMatch) args.email = emailMatch[1];
  if (admMatch) args.admissionNo = admMatch[1].toUpperCase();
  if (sectorMatch) args.sectorCode = sectorMatch[1].toUpperCase();
  if (unionMatch) args.unionName = unionMatch[1].trim();
  if (fundingOption) args.fundingOption = fundingOption;
  if (feeMatch) {
    const num = Number(feeMatch[1].replace(/,/g, ''));
    if (!Number.isNaN(num) && num >= 0) args.feeAmount = num;
  }
  return args;
}

function parseCreateSectorArgs(question: string): Record<string, unknown> | null {
  const afterSector = /\bsector\b(?:\s+called|\s+named)?\s*[:=]?\s*(.+)$/i.exec(question);
  if (!afterSector?.[1]) return null;

  let tail = afterSector[1].trim();
  const budgetMatch =
    /\b(?:annual\s+)?budget\s*(?:is|:|=|of)?\s*[₹$]?\s*(\d[\d,]*)/i.exec(tail) ||
    /\b(\d{4,9})\s*$/.exec(tail);
  const annualBudget = budgetMatch ? Number(budgetMatch[1].replace(/,/g, '')) : undefined;
  if (budgetMatch) {
    tail = tail.replace(budgetMatch[0], '').trim();
  }

  let unionName: string | undefined;
  const unionMatch = /\bunion\s*(?:name)?\s*(?:is|:|=)?\s*([A-Za-z0-9 &'-]{2,50}?)(?=,|\s+budget|$)/i.exec(
    tail
  );
  if (unionMatch) {
    unionName = unionMatch[1].trim();
    tail = tail.replace(unionMatch[0], '').replace(/\bwith\s*$/i, '').trim();
  }

  // Handle comma-separated OR space-separated: "BIO, Biotechnology, Bio Union" or "BIO Biotechnology Bio Union"
  const parts = tail
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  let code: string | undefined;
  let name: string | undefined;

  if (parts.length >= 2) {
    code = parts[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    name = parts[1];
    if (!unionName && parts[2]) unionName = parts[2];
  } else {
    const words = tail.replace(/\bnamed\b|\bwith\b/gi, ' ').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    if (words.length >= 2 && /^[A-Za-z0-9]{2,6}$/.test(words[0]) && words[0] === words[0].toUpperCase()) {
      code = words[0].toUpperCase();
      // Check if remaining words end with "<X> Union"
      const rest = words.slice(1).join(' ');
      const trailingUnion = /^(.*?)\s+([A-Z][A-Za-z]+\s+Union)$/.exec(rest);
      if (!unionName && trailingUnion) {
        name = trailingUnion[1].trim();
        unionName = trailingUnion[2].trim();
      } else {
        name = rest;
      }
    } else {
      name = words.join(' ');
    }
  }

  if (!name || name.length < 2) return null;

  return {
    ...(code ? { code } : {}),
    name,
    ...(unionName ? { unionName } : {}),
    ...(annualBudget !== undefined && !Number.isNaN(annualBudget) ? { annualBudget } : {}),
  };
}

function parseAddFundArgs(question: string): Record<string, unknown> | null {
  const fundingType = normalizeFundingOption(question) || 'Charity';
  const amountMatch =
    /\b(?:amount|of)\s*[₹$]?\s*(\d[\d,]*)/i.exec(question) || /\b[₹$]?\s*(\d[\d,]{2,})\b/.exec(question);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : undefined;

  const sectorMatch =
    /\b(?:for|target(?:\s+sector)?|sector)\s*(?:is|:|=)?\s*(All Sectors|[A-Z]{2,8})\b/i.exec(question);
  const targetSector = sectorMatch
    ? sectorMatch[1].toLowerCase() === 'all sectors'
      ? 'All Sectors'
      : sectorMatch[1].toUpperCase()
    : undefined;

  const sourceStart = /\bfund(?:\s+source|\s+pool)?(?:\s+called|\s+named)?\s*[:=]?\s*(.+)$/i.exec(
    question
  );
  if (!sourceStart?.[1]) return null;

  let sourceName = sourceStart[1];
  if (amountMatch) sourceName = sourceName.replace(amountMatch[0], ' ');
  if (sectorMatch) sourceName = sourceName.replace(sectorMatch[0], ' ');
  sourceName = sourceName
    .replace(/\b(Charity|Government Grant|Endowment|Student Fees)\b/gi, ' ')
    .replace(/[,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sourceName || sourceName.length < 2) return null;

  return {
    sourceName,
    fundingType,
    ...(targetSector ? { targetSector } : {}),
    ...(amount && !Number.isNaN(amount) ? { amount } : {}),
  };
}

function parseAddBookArgs(question: string): Record<string, unknown> | null {
  const afterBook = /\bbook(?:\s+titled|\s+called)?\s*[:=]?\s*(.+)$/i.exec(question);
  if (!afterBook?.[1]) return null;

  let tail = afterBook[1].trim();
  const isbnMatch = /\b(?:isbn(?:-13)?\s*[:=]?\s*)?(97[89][-0-9]{9,15})\b/i.exec(tail);
  if (isbnMatch) tail = tail.replace(isbnMatch[0], ' ');

  const shelfMatch = /\bshelf\s*[:=]?\s*([A-Z]{1,4}-?\d{1,4})\b/i.exec(tail);
  if (shelfMatch) tail = tail.replace(shelfMatch[0], ' ');

  const copiesMatch =
    /\bcopies\s*[:=]?\s*(\d+)\b/i.exec(tail) || /(?<![A-Za-z0-9-])(\d+)\s+copies\b/i.exec(tail);
  if (copiesMatch) tail = tail.replace(copiesMatch[0], ' ');

  let author: string | undefined;
  const byMatch = /\bby\s+([A-Za-z][A-Za-z .'-]{1,50}?)(?=,|\s+(?:isbn|shelf|copies)|\s*$)/i.exec(tail);
  if (byMatch) {
    author = byMatch[1].trim();
    tail = tail.replace(byMatch[0], ' ');
  }

  const parts = tail
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const title = (parts[0] || tail).replace(/\s+/g, ' ').trim();
  if (!author && parts[1]) author = parts[1];
  if (!title || title.length < 2) return null;

  return {
    title,
    ...(author ? { author } : {}),
    ...(isbnMatch ? { isbn: isbnMatch[1] } : {}),
    ...(shelfMatch ? { shelf: shelfMatch[1].toUpperCase() } : {}),
    ...(copiesMatch ? { copies: Number(copiesMatch[1]) } : {}),
  };
}

function parseBorrowBookArgs(question: string): Record<string, unknown> | null {
  const bookIdMatch = /\b(bk-[a-z0-9-]+)\b/i.exec(question);
  const memberMatch = /\b(?:for|to)\s+([A-Za-z][A-Za-z .'-]{1,40})\s*$/i.exec(question);
  let titlePart = question
    .replace(/^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:borrow|check\s*out|issue|lend)\s+(?:book\s+)?/i, '')
    .trim();
  if (memberMatch) titlePart = titlePart.replace(memberMatch[0], '').trim();
  if (bookIdMatch) titlePart = titlePart.replace(bookIdMatch[0], '').trim();
  titlePart = titlePart.replace(/^["']|["']$/g, '').trim();

  if (!bookIdMatch && !titlePart) return null;
  return {
    ...(bookIdMatch ? { bookId: bookIdMatch[1] } : {}),
    ...(titlePart ? { bookTitle: titlePart } : {}),
    memberName: memberMatch?.[1]?.trim() || 'Campus Student',
  };
}

function parseReturnBookArgs(question: string): Record<string, unknown> {
  const loanIdMatch = /\b(ln-[a-z0-9-]+)\b/i.exec(question);
  let cleaned = question
    .replace(/^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:return|mark)\s+/i, '')
    .replace(/\b(?:as\s+)?returned\b/gi, '')
    .replace(/\b(?:the\s+)?(?:book|loan)\b/gi, '')
    .trim();
  if (loanIdMatch) cleaned = cleaned.replace(loanIdMatch[0], '').trim();

  const memberMatch = /\b(?:for|by|from)\s+([A-Za-z][A-Za-z .'-]{1,40})/i.exec(cleaned);
  if (memberMatch) cleaned = cleaned.replace(memberMatch[0], '').trim();

  return {
    ...(loanIdMatch ? { loanId: loanIdMatch[1] } : {}),
    ...(memberMatch ? { memberName: memberMatch[1].trim() } : {}),
    ...(cleaned.length >= 2 ? { bookTitle: cleaned } : {}),
  };
}

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function monthRange(year: number, month: number): { start: string; end: string; label: string } {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const dd = String(lastDay).padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${dd}`,
    label: `${monthNames[month - 1]} ${year}`,
  };
}

function parseComparePeriodsArgs(question: string, sector?: string): Record<string, unknown> | null {
  const isoDates = Array.from(question.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)).map((m) => m[1]);
  if (isoDates.length >= 4) {
    return {
      period1Start: isoDates[0],
      period1End: isoDates[1],
      period2Start: isoDates[2],
      period2End: isoDates[3],
      ...(sector ? { sector } : {}),
    };
  }

  const monthMatches = Array.from(
    question.matchAll(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+(\d{4}))?/gi
    )
  );
  if (monthMatches.length >= 2) {
    const defaultYear =
      monthMatches.map((m) => (m[2] ? Number(m[2]) : null)).find((y) => y !== null) || new Date().getFullYear();
    const m1 = MONTH_MAP[monthMatches[0][1].toLowerCase()];
    const y1 = monthMatches[0][2] ? Number(monthMatches[0][2]) : defaultYear;
    const m2 = MONTH_MAP[monthMatches[1][1].toLowerCase()];
    const y2 = monthMatches[1][2] ? Number(monthMatches[1][2]) : defaultYear;
    if (m1 && m2) {
      const r1 = monthRange(y1, m1);
      const r2 = monthRange(y2, m2);
      return {
        period1Start: r1.start,
        period1End: r1.end,
        period2Start: r2.start,
        period2End: r2.end,
        period1Label: r1.label,
        period2Label: r2.label,
        ...(sector ? { sector } : {}),
      };
    }
  }

  if (/\blast\s+month\b/i.test(question) && /\bthis\s+month\b/i.test(question)) {
    const now = new Date();
    const y2 = now.getFullYear();
    const m2 = now.getMonth() + 1;
    const prev = new Date(y2, m2 - 2, 1);
    const r1 = monthRange(prev.getFullYear(), prev.getMonth() + 1);
    const r2 = monthRange(y2, m2);
    return {
      period1Start: r1.start,
      period1End: r1.end,
      period2Start: r2.start,
      period2End: r2.end,
      period1Label: r1.label,
      period2Label: r2.label,
      ...(sector ? { sector } : {}),
    };
  }

  return null;
}

/**
 * Deterministic fallback intent parser when running without an external tool-calling key
 * or when explicit action phrases map directly to a registered tool.
 */
export function inferDeterministicToolCall(
  question: string,
  tools: Map<string, ToolDefinition>,
  attachments: ChatAttachment[],
  context?: RightClickContext,
  contexts?: RightClickContext[],
  opts?: { conversationId?: string; scope?: AccessScope }
): { name: string; args: Record<string, unknown> } | null {
  const fileAttachment = attachments.find((a) => a.type === 'file' && a.uploadId);
  if (fileAttachment && tools.has('importStudents')) {
    return {
      name: 'importStudents',
      args: { uploadId: fileAttachment.uploadId },
    };
  }
  if (fileAttachment && tools.has('khaznaImportStudents')) {
    const fileHay = `${question} ${fileAttachment.name} ${fileAttachment.previewSummary || ''}`.toLowerCase();
    if (/\b(manager|managers|khazna-managers)\b/.test(fileHay) && tools.has('khaznaImportManagers')) {
      return { name: 'khaznaImportManagers', args: { uploadId: fileAttachment.uploadId } };
    }
    if (/\b(sector|sectors|department|departments|khazna-sectors)\b/.test(fileHay) && tools.has('khaznaImportSectors')) {
      return { name: 'khaznaImportSectors', args: { uploadId: fileAttachment.uploadId } };
    }
    if (/\b(bulk|entries|entry|ledger|transactions|khazna-bulk-entries)\b/.test(fileHay) && tools.has('khaznaImportBulkEntries')) {
      return { name: 'khaznaImportBulkEntries', args: { uploadId: fileAttachment.uploadId } };
    }
    if (/\b(import|upload|add|create|load|parse)\b/i.test(question) || /\.(xlsx|xls|csv|tsv)$/i.test(fileAttachment.name)) {
      return {
        name: 'khaznaImportStudents',
        args: { uploadId: fileAttachment.uploadId },
      };
    }
  }

  const lower = question.toLowerCase().trim();
  const allContexts = contexts && contexts.length > 0 ? contexts : context ? [context] : [];
  const contextText = allContexts
    .map((c) => `${c.nearbyLabel || ''} ${c.text || ''}`.trim())
    .filter(Boolean)
    .join(' ')
    .trim();

  // Interactive Walkthrough / Guide Routing (Guide Skill v2)
  if (tools.has('start_guide') || tools.has('search_guides')) {
    const isGuideIntent =
      /\b(guide\s+me|walkthrough|walk\s+me\s+through|step[\s-]by[\s-]step|show\s+me\s+how|how\s+(?:do|can|to)\s+i|how\s+to)\b/i.test(
        lower
      ) || /(?:ഗൈഡ്|സഹായിക്കുക|എങ്ങനെ)/.test(question);
    if (isGuideIntent && tools.has('start_guide')) {
      let guideId: string | undefined;
      if (/\b(log\s*out|logout|sign\s*out|signout)\b/i.test(lower)) {
        guideId = 'auth.logout';
      } else if (/\b(?:demo|domo)\b/i.test(lower)) {
        guideId = 'public.demo';
      } else if (/\b(log\s*in|sign\s*in)\b/i.test(lower) || /ലോഗിൻ/.test(question)) {
        guideId = 'public.login';
      } else if (/\b(forgot|reset)\s+password\b/i.test(lower)) {
        guideId = 'public.forgot_password';
      } else if (/\b(register|sign\s*up|create\s+college)\b/i.test(lower)) {
        guideId = 'public.register';
      } else if (/\b(import|excel|bulk\s+import)\b/i.test(lower) || /ഇമ്പോർട്ട്/.test(question)) {
        guideId = 'admin.students.import';
      } else if (/\b(see|view|find|check|open|inspect|look\s*up)\b.*\bstudent(?:'s)?\s*(?:details?|profile|info|ledger|account|record|balance)\b/i.test(lower)) {
        guideId = 'admin.students.view';
      } else if (/\b(add|enroll|create)\s+(?:an?\s+)?(?:individual\s+)?student\b/i.test(lower) || /പുതിയ വിദ്യാർത്ഥി/.test(question)) {
        guideId = 'admin.students.add';
      } else if (/\b(create|add|new)\s+sector\b/i.test(lower) || /സെക്ടർ ഉണ്ടാക്കുക/.test(question)) {
        guideId = 'admin.sectors.create';
      } else if (/\b(assign|invite|add)\s+(?:a\s+)?manager\b/i.test(lower)) {
        guideId = 'admin.managers.assign';
      } else if (/\bissued\s+reports?\b/i.test(lower)) {
        guideId = 'admin.reports.issued';
      } else if (/\binstitution\b/i.test(lower)) {
        guideId = 'admin.institution';
      } else if (/\b(super\s*admin|platform|organizations)\b/i.test(lower)) {
        guideId = 'superadmin.overview';
      } else if (/\b(deposit|fee\s+deposit|record\s+(?:a\s+)?(?:fee\s+)?deposit)\b/i.test(lower) || /ഡെപ്പോസിറ്റ്/.test(question)) {
        guideId = 'manager.add_deposit';
      } else if (/\b(bulk\s+entry|batch\s+fee|uniform\s+fee)\b/i.test(lower) || /ബാച്ച് ഫീസ്/.test(question)) {
        guideId = 'manager.bulk_entry';
      } else if (/\bledger\b/i.test(lower)) {
        guideId = 'manager.ledger_entry';
      } else if (/\b(my\s+fees?|fees?\s+and\s+dues|dues|pending\s+fees?)\b/i.test(lower) || /ഫീസ് പരിശോധിക്കുക|കുടിശ്ശിക/.test(question)) {
        guideId = 'student.view_fees';
      } else if (/\bprofile\b/i.test(lower)) {
        guideId = 'student.profile';
      }

      if (guideId) {
        return { name: 'start_guide', args: { guideId } };
      }
      if (tools.has('search_guides')) {
        return { name: 'search_guides', args: { query: question } };
      }
    }
  }

  // Generic App-Agnostic Live Filtered Data Export ("give me all Fiqh 2 students with pending fees as Excel", "Same as CSV", etc.)
  if (tools.has('export_data')) {
    const exportCall = extractExportToolCall(question);
    if (exportCall) {
      return exportCall;
    }
  }

  // Answer-Only-What-Was-Asked structured filter/projection/follow-up engine ("net worth minus", "add phone number", "only Fiqh 2", "sort by highest due")
  if (tools.has('query_entities')) {
    const queryIntent = parseQueryIntent(question);
    if (queryIntent) {
      return {
        name: 'query_entities',
        args: queryIntent as unknown as Record<string, unknown>,
      };
    }
  }

  // Generic App-Agnostic Live Entity Lookup ("who is X", "where is book Y", "is Z on leave", "how much does X owe", "find X")
  if (tools.has('search_entities')) {
    const entityReq = extractEntitySearchQuery(question);
    if (entityReq) {
      return { name: 'search_entities', args: { query: entityReq.query } };
    }
  }

  // 0. Khazna Campus Ledger deterministic intents (only active when khazna tools are registered)
  if (
    tools.has('khaznaNavigate') ||
    tools.has('khaznaGetOverview') ||
    tools.has('khaznaGetStudentAccount') ||
    tools.has('khaznaCreateEntry') ||
    tools.has('find_students') ||
    tools.has('compare_periods')
  ) {
    const sectorPattern =
      /\b(office|dept[-.\s]*(?:fiqh|civil|sci|eng|com|[a-z0-9_-]+)|department\s+(?:fiqh|civil|sciences?|engineering|commerce)|applied\s+sciences?|engineering|commerce|fiqh|civil|velitcham[-.\s]*welfare|velitcham|ihsan[-.\s]*(?:union|scholarship)|ihsan)\b/i;
    const rawSectorInQuestion = sectorPattern.exec(question)?.[1];
    const rawSectorInContext =
      !rawSectorInQuestion && /\bthis\s+(sector|card|cuboid|section)\b/i.test(lower)
        ? sectorPattern.exec(contextText)?.[1]
        : undefined;
    const rawSector = rawSectorInQuestion || rawSectorInContext;
    const sectorMatch = rawSector
      ? (() => {
          const norm = rawSector
            .toLowerCase()
            .replace(/\bdepartment\b/g, 'dept')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          if (norm.includes('applied-science')) return 'dept-sci';
          if (norm === 'engineering') return 'dept-eng';
          if (norm === 'commerce') return 'dept-com';
          return norm;
        })()
      : undefined;
    const stuIdMatch = /\b(S\d{3,5}|CF-\d{4}-\d{3,5})\b/i.exec(`${question} ${contextText}`);

    // College / Campus Account Creation (SIGNUP_COLLEGE)
    if (
      tools.has('khaznaCreateCollegeAccount') &&
      (/\b(create|register|open|make|setup|set\s+up|sign\s*up)\b.*\b(new\s+)?(account|campus|college|workspace|organisation|organization)\b/i.test(
        lower
      ) ||
        /\bcollege\s+name\b/i.test(lower))
    ) {
      const collegeM =
        /\bcollege(?:\s+name)?\s*(?:as|is)?\s*[:=]\s*([^,;\n.]+?)(?=(?:\s*(?:[.,;]|\band\b|\bmy\b|\bfull\b|\bname\b|\bemail\b|\bpassword\b|$)))/i.exec(
          question
        ) ||
        /\bcollege\s+name\s+(?:is|as)\s+([A-Za-z0-9 &'.-]+?)(?=\s*(?:[.,;]|\band\b|$))/i.exec(question);
      const nameM =
        /\b(?:my\s+)?full\s+name\s*(?:as|is)?\s*[:=]\s*([^,;\n.]+?)(?=(?:\s*(?:[.,;]|\band\b|\bemail\b|\bpassword\b|$)))/i.exec(
          question
        ) ||
        /\b(?:admin(?:\s+name)?|full\s+name|my\s+name)\s*(?:as|is)?\s*[:=]?\s*([A-Za-z][A-Za-z .'-]{1,60}?)(?=\s*(?:[.,;]|\band\b|\bemail\b|\bpassword\b|$))/i.exec(
          question
        );
      const emailM = /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i.exec(question);
      const passM = /\b(?:set\s+)?password\s*(?:as|is|to)?\s*[:=]?\s*([^\s,;.]+)/i.exec(question);

      if (collegeM && nameM && emailM && passM) {
        return {
          name: 'khaznaCreateCollegeAccount',
          args: {
            college: collegeM[1].trim(),
            fullName: nameM[1].trim(),
            email: emailM[1].trim().toLowerCase(),
            password: passM[1].trim(),
          },
        };
      }
      if (tools.has('khaznaOpenInteractiveForm')) {
        return {
          name: 'khaznaOpenInteractiveForm',
          args: { formType: 'CREATE_COLLEGE_ACCOUNT' },
        };
      }
    }

    // Student Individual Account Status / Balance / Statement Lookup (strictly RBAC enforced inside tool)
    if (
      tools.has('khaznaGetStudentAccount') &&
      !/\b(download|export|pdf|excel|xlsx|csv|record|post|add|create|collect|settle|mark|void|unvoid|delete|edit|update|batch)\b/i.test(
        lower
      ) &&
      (/\b(account\s+(?:stable|status|state|balance|statement|ledger|dues|details|summary)|balance\s+(?:of|for)|dues\s+(?:of|for)|ledger\s+(?:of|for)|statement\s+(?:of|for))\b/i.test(
        lower
      ) ||
        /\b[a-z0-9_-]+'s\s+(?:account|balance|dues|ledger)\b/i.test(lower) ||
        (/\bstudent\s+[a-z0-9_-]+\b/i.test(lower) && /\b(balance|dues?|fee|ledger|account)\b/i.test(lower)))
    ) {
      const nameFromOf =
        /\b(?:of|for)\s+(?:the\s+)?(?:student\s+)?([A-Za-z][A-Za-z .'-]{1,45}?)(?=\s+(?:in|under|from|at)\s+(?:department|dept|sector|office|fiqh|civil|velitcham|ihsan)\b|\s*[?,.;]|$)/i.exec(
          question
        )?.[1] ||
        /\b([A-Za-z][A-Za-z .'-]{1,40}?)'s\s+(?:account|balance|dues|ledger)\b/i.exec(question)?.[1];
      const cleanedName = nameFromOf
        ? nameFromOf
            .replace(/^(?:the|student|mr|ms)\s+/i, '')
            .replace(/\s+(?:account|stable|status|balance|statement|ledger|dues)$/i, '')
            .trim()
        : undefined;
      const isGenericName =
        cleanedName &&
        /^(my|me|mine|current|open|display|report|campus|khazna|sector|student|students)$/i.test(cleanedName);

      if (stuIdMatch || (cleanedName && !isGenericName)) {
        return {
          name: 'khaznaGetStudentAccount',
          args: {
            ...(stuIdMatch ? { studentId: stuIdMatch[1].toUpperCase() } : {}),
            ...(cleanedName && !isGenericName ? { studentName: cleanedName } : {}),
            ...(sectorMatch ? { sector: sectorMatch } : {}),
          },
        };
      }
    }

    // Current Display Report / Overview (strictly role-scoped on execute)
    if (
      tools.has('khaznaGetOverview') &&
      (/\b(?:curren\w*\s+open\s+display\s+report|open\s+display\s+report|display\s+report|current\s+display|current\s+report|campus\s+overview|dashboard\s+summary|my\s+summary|my\s+balance|my\s+report|how\s+much\s+(?:do\s+i\s+)?owe|what\s+do\s+i\s+owe|my\s+dues?|what\s+are\s+my\s+dues?|my\s+fees?|how\s+much\s+(?:fee|dues?)|budget\s+and\s+balance)\b/i.test(
        lower
      ) ||
        /\b(give|show|get|tell|read)\b.*\b(display\s+report|overview|summary|balance|dues?)\b/i.test(lower)) &&
      !/\b(download|export|pdf|excel|xlsx|csv|platform|organization|organizations|class|fund|collections?|audit)\b/i.test(lower)
    ) {
      return {
        name: 'khaznaGetOverview',
        args: { ...(sectorMatch ? { sector: sectorMatch } : {}) },
      };
    }

    // Collect / Settle Pending Dues (matches Collect button in sector dashboard)
    if (
      tools.has('khaznaCollectDues') &&
      (/\b(collect|settle)\b.*\b(dues?|fee|fees|balance|pending)\b/i.test(lower) ||
        /\bcollect\s+(?:for|from)\s+/i.test(lower) ||
        /\bmark\s+([A-Za-z][A-Za-z .'-]{1,40}?)\s+(?:as\s+)?paid\b/i.test(lower))
    ) {
      const stuMatch =
        /\b(?:for|from|of)\s+(?:student\s+)?([A-Za-z][A-Za-z .'-]{1,40}?)(?=\s+(?:in|under|at)\b|\s*[?,.;]|$)/i.exec(
          question
        )?.[1] ||
        /\bmark\s+([A-Za-z][A-Za-z .'-]{1,40}?)\s+(?:as\s+)?paid\b/i.exec(question)?.[1];
      const cleanedStu = stuMatch
        ? stuMatch.replace(/^(?:student|the\s+student)\s+/i, '').trim()
        : undefined;
      const amtMatch = /[₹$]\s*(\d[\d,]*)/.exec(question);
      return {
        name: 'khaznaCollectDues',
        args: {
          ...(stuIdMatch ? { studentId: stuIdMatch[1].toUpperCase() } : {}),
          ...(cleanedStu && !/^(office|fiqh|civil|ihsan|velitcham|dues?|pending)$/i.test(cleanedStu)
            ? { studentName: cleanedStu }
            : {}),
          ...(sectorMatch ? { sector: sectorMatch } : {}),
          ...(amtMatch ? { amount: Number(amtMatch[1].replace(/,/g, '')) } : {}),
        },
      };
    }

    // Workspace Switch / Delete / Load Demo
    if (
      tools.has('khaznaManageWorkspace') &&
      /\b(switch|change|delete|remove)\b.*\b(workspace|org|organization|organisation|college\s+workspace)\b/i.test(
        lower
      )
    ) {
      const targetOrgM = /\bto\s+([A-Za-z0-9 &'.-]{2,60})$/i.exec(question);
      return {
        name: 'khaznaManageWorkspace',
        args: {
          action: /\b(delete|remove)\b/i.test(lower) ? 'delete' : 'switch',
          ...(targetOrgM ? { orgName: targetOrgM[1].trim() } : {}),
        },
      };
    }

    // Role-scoped list queries
    if (
      tools.has('khaznaListTransactions') &&
      /\b(list|show|get|view|find)\b.*\b(transactions?|entries|receipts?|credits?|debits?)\b/i.test(lower) &&
      !/\b(download|export|csv|pdf)\b/i.test(lower)
    ) {
      return {
        name: 'khaznaListTransactions',
        args: { ...(sectorMatch ? { sector: sectorMatch } : {}) },
      };
    }
    if (
      tools.has('khaznaListStudents') &&
      (/\b(list|show|get|view|find|search|count)\b.*\bstudents?\b/i.test(lower) ||
        /\b(?:how\s+many|number\s+of|which|who)\b.*\bstudents?\b/i.test(lower) ||
        /\bstudents?\b.*\b(?:have|has|with|having)\b.*\b(?:debit|debits|pending|unpaid|dues?|charges?)\b/i.test(
          lower
        )) &&
      !/\b(download|export|csv|pdf|add|enroll|enrol|create|edit|delete|remove|open|page|directory|defaulters?)\b/i.test(
        lower
      )
    ) {
      const hasDebit = /\b(debit|debits|charge|charged|charges)\b/i.test(lower);
      const pendingOnly = /\b(pending|unpaid|dues?|owe|owing|defaulters?)\b/i.test(lower);
      return {
        name: 'khaznaListStudents',
        args: {
          ...(sectorMatch ? { sector: sectorMatch } : {}),
          ...(hasDebit ? { hasDebit: true } : {}),
          ...(pendingOnly ? { pendingOnly: true } : {}),
        },
      };
    }

    // Theme toggle
    if (/\b(dark\s+(?:mode|theme|appearance)|switch\s+to\s+dark|enable\s+dark)\b/i.test(lower) && tools.has('khaznaSetTheme')) {
      return { name: 'khaznaSetTheme', args: { theme: 'dark' } };
    }
    if (/\b(light\s+(?:mode|theme|appearance)|switch\s+to\s+light|enable\s+light)\b/i.test(lower) && tools.has('khaznaSetTheme')) {
      return { name: 'khaznaSetTheme', args: { theme: 'light' } };
    }

    // Print current page
    if (/\bprint\b/i.test(lower) && tools.has('khaznaPrintPage')) {
      return { name: 'khaznaPrintPage', args: {} };
    }

    // Downloads & Exports: prefer import templates when explicitly asked for a template;
    // all data exports are generated directly by export_data above or here (never via existing UI download buttons).
    if (/\b(download|export)\b/i.test(lower)) {
      if (/\btemplate\b/i.test(lower) && tools.has('khaznaDownloadTemplateCsv')) {
        const template = /\bmanagers?\b/i.test(lower)
          ? 'managers'
          : /\b(bulk|entries|entry|ledger)\b/i.test(lower)
            ? 'bulk-entries'
            : 'students';
        return {
          name: 'khaznaDownloadTemplateCsv',
          args: { template },
        };
      }
      if (tools.has('export_data')) {
        const fmt = detectExportFormatToken(question);
        const clsMatch =
          /\b(?:class|for)\s+(fiqh\s*\d+|thanawiyya\s*\d+|civil\s*\d+)\b/i.exec(question);
        return {
          name: 'export_data',
          args: {
            entityType: /\baudit\b/i.test(lower) ? undefined : 'student',
            ...(clsMatch ? { filters: { className: clsMatch[1].trim() } } : {}),
            ...(fmt ? { format: fmt } : {}),
            bulkRequest: !/\bmy\b/i.test(lower),
          },
        };
      }
    }

    // Notifications read actions
    if (
      tools.has('khaznaMarkNoticeRead') &&
      /\bnotifications?|notices?\b/i.test(lower) &&
      /\b(mark|read|clear)\b/i.test(lower)
    ) {
      return { name: 'khaznaMarkNoticeRead', args: { all: true } };
    }

    // Update student phone
    if (
      tools.has('khaznaUpdatePhone') &&
      /\bphone\b/i.test(lower) &&
      /\b(update|change|set)\b/i.test(lower)
    ) {
      const phoneMatch = /\b(\+?\d[\d\s-]{6,16}\d)\b/.exec(question);
      if (phoneMatch) {
        return {
          name: 'khaznaUpdatePhone',
          args: {
            phone: phoneMatch[1].trim(),
            ...(stuIdMatch ? { studentId: stuIdMatch[1].toUpperCase() } : {}),
          },
        };
      }
      if (tools.has('khaznaOpenInteractiveForm')) {
        return { name: 'khaznaOpenInteractiveForm', args: { formType: 'UPDATE_PHONE' } };
      }
    }

    // Issued Reports actions
    if (
      tools.has('khaznaManageIssuedReport') &&
      /\b(revoke|extend|re-?download)\b.*\breport\b|\breport\b.*\b(revoke|extend)\b/i.test(lower)
    ) {
      const refMatch = /\b(KHZ-[A-Z0-9-]+)\b/i.exec(question);
      const action = /\brevoke\b/i.test(lower)
        ? 'revoke'
        : /\bextend\b/i.test(lower)
          ? 'extend'
          : 'download';
      return {
        name: 'khaznaManageIssuedReport',
        args: { action, ...(refMatch ? { ref: refMatch[1].toUpperCase() } : {}) },
      };
    }

    // Unvoid entry
    if (/\bunvoid\b|\brestore\b.*\b(entry|receipt)\b/i.test(lower) && tools.has('khaznaUnvoidEntry')) {
      const receiptMatch = /\b([A-Z]{2,4}-\d{2,6})\b/i.exec(`${question} ${contextText}`);
      return {
        name: 'khaznaUnvoidEntry',
        args: { ...(receiptMatch ? { receiptNo: receiptMatch[1].toUpperCase() } : {}) },
      };
    }

    // Void entry by receipt number or phrase
    if (/\bvoid\b/i.test(lower) && !/\bbatch\b/i.test(lower) && tools.has('khaznaVoidEntry')) {
      const receiptMatch = /\b([A-Z]{2,4}-\d{2,6})\b/i.exec(`${question} ${contextText}`);
      const reasonMatch = /\breason\s*[:=]?\s*(.+)$/i.exec(question);
      return {
        name: 'khaznaVoidEntry',
        args: {
          ...(receiptMatch ? { receiptNo: receiptMatch[1].toUpperCase() } : {}),
          ...(reasonMatch ? { reason: reasonMatch[1].trim() } : {}),
        },
      };
    }

    // Batch actions (void/delete existing OR post new bulk batch)
    if (/\bbatch\b|\bbulk\s+(?:entry|charge|debit|credit)\b/i.test(lower)) {
      const batchIdMatch = /\b(B-[A-Z0-9-]+)\b/i.exec(question);
      if (/\b(delete|remove)\b/i.test(lower) && batchIdMatch && tools.has('khaznaDeleteBatch')) {
        return { name: 'khaznaDeleteBatch', args: { batchId: batchIdMatch[1].toUpperCase() } };
      }
      if (/\bvoid\b/i.test(lower) && batchIdMatch && tools.has('khaznaVoidBatch')) {
        return { name: 'khaznaVoidBatch', args: { batchId: batchIdMatch[1].toUpperCase() } };
      }
      const amtMatch = /[₹$]?\s*(\d[\d,]*)/.exec(question);
      if (!amtMatch && tools.has('khaznaOpenInteractiveForm')) {
        return {
          name: 'khaznaOpenInteractiveForm',
          args: {
            formType: 'POST_BATCH',
            ...(sectorMatch ? { prefillSector: sectorMatch } : {}),
          },
        };
      }
      if (tools.has('khaznaPostBatch')) {
        const amount = amtMatch ? Number(amtMatch[1].replace(/,/g, '')) : 500;
        const type = /\b(credit|deposit|refund)\b/i.test(lower) ? 'credit' : 'debit';
        const sectorInQuestion =
          /\b(?:for|in|under|to)?\s*(?:sector|dept)\s*[:=]?\s*([a-z0-9_-]+)/i.exec(question)?.[1] ||
          sectorMatch;
        const classInQuestion =
          /\bclass\s*[:=]?\s*([a-z0-9 ]{2,30}?)(?=(?:\s*(?:for|in|amount|fee|type|[.,;]|$)))/i.exec(question)?.[1];
        let titleCandidate = /\b(?:called|named|title)\s+([A-Za-z0-9 &'-]{2,40})/i.exec(question)?.[1];
        if (!titleCandidate) {
          const forM = /\bfor\s+([A-Za-z0-9 &'-]{2,40})/i.exec(question);
          if (forM && !/\b(?:sector|dept|class)\b/i.test(forM[1])) {
            titleCandidate = forM[1].trim();
          }
        }
        return {
          name: 'khaznaPostBatch',
          args: {
            type,
            title: titleCandidate?.trim() || (type === 'debit' ? 'Study Tour Fee' : 'Batch Credit'),
            amount: Number.isNaN(amount) || amount <= 0 ? 500 : amount,
            ...(sectorInQuestion ? { sector: sectorInQuestion.trim() } : {}),
            ...(classInQuestion ? { className: classInQuestion.trim() } : {}),
          },
        };
      }
    }

    // Class management (add/edit/remove class)
    if (
      tools.has('khaznaManageClass') &&
      /\b(add|create|rename|edit|remove|delete)\b(?:\s+(?:a|new|the))*\s+class\b/i.test(lower) &&
      !/\bstudent\b/i.test(lower)
    ) {
      const renameM = /\b(?:rename|edit)\s+class\s+([A-Za-z0-9 ]+?)\s+to\s+([A-Za-z0-9 ]+)$/i.exec(question);
      if (renameM) {
        return {
          name: 'khaznaManageClass',
          args: { action: 'edit', className: renameM[1].trim(), newName: renameM[2].trim() },
        };
      }
      const clsM = /\bclass\s+(?:called|named)?\s*([A-Za-z0-9 ]{2,30})$/i.exec(question);
      if (clsM) {
        return {
          name: 'khaznaManageClass',
          args: {
            action: /\b(remove|delete)\b/i.test(lower) ? 'remove' : 'add',
            className: clsM[1].trim(),
          },
        };
      }
    }

    // Signatory HIL / direct
    if (/\bsignatory\b/i.test(lower) && /\b(add|new|create|authorize)\b/i.test(lower)) {
      if (tools.has('khaznaOpenInteractiveForm')) {
        return { name: 'khaznaOpenInteractiveForm', args: { formType: 'ADD_SIGNATORY' } };
      }
    }

    // Manager HIL / invite
    if (/\bmanager\b/i.test(lower) && /\b(invite|add|new|create)\b/i.test(lower)) {
      const emailM = /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i.exec(question);
      if (emailM && tools.has('khaznaManageManager')) {
        const nameM = /\b(?:invite|add)\s+(?:manager\s+)?([A-Za-z .'-]{2,40}?)(?:\s+[A-Z0-9._%+-]+@|$)/i.exec(question);
        return {
          name: 'khaznaManageManager',
          args: {
            action: 'invite',
            name: nameM?.[1]?.trim() || 'Sector Manager',
            email: emailM[1],
          },
        };
      }
      if (tools.has('khaznaOpenInteractiveForm')) {
        return { name: 'khaznaOpenInteractiveForm', args: { formType: 'INVITE_MANAGER' } };
      }
    }

    // Institution profile HIL edit
    if (/\binstitution\b|\bcollege\s+profile\b/i.test(lower) && /\b(edit|update|change)\b/i.test(lower)) {
      if (tools.has('khaznaOpenInteractiveForm')) {
        return { name: 'khaznaOpenInteractiveForm', args: { formType: 'UPDATE_INSTITUTION' } };
      }
    }

    // Create ledger entry (credit/debit/deposit/fee)
    if (
      (/\b(post|record|add|create|new)\b.*\b(entry|credit|debit|deposit|receipt|fee|payment)\b/i.test(lower) ||
        /\b(deposit|pay)\s+[₹$]?\s*\d+/i.test(lower)) &&
      !/\bsector\b.*\btarget\b/i.test(lower)
    ) {
      const amtMatch = /[₹$]?\s*(\d[\d,]*)/.exec(question);
      if (!amtMatch && tools.has('khaznaOpenInteractiveForm')) {
        return {
          name: 'khaznaOpenInteractiveForm',
          args: {
            formType: 'CREATE_ENTRY',
            ...(sectorMatch ? { prefillSector: sectorMatch } : {}),
          },
        };
      }
      if (amtMatch && tools.has('khaznaCreateEntry')) {
        const amount = Number(amtMatch[1].replace(/,/g, ''));
        const forStuMatch = /\bfor\s+([A-Za-z][A-Za-z .'-]{1,36}?)(?:\s+(?:in|under|for|at|,)|$)/i.exec(question);
        const candidateName = forStuMatch?.[1]?.trim() || '';
        const isGenericCandidate =
          !candidateName ||
          /^(office|fiqh|civil|ihsan|velitcham|the|a|an|student|admission|number|credit|debit|fee|account|payment|receipt|amount|rs|inr)\b/i.test(
            candidateName
          ) ||
          /\b(admission\s+number|ad\.?\s*no|student\s+id|sector)\b/i.test(candidateName);
        const type = /\b(debit|charge|fine|bill|mess)\b/i.test(lower) ? 'debit' : 'credit';
        return {
          name: 'khaznaCreateEntry',
          args: {
            type,
            amount: Number.isNaN(amount) || amount <= 0 ? 500 : amount,
            ...(stuIdMatch ? { studentId: stuIdMatch[1].toUpperCase() } : {}),
            ...(!isGenericCandidate ? { studentName: candidateName } : {}),
            ...(sectorMatch ? { sector: sectorMatch } : {}),
          },
        };
      }
    }

    // Delete student
    if (/\b(delete|remove)\b(?:\s+the)?\s+student\b/i.test(lower) && tools.has('khaznaDeleteStudent')) {
      const stuNameM = /\bstudent\s+([A-Za-z .'-]{2,40})$/i.exec(question);
      if (stuIdMatch || stuNameM) {
        return {
          name: 'khaznaDeleteStudent',
          args: {
            ...(stuIdMatch ? { studentId: stuIdMatch[1].toUpperCase() } : {}),
            ...(stuNameM ? { studentName: stuNameM[1].trim() } : {}),
          },
        };
      }
    }

    // Add student in Khazna:
    // If explicit full details (both name AND class) are provided -> direct execute khaznaAddStudent;
    // Otherwise ("add student", "enroll a student", "add student Amina") -> Human-in-the-Loop column form!
    if (/\b(add|enroll|enrol|register|new)\b(?:\s+(?:a|new|the))*\s+student\b/i.test(lower)) {
      const parsed = parseAddStudentArgs(question);
      const clsMatch = /\bclass\s*(?:is|:|=)?\s*([A-Za-z0-9 ]{2,25}?)(?=,|\s+(?:phone|guardian)|$)/i.exec(question);
      if (parsed?.fullName && clsMatch && tools.has('khaznaAddStudent')) {
        return {
          name: 'khaznaAddStudent',
          args: {
            name: parsed.fullName,
            className: clsMatch[1].trim(),
          },
        };
      }
      if (tools.has('khaznaOpenInteractiveForm')) {
        return {
          name: 'khaznaOpenInteractiveForm',
          args: {
            formType: 'ADD_STUDENT',
            ...(parsed?.fullName ? { prefillName: parsed.fullName } : {}),
            ...(clsMatch ? { prefillClass: clsMatch[1].trim() } : {}),
          },
        };
      }
    }

    // Create sector in Khazna (HIL when no sector name supplied)
    if (/\b(create|add|new|make)\b(?:\s+(?:a|new|the))*\s+sector\b/i.test(lower)) {
      const parsed = parseCreateSectorArgs(question);
      if (parsed?.name && tools.has('khaznaCreateSector')) {
        return {
          name: 'khaznaCreateSector',
          args: {
            name: parsed.name,
            ...(parsed.annualBudget ? { target: parsed.annualBudget } : {}),
          },
        };
      }
      if (tools.has('khaznaOpenInteractiveForm')) {
        return { name: 'khaznaOpenInteractiveForm', args: { formType: 'CREATE_SECTOR' } };
      }
    }

    // Delete sector
    if (/\b(delete|remove)\s+sector\b/i.test(lower) && tools.has('khaznaDeleteSector') && sectorMatch) {
      return { name: 'khaznaDeleteSector', args: { sector: sectorMatch } };
    }

    // Navigate routes / roles / demo / logout
    if (tools.has('khaznaNavigate')) {
      if (
        /\b(log\s*out|logout|sign\s*out|signout|end\s+(?:this\s+)?(?:session|section)|exit\s+(?:this\s+)?(?:session|section|portal|account))\b/i.test(
          lower
        )
      ) {
        return { name: 'khaznaNavigate', args: { route: '/login' } };
      }
      if (
        /\b(?:try|open|load|start|launch|enter)\s+(?:the\s+|a\s+)?(?:demo|domo)(?:\s+(?:mode|model|account|accounts|portal|workspace|session))?\b|\b(?:demo|domo)\s+(?:mode|model)\b/i.test(
          lower
        )
      ) {
        const role = /\bmanager\b/i.test(lower)
          ? 'manager'
          : /\bstudent\b/i.test(lower)
            ? 'student'
            : 'admin';
        return { name: 'khaznaNavigate', args: { role, loadDemo: true } };
      }
      if (
        !/\bwhat\s+does\b/i.test(lower) &&
        /\b(open|go\s+to|switch\s+to|navigate\s+to)\b/i.test(lower)
      ) {
        if (/\baudit\b/i.test(lower)) return { name: 'khaznaNavigate', args: { route: '/admin/audit', role: 'admin' } };
        if (/\bissued\s+reports?\b/i.test(lower)) return { name: 'khaznaNavigate', args: { route: '/admin/issued-reports', role: 'admin' } };
        if (/\breports?\b/i.test(lower)) return { name: 'khaznaNavigate', args: { route: `/m/${sectorMatch || 'dept-fiqh'}/reports`, role: 'manager', sector: sectorMatch } };
        if (/\badmins?\b|\bmanagers?\b/i.test(lower)) return { name: 'khaznaNavigate', args: { route: '/admin/admins', role: 'admin' } };
        if (/\binstitution\b/i.test(lower)) return { name: 'khaznaNavigate', args: { route: '/admin/institution', role: 'admin' } };
        if (/\bbulk\s+import\b|\bimport\s+students?\b/i.test(lower)) return { name: 'khaznaNavigate', args: { route: '/admin/students/import', role: 'admin' } };
        if (/\bstudent\s+directory\b|\bstudents?\s+(?:page|view|list)\b/i.test(lower)) return { name: 'khaznaNavigate', args: { route: '/admin/students', role: 'admin' } };
        if (/\bsectors?\b/i.test(lower)) return { name: 'khaznaNavigate', args: { route: '/admin/sectors', role: 'admin' } };
        if (/\bnotifications?\b/i.test(lower)) return { name: 'khaznaNavigate', args: { route: '/app/notifications', role: 'student' } };
        if (/\bprofile\b/i.test(lower)) return { name: 'khaznaNavigate', args: { route: '/app/profile', role: 'student' } };
        if (/\bbatches?\b/i.test(lower)) return { name: 'khaznaNavigate', args: { route: `/m/${sectorMatch || 'dept-fiqh'}/batches`, role: 'manager', sector: sectorMatch } };
        if (/\bbulk\s+entry\b/i.test(lower)) return { name: 'khaznaNavigate', args: { route: `/m/${sectorMatch || 'dept-fiqh'}/bulk`, role: 'manager', sector: sectorMatch } };
        if (/\bledger\b/i.test(lower)) return { name: 'khaznaNavigate', args: { route: `/m/${sectorMatch || 'dept-fiqh'}/ledger`, role: 'manager', sector: sectorMatch } };
        if (/\bsuper\s+admin\b|\badmin\s+(?:dashboard|portal|view)\b/i.test(lower)) return { name: 'khaznaNavigate', args: { role: 'admin' } };
        if (/\bsector\s+manager\b|\bmanager\s+(?:dashboard|portal|view)\b/i.test(lower)) return { name: 'khaznaNavigate', args: { role: 'manager', sector: sectorMatch } };
        if (/\bstudent\s+(?:dashboard|portal|view)\b/i.test(lower)) return { name: 'khaznaNavigate', args: { role: 'student' } };
      }
    }

    // Governed A-Z Data Access Tools routing
    const receiptMatch = /\b((?:OF|DF|EF|TF)-\d{2,6})\b/i.exec(question);
    if (receiptMatch && tools.has('get_receipt')) {
      return { name: 'get_receipt', args: { receiptNo: receiptMatch[1].toUpperCase() } };
    }
    if (/\b(platform|global\s+platform)\b/i.test(lower) && tools.has('summarize_platform_usage')) {
      return { name: 'summarize_platform_usage', args: {} };
    }
    if (/\b(organizations?|onboarded\s+colleges?|all\s+colleges?)\b/i.test(lower) && tools.has('list_organizations')) {
      return { name: 'list_organizations', args: {} };
    }
    if (/\baudit\s+activity\b/i.test(lower) && tools.has('summarize_audit_activity')) {
      return { name: 'summarize_audit_activity', args: {} };
    }
    if (/\baudit\s*logs?\b/i.test(lower) && tools.has('list_audit_logs')) {
      return { name: 'list_audit_logs', args: {} };
    }
    if (/\bissued\s+reports?\b/i.test(lower) && tools.has('list_issued_reports')) {
      return { name: 'list_issued_reports', args: {} };
    }
    if (/\b(notices?|notifications?)\b/i.test(lower) && tools.has('list_notices')) {
      return { name: 'list_notices', args: {} };
    }
    if (/\bsignator(?:y|ies)\b/i.test(lower) && tools.has('list_signatories')) {
      return { name: 'list_signatories', args: {} };
    }
    if (/\b(batches?|batch\s+fee)\b/i.test(lower) && tools.has('list_batches')) {
      return { name: 'list_batches', args: { ...(sectorMatch ? { sector: sectorMatch } : {}) } };
    }
    if (/\b(managers?|admin\s+users?|staff\s+users?)\b/i.test(lower) && tools.has('list_users')) {
      return { name: 'list_users', args: {} };
    }
    if (/\bdefaulters?\b/i.test(lower) && tools.has('report_defaulters')) {
      return { name: 'report_defaulters', args: { ...(sectorMatch ? { sector: sectorMatch } : {}) } };
    }
    if (/\b(fund\s+utilization|funds?|charity|grants?|endowment)\b/i.test(lower) && tools.has('report_fund_utilization')) {
      return { name: 'report_fund_utilization', args: {} };
    }
    if (/\bclass(?:es)?\b/i.test(lower) && /\b(report|summary|summarize|list|show|balance|students?)\b/i.test(lower)) {
      const clsM = /\b((?:fiqh|thanawiyya|civil|cs|b\.?sc)\s*\d*)\b/i.exec(question);
      if (clsM && tools.has('report_class')) {
        return { name: 'report_class', args: { className: clsM[1].trim() } };
      }
      if (tools.has('find_classes')) {
        return { name: 'find_classes', args: {} };
      }
    }
    if (
      tools.has('compare_periods') &&
      /\b(compare|vs\.?|versus|month[\s-]over[\s-]month|difference\s+between)\b/i.test(lower)
    ) {
      const cmpArgs = parseComparePeriodsArgs(question, sectorMatch);
      if (cmpArgs) {
        return { name: 'compare_periods', args: cmpArgs };
      }
    }
    if (
      /\b(collections?|revenue|collected)\b/i.test(lower) &&
      tools.has('summarize_collections')
    ) {
      return { name: 'summarize_collections', args: { ...(sectorMatch ? { sector: sectorMatch } : {}) } };
    }
    if (/\b(sectors?|unassigned\s+sectors?)\b/i.test(lower) && tools.has('find_sectors')) {
      return { name: 'find_sectors', args: { query: sectorMatch || '' } };
    }
    if (stuIdMatch && tools.has('summarize_student_finance')) {
      return { name: 'summarize_student_finance', args: { studentId: stuIdMatch[1].toUpperCase() } };
    }

    // Pronoun follow-up focus resolution (e.g. "What are his pending dues?", "Show her balance")
    if (
      !stuIdMatch &&
      opts?.conversationId &&
      opts?.scope &&
      /\b(his|her|their|that\s+student|this\s+student|same\s+student)\b/i.test(lower)
    ) {
      const focus = getConversationFocus(opts.conversationId, opts.scope);
      if (focus && focus.type === 'student') {
        if (tools.has('summarize_student_finance')) {
          return { name: 'summarize_student_finance', args: { studentId: focus.id } };
        }
        if (tools.has('get_student')) {
          return { name: 'get_student', args: { studentId: focus.id } };
        }
      }
    }

    // Entity / student lookup by name without ID -> prefer search_entities (app-agnostic), fallback to find_students
    if (
      !stuIdMatch &&
      (tools.has('search_entities') || tools.has('find_students')) &&
      !/\b(all\s+students?|every\s+student|defaulters?|download|export|pdf|csv|excel|add|enroll|delete|remove|sector|class|organization|college|platform)\b/i.test(
        lower
      )
    ) {
      const lookupNameMatch =
        /\b(?:details|profile|info|information|record|status|balance|dues|fees?|find|search|lookup|look\s+up|who\s+is)\s+(?:for|of|about)?\s*(?:the\s+)?(?:student\s+)?([A-Za-z][A-Za-z .'-]{1,40}?)(?=\s+(?:in|under|from|at)\s+(?:department|dept|sector|office|fiqh|civil|velitcham|ihsan)\b|\s*[?,.;]|$)/i.exec(
          question
        );
      const qName = lookupNameMatch?.[1]
        ?.replace(/^(?:the|student|mr|ms|for|of)\s+/i, '')
        .trim();
      if (
        qName &&
        !/^(my|me|mine|his|her|their|all|students?|current|display|report|campus|khazna|sector|sectors)$/i.test(
          qName
        )
      ) {
        if (tools.has('search_entities')) {
          return { name: 'search_entities', args: { query: qName } };
        }
        return {
          name: 'find_students',
          args: {
            query: qName,
            ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
          },
        };
      }
    }
  }

  // 1. Add Student
  if (
    tools.has('addStudent') &&
    /\b(add|enroll|enrol|register|insert)\b(?:\s+(?:a|new|the))*\s+student\b/i.test(lower)
  ) {
    const args = parseAddStudentArgs(question);
    if (args) return { name: 'addStudent', args };
  }

  // 2. Create Sector
  if (
    tools.has('createSector') &&
    /\b(create|add|new|make)\b(?:\s+(?:a|new|the))*\s+sector\b/i.test(lower)
  ) {
    const args = parseCreateSectorArgs(question);
    if (args) return { name: 'createSector', args };
  }

  // 3. Add Fund
  if (
    tools.has('addFund') &&
    /\b(add|create|register|new)\b(?:\s+(?:a|new|the))*\s*(?:(?:charity|government\s+grant|endowment|student\s+fees)\s+)?fund(?:\s+source|\s+pool)?\b/i.test(
      lower
    )
  ) {
    const args = parseAddFundArgs(question);
    if (args) return { name: 'addFund', args };
  }

  // 4. Unmark Paid / Mark Pending
  if (
    tools.has('unmarkStudentPaid') &&
    (/\b(unmark|unpay)\b/i.test(lower) ||
      /\b(mark|set|revert)\b.*\b(pending|unpaid)\b/i.test(lower))
  ) {
    const combined = `${question} ${contextText}`;
    const admMatch = /CF-\d{4}-\d+/i.exec(combined);
    if (admMatch) {
      return { name: 'unmarkStudentPaid', args: { admissionNo: admMatch[0].toUpperCase() } };
    }
    const nameMatch =
      /\b(?:mark|set|revert|unmark|unpay)\s+([a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,2}?)\s+(?:as\s+)?(?:pending|unpaid|paid)\b/i.exec(
        question
      ) ||
      /\b(?:unpay|unmark)\s+([a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,2}?)\s*$/i.exec(question);
    const candidate = (nameMatch?.[1] || '')
      .replace(/^(?:student|the student|record)\s+/i, '')
      .replace(/\s+as$/i, '')
      .trim();
    if (candidate) {
      return { name: 'unmarkStudentPaid', args: { studentName: candidate } };
    }
    return { name: 'unmarkStudentPaid', args: contextText ? { contextText } : {} };
  }

  // 5. Mark Student Paid (UI Click Trigger)
  if (/\b(mark|pay|paid|settle)\b/.test(lower) && tools.has('markStudentPaid')) {
    const combined = `${question} ${contextText}`;
    const admMatch = /CF-\d{4}-\d+/i.exec(combined);
    if (admMatch) {
      return { name: 'markStudentPaid', args: { admissionNo: admMatch[0].toUpperCase() } };
    }
    const nameMatch =
      /\bmark\s+([a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,2}?)\s+(?:as\s+)?paid\b/i.exec(question) ||
      /\b(?:mark\s+paid|settle|pay)\s+(?:for\s+)?([a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,2}?)(?:\s+(?:as\s+)?paid|\s*$)/i.exec(
        question
      );
    const candidate = (nameMatch?.[1] || '')
      .replace(/^(?:student|the student|record)\s+/i, '')
      .replace(/\s+as$/i, '')
      .trim();
    if (
      candidate &&
      !/^(this|it|that|her|him|student|a student|the student|data|a data|the data|record|fee|fees|pending)$/i.test(
        candidate
      )
    ) {
      return { name: 'markStudentPaid', args: { studentName: candidate } };
    }
    return {
      name: 'markStudentPaid',
      args: contextText ? { contextText } : {},
    };
  }

  // 6. Library: Add Book
  if (
    tools.has('addBook') &&
    /\b(add|create|register|insert)\b(?:\s+(?:a|new|the))*\s+book\b/i.test(lower)
  ) {
    const args = parseAddBookArgs(question);
    if (args) return { name: 'addBook', args };
  }

  // 7. Library: Borrow / Checkout Book
  if (tools.has('borrowBook') && /\b(borrow|checkout|check\s+out|issue|lend)\b/i.test(lower)) {
    const args = parseBorrowBookArgs(question);
    if (args) return { name: 'borrowBook', args };
  }

  // 8. Library: Return Book
  if (
    tools.has('returnBook') &&
    (/\breturn\b/i.test(lower) || /\bmark\b.*\breturned\b/i.test(lower))
  ) {
    return { name: 'returnBook', args: parseReturnBookArgs(question) };
  }

  // 9. UI Navigation & Filtering
  if (tools.has('controlAppUi')) {
    const tabMatch =
      /\b(?:open|go\s+to|switch\s+to|navigate\s+to)\b\s+(?:the\s+)?(students|sectors|funds|import|catalog|loans)(?:\s+tab|\s+page|\s+section|\s+view)?\b/i.exec(
        lower
      ) ||
      /\b(?:show|view)\b\s+(?:the\s+)?(students|sectors|funds|import|catalog|loans)\s+(?:tab|page|section|view)\b/i.exec(
        lower
      ) ||
      /\b(?:open|show|view)\b\s+(?:the\s+)?(import)\b/i.exec(lower);
    if (tabMatch) {
      return { name: 'controlAppUi', args: { tab: tabMatch[1].toLowerCase() } };
    }

    const filterMatch =
      /\bfilter\s+students?\s+(?:by\s+|in\s+)?(?:sector\s+)?(all|all\s+sectors|[A-Z]{2,8})\b/i.exec(
        question
      );
    if (filterMatch) {
      const val = filterMatch[1].toLowerCase().startsWith('all')
        ? ''
        : filterMatch[1].toUpperCase();
      return { name: 'controlAppUi', args: { tab: 'students', sectorFilter: val } };
    }

    const searchMatch =
      /\b(?:search|find)\s+(?:for\s+)?(?:students?\s+)?["']?([A-Za-z0-9 .-]{2,40})["']?$/i.exec(
        question
      );
    if (searchMatch && !/\bbooks?\b/i.test(lower)) {
      return {
        name: 'controlAppUi',
        args: { tab: 'students', searchQuery: searchMatch[1].trim() },
      };
    }

    if (/\b(clear|reset)\s+(?:the\s+)?(?:search|filter|filters)\b/i.test(lower)) {
      return { name: 'controlAppUi', args: { tab: 'students', searchQuery: '', sectorFilter: '' } };
    }
  }

  // 10. Read Tools
  if (/\b(list|show|get|view)\b.*\bstudents?\b/.test(lower) && tools.has('listStudents')) {
    return { name: 'listStudents', args: {} };
  }
  if (/\b(list|show|get|view)\b.*\b(sectors?|funds?|overview|summary)\b/.test(lower) && tools.has('getFinanceOverview')) {
    return { name: 'getFinanceOverview', args: {} };
  }
  if (/\b(list|show|get|view)\b.*\bbooks?\b/.test(lower) && tools.has('listBooks')) {
    return { name: 'listBooks', args: {} };
  }
  if (/\b(list|show|get|view)\b.*\bloans?\b/.test(lower) && tools.has('listLoans')) {
    return { name: 'listLoans', args: {} };
  }

  return null;
}
