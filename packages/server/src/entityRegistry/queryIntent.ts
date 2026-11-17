import type { NumericFilter, QuerySortSpec, StoredDatasetEntry } from '../tools/datasetState.ts';

export interface ParsedStructuredQueryIntent {
  entityType?: string;
  filters?: Record<string, string | number | boolean>;
  numericFilters?: NumericFilter[];
  pendingOnly?: boolean;
  sort?: QuerySortSpec;
  limit?: number;
  columns?: string[];
  title?: string;
  assumption?: string;
  isFollowUp?: boolean;
}

const KNOWN_COLUMN_PHRASES: Array<{ re: RegExp; key: string }> = [
  { re: /\b(?:ad(?:mission)?\s*no\.?|student\s*id|staff\s*id|employee\s*id|\bid\b)\b/i, key: 'id' },
  { re: /\b(?:full\s*name|student\s*name|name)\b/i, key: 'name' },
  { re: /\btitle\b/i, key: 'title' },
  { re: /\b(?:class(?:\s*name)?|grade)\b/i, key: 'className' },
  { re: /\b(?:phone(?:\s*number)?|mobile|contact|telephone)\b/i, key: 'phone' },
  { re: /\b(?:e-?mail(?:\s*address)?)\b/i, key: 'email' },
  { re: /\b(?:guardian|parent|father)\b/i, key: 'guardian' },
  { re: /\b(?:pending\s*(?:fee|fees|amount)?|dues?|due|owed|unpaid)\b/i, key: 'pendingFee' },
  { re: /\b(?:net\s*balance|net\s*worth|balance|net)\b/i, key: 'balance' },
  { re: /\b(?:credit|credits|total\s*paid|paid)\b/i, key: 'paidTotal' },
  { re: /\b(?:debit|debits|total\s*billed|billed)\b/i, key: 'debitTotal' },
  { re: /\b(?:sector(?:\s*id)?|dept|department)\b/i, key: 'sectorId' },
  { re: /\bauthor\b/i, key: 'author' },
  { re: /\bisbn\b/i, key: 'isbn' },
  { re: /\bshelf\b/i, key: 'shelf' },
  { re: /\blocation\b/i, key: 'location' },
  { re: /\bstatus\b/i, key: 'status' },
];

export function extractColumnsFromText(text: string): string[] {
  const found: string[] = [];
  for (const item of KNOWN_COLUMN_PHRASES) {
    if (item.re.test(text) && !found.includes(item.key)) {
      found.push(item.key);
    }
  }
  return found;
}

function detectEntityTypeFromQuery(lower: string, fallback?: string): string {
  if (/\b(leave\s+requests?|leaves?|employees?\s+on\s+leave)\b/i.test(lower)) return 'leave_request';
  if (/\bbooks?\b/i.test(lower)) return 'book';
  if (/\bshelves?|shelf\b/i.test(lower)) return 'shelf';
  if (/\bteachers?|faculty\b/i.test(lower)) return 'teacher';
  if (/\bprincipals?\b/i.test(lower)) return 'principal';
  if (/\bsector\s+managers?|managers?\b/i.test(lower)) return 'sector_manager';
  if (/\boffice\s+staff\b/i.test(lower)) return 'office_staff';
  if (/\bunion\s+(?:members?|managers?)\b/i.test(lower)) return 'union_member';
  if (/\bsectors?\b/i.test(lower) && !/\bin\s+(?:my\s+)?sector\b/i.test(lower)) return 'sector';
  if (
    /\b(students?|net\s*worth|negative\s+balance|minus\s+balance|pending\s+fees?|dues?|defaulters?|balance\s*[<>]|fiqh|thanawiyya|civil|hifz)\b/i.test(
      lower
    )
  ) {
    return 'student';
  }
  return fallback || 'student';
}

function extractSortSpec(lower: string): QuerySortSpec | undefined {
  if (/\b(highest\s+(?:due|pending|dues)|most\s+(?:due|pending)|due\s+desc|pending\s+desc)\b/i.test(lower)) {
    return { field: 'pendingFee', dir: 'desc' };
  }
  if (/\b(lowest\s+(?:due|pending)|due\s+asc|smallest\s+due)\b/i.test(lower)) {
    return { field: 'pendingFee', dir: 'asc' };
  }
  if (/\b(lowest\s+(?:net\s*)?balance|most\s+negative|worst\s+balance|balance\s+asc)\b/i.test(lower)) {
    return { field: 'balance', dir: 'asc' };
  }
  if (/\b(highest\s+(?:net\s*)?balance|balance\s+desc|largest\s+balance)\b/i.test(lower)) {
    return { field: 'balance', dir: 'desc' };
  }
  if (/\b(highest\s+(?:credit|paid)|most\s+paid)\b/i.test(lower)) {
    return { field: 'paidTotal', dir: 'desc' };
  }
  if (/\b(highest\s+(?:debit|billed))\b/i.test(lower)) {
    return { field: 'debitTotal', dir: 'desc' };
  }
  if (/\b(sort\s+by\s+name|alphabetical)\b/i.test(lower)) {
    return { field: 'name', dir: 'asc' };
  }
  if (/\bsort\s+by\s+(?:due|pending)\b/i.test(lower)) {
    return { field: 'pendingFee', dir: 'desc' };
  }
  if (/\bsort\s+by\s+balance\b/i.test(lower)) {
    return { field: 'balance', dir: 'asc' };
  }
  return undefined;
}

function extractLimitSpec(lower: string): number | undefined {
  const m = /\b(?:top|first|limit(?:\s+to)?)\s+(\d{1,4})\b/i.exec(lower);
  if (m?.[1]) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 5000) return n;
  }
  return undefined;
}

function extractNumericFilters(lower: string): {
  numericFilters: NumericFilter[];
  isNegativeBalance: boolean;
} {
  const numericFilters: NumericFilter[] = [];
  let isNegativeBalance = false;

  if (
    /\b(net\s*worth\s+minus|negative\s+(?:net\s*)?(?:worth|balance)|minus\s+(?:net\s*)?(?:worth|balance)|below\s+zero|less\s+than\s+zero|<\s*0|under\s+0)\b/i.test(
      lower
    )
  ) {
    numericFilters.push({ field: 'balance', op: '<', value: 0 });
    isNegativeBalance = true;
  }

  const symbolPattern =
    /\b(balance|net\s*worth|due|dues|pending(?:\s*fee)?|credit|paid|debit|billed)\s*(<=|>=|!=|<|>|=)\s*(-?\d[\d,]*)/gi;
  for (const match of lower.matchAll(symbolPattern)) {
    const rawField = match[1].toLowerCase();
    const op = match[2] as NumericFilter['op'];
    const value = Number(match[3].replace(/,/g, ''));
    const field = rawField.includes('balance') || rawField.includes('net')
      ? 'balance'
      : rawField.includes('credit') || rawField.includes('paid')
        ? 'paidTotal'
        : rawField.includes('debit') || rawField.includes('billed')
          ? 'debitTotal'
          : 'pendingFee';
    if (!numericFilters.some((f) => f.field === field && f.op === op && f.value === value)) {
      numericFilters.push({ field, op, value });
    }
  }

  const wordPattern =
    /\b(balance|net\s*worth|due|dues|pending(?:\s*fee)?|credit|paid|debit|billed)\s+(?:is\s+)?(?:greater\s+than|more\s+than|above|over|exceeding|less\s+than|below|under|at\s+least|at\s+most|equal(?:s|\s+to)?)\s+(-?\d[\d,]*)/gi;
  for (const match of lower.matchAll(wordPattern)) {
    const full = match[0].toLowerCase();
    const rawField = match[1].toLowerCase();
    const value = Number(match[2].replace(/,/g, ''));
    const op: NumericFilter['op'] = /\b(?:greater|more|above|over|exceeding)\b/.test(full)
      ? '>'
      : /\bat\s+least\b/.test(full)
        ? '>='
        : /\b(?:less|below|under)\b/.test(full)
          ? '<'
          : /\bat\s+most\b/.test(full)
            ? '<='
            : '=';
    const field = rawField.includes('balance') || rawField.includes('net')
      ? 'balance'
      : rawField.includes('credit') || rawField.includes('paid')
        ? 'paidTotal'
        : rawField.includes('debit') || rawField.includes('billed')
          ? 'debitTotal'
          : 'pendingFee';
    if (!numericFilters.some((f) => f.field === field && f.op === op && f.value === value)) {
      numericFilters.push({ field, op, value });
    }
  }

  return { numericFilters, isNegativeBalance };
}

function extractClassFilter(question: string): string | undefined {
  const m = /\b((?:fiqh|thanawiyya|civil|eng|cs|sci)\s*\d+|hifz)\b/i.exec(question);
  return m ? m[1].replace(/\s+/g, ' ').trim() : undefined;
}

function extractSectorFilter(question: string): string | undefined {
  const m =
    /\b(dept-[a-z0-9_-]+|ihsan-union|velitcham-welfare)\b/i.exec(question) ||
    /\b(?:in|for|under)\s+(?:sector|dept|department)\s+([a-z0-9_-]+)/i.exec(question);
  return m ? m[1].trim() : undefined;
}

export function isQueryFollowUpRefinement(
  question: string,
  previous?: StoredDatasetEntry
): boolean {
  if (!previous || previous.rows.length === 0) return false;
  const lower = question.trim().toLowerCase();
  // Do NOT treat explicit export/format conversions as query refinements (those belong to export_data)
  if (
    /\b(download|export|save\s+as|same\s+as|excel|xlsx|pdf|csv|word|docx|json|txt)\b/i.test(
      lower
    )
  ) {
    return false;
  }

  if (
    /^(?:add|include|also\s+show|with|show|remove|hide|drop|omit)\s+(?:the\s+)?(?:phone(?:\s*number)?|mobile|email|class(?:\s*name)?|guardian|sector|debit|credit|paid|billed|balance|due|pending|id)\b/i.test(
      lower
    ) ||
    /\b(?:debit\s+and\s+credit\s+too|include\s+debit(?:\s+and\s+credit)?|with\s+debit\s+and\s+credit|all\s+columns)\b/i.test(
      lower
    ) ||
    /^(?:only|just|filter\s+(?:by|to))\s+(?:(?:fiqh|thanawiyya|civil|eng|cs|sci)\s*\d+|hifz|dept-[a-z0-9_-]+|available|pending|approved)\b/i.test(
      lower
    ) ||
    /^(?:sort\s+by|order\s+by|highest\s+first|lowest\s+first|top\s+\d+|first\s+\d+)\b/i.test(
      lower
    ) ||
    /\bswitch\s+to\s+unpaid/i.test(lower)
  ) {
    return true;
  }

  return false;
}

export function parseStructuredQueryIntent(
  question: string,
  previous?: StoredDatasetEntry
): ParsedStructuredQueryIntent | null {
  const q = question.trim();
  if (!q) return null;
  const lower = q.toLowerCase();

  // Never intercept how-to guides, writes, exports (unless asking for a list without download/format)
  if (
    /\b(how\s+(?:do|can|to)\s+i|how\s+to|guide\s+me|walkthrough|show\s+me\s+how|template|void|unvoid|delete|import|upload)\b/i.test(
      lower
    )
  ) {
    return null;
  }

  // Follow-up mutations against stored dataset state
  if (isQueryFollowUpRefinement(q, previous) && previous) {
    const baseCols = previous.columns.map((c) => c.key);
    const nextCols = [...baseCols];
    const filters = { ...(previous.filters || {}) };
    let numericFilters = [...(previous.numericFilters || [])];
    let pendingOnly = Boolean(previous.pendingOnly);
    let sort = previous.sort ? { ...previous.sort } : undefined;
    let limit = previous.limit;

    if (/\b(?:all\s+columns)\b/i.test(lower)) {
      for (const k of ['id', 'name', 'className', 'phone', 'debitTotal', 'paidTotal', 'pendingFee', 'balance']) {
        if (!nextCols.includes(k)) nextCols.push(k);
      }
    } else if (/\b(?:debit\s+and\s+credit|include\s+debit|with\s+debit)\b/i.test(lower)) {
      for (const k of ['debitTotal', 'paidTotal']) {
        if (!nextCols.includes(k)) nextCols.push(k);
      }
    } else if (/^(?:remove|hide|drop|omit)\b/i.test(lower)) {
      const toRemove = extractColumnsFromText(q);
      for (const k of toRemove) {
        const idx = nextCols.indexOf(k);
        if (idx >= 0 && nextCols.length > 1) nextCols.splice(idx, 1);
      }
    } else if (/^(?:add|include|also\s+show|with|show)\b/i.test(lower)) {
      const toAdd = extractColumnsFromText(q);
      for (const k of toAdd) {
        if (!nextCols.includes(k)) nextCols.push(k);
      }
    }

    const cls = extractClassFilter(q);
    if (cls) filters.className = cls;
    const sec = extractSectorFilter(q);
    if (sec) filters.sectorId = sec;

    if (/\bswitch\s+to\s+unpaid/i.test(lower)) {
      numericFilters = [{ field: 'pendingFee', op: '>', value: 0 }];
      pendingOnly = true;
    }

    const newSort = extractSortSpec(lower);
    if (newSort) sort = newSort;
    const newLimit = extractLimitSpec(lower);
    if (newLimit) limit = newLimit;

    return {
      entityType: previous.entityType || 'student',
      filters,
      numericFilters,
      pendingOnly,
      sort,
      limit,
      columns: nextCols,
      title: cls ? `${previous.title} (${cls})` : previous.title,
      isFollowUp: true,
    };
  }

  // Fresh query detection (non-export data questions that need exact filtering & minimal projection)
  const hasExplicitExport = /\b(export|download|generate\s+(?:an?\s+)?(?:excel|pdf|csv|word|docx|json)|save\s+as|same\s+as|\bexcel\b|\bxlsx\b|\bpdf\b|\bcsv\b|\bdocx\b|\bword\b)\b/i.test(
    lower
  );
  if (hasExplicitExport) {
    return null;
  }

  const { numericFilters, isNegativeBalance } = extractNumericFilters(lower);
  const sort = extractSortSpec(lower);
  const limit = extractLimitSpec(lower);
  const cls = extractClassFilter(q);
  const sec = extractSectorFilter(q);

  const isNegativeBalanceQuery =
    isNegativeBalance ||
    /\b(net\s*worth\s+minus|negative\s+(?:net\s*)?(?:balance|worth)|minus\s+balance)\b/i.test(lower);

  const isGenericFilteredListQuery =
    numericFilters.length > 0 ||
    Boolean(sort) ||
    Boolean(limit) ||
    /\b(?:only\s+(?:columns?|fields?|name|phone|id|due|balance)|with\s+only\s+)\b/i.test(lower) ||
    (/\b(?:list|show|give|find|which)\b.*\b(?:pending\s+fees?|unpaid|defaulters?|negative|minus|balance|dues?)\b/i.test(
      lower
    ) &&
      !/\bgive\s+me\s+all\s+[a-z0-9 ]+\s+students?\s*$/i.test(lower));

  if (!isNegativeBalanceQuery && !isGenericFilteredListQuery) {
    return null;
  }

  const entityType = detectEntityTypeFromQuery(lower);
  const filters: Record<string, string | number | boolean> = {};
  if (cls) filters.className = cls;
  if (sec) filters.sectorId = sec;

  const statusMatch = /\b(available|checked\s*out|borrowed|approved|pending|rejected)\b/i.exec(lower);
  if (statusMatch && entityType !== 'student') {
    filters.status = statusMatch[1].trim();
  }

  // Minimal columns strictly matching what was asked!
  const explicitCols = extractColumnsFromText(q);
  const wantsDebitCredit = /\b(debit|credit|paid|billed|all\s+columns)\b/i.test(lower);

  let columns: string[] | undefined;
  let assumption: string | undefined;

  if (/\ball\s+columns\b/i.test(lower)) {
    columns = undefined;
  } else if (isNegativeBalanceQuery) {
    // User asked for "net worth minus": show ONLY ID, Name, and Pending/Due (or negative Balance) — omit Debit & Credit unless asked!
    const cols = ['id', 'name', 'pendingFee'];
    if (cls || /\bclass\b/i.test(lower)) cols.splice(2, 0, 'className');
    if (/\bphone\b/i.test(lower)) cols.push('phone');
    if (wantsDebitCredit) {
      cols.push('debitTotal', 'paidTotal');
    }
    columns = cols;
    if (!wantsDebitCredit) {
      assumption =
        'Interpreted "net worth minus" as students with negative net balance (< ₹0), showing only Admission No, Name, and Due (say "include debit and credit" to add them).';
    }
  } else if (/\bonly\b/i.test(lower) && explicitCols.length > 0) {
    columns = explicitCols;
  } else if (explicitCols.length > 0 && entityType === 'student') {
    const base = ['id', 'name'];
    if (cls && !base.includes('className')) base.push('className');
    for (const c of explicitCols) {
      if (!base.includes(c)) base.push(c);
    }
    columns = base;
  } else if (entityType === 'student' && /\b(pending|unpaid|dues?|defaulters?)\b/i.test(lower)) {
    columns = ['id', 'name', 'className', 'pendingFee'];
    if (/\bphone\b/i.test(lower)) columns.push('phone');
    if (wantsDebitCredit) columns.push('debitTotal', 'paidTotal');
  }

  const pendingOnly =
    isNegativeBalanceQuery ||
    /\b(pending\s*(?:fee|fees|dues?)?|unpaid|defaulters?|with\s+dues?)\b/i.test(lower);

  const titleParts: string[] = [];
  if (cls) titleParts.push(cls);
  if (isNegativeBalanceQuery) {
    titleParts.push('Students with Negative Balance');
  } else if (pendingOnly && entityType === 'student') {
    titleParts.push('Students with Pending Dues');
  } else {
    titleParts.push(entityType === 'student' ? 'Students' : entityType);
  }

  return {
    entityType,
    filters,
    numericFilters,
    pendingOnly,
    sort: sort || (isNegativeBalanceQuery ? { field: 'pendingFee', dir: 'desc' } : undefined),
    limit,
    columns,
    title: titleParts.join(' '),
    assumption,
  };
}
