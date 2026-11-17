import type {
  AccessScope,
} from '../security/scope.ts';
import type {
  AssistantEntityConfig,
  EntityDetailsResult,
  EntityFieldSpec,
  EntityScopeRole,
  EntitySearchMatch,
  EntitySearchResult,
  EntityTypeDefinition,
} from '@ai-assistant/core';

const dynamicConfigRegistry = new Map<string, AssistantEntityConfig>();

export function registerEntityConfig(config: AssistantEntityConfig): void {
  dynamicConfigRegistry.set(config.appId, config);
}

export function getRegisteredEntityConfig(appId: string): AssistantEntityConfig | undefined {
  return dynamicConfigRegistry.get(appId);
}

function normalizeBasic(input: string): string {
  return input
    .toLowerCase()
    .replace(/['’`.]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Phonetic / transliteration normalization for Arabic/South-Asian names & common typos
 * e.g. Abdulla <-> Abdullah, Safwaan <-> Safwan, Faizi <-> Faizy, Mohammed <-> Muhammad
 */
function phoneticFold(input: string): string {
  return normalizeBasic(input)
    .replace(/\bmuhamm?[ae]d\b/g, 'mohamad')
    .replace(/\bmohamm?[ae]d\b/g, 'mohamad')
    .replace(/ph/g, 'f')
    .replace(/([a-z])h\b/g, '$1')
    .replace(/aa+/g, 'a')
    .replace(/ee+/g, 'i')
    .replace(/oo+/g, 'u')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/y\b/g, 'i')
    .replace(/[^a-z0-9\s]/g, '');
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

function diceSimilarity(a: string, b: string): number {
  const s1 = a.replace(/\s+/g, '');
  const s2 = b.replace(/\s+/g, '');
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return s1[0] === s2[0] ? 0.5 : 0;

  const bigrams = (str: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.slice(i, i + 2);
      map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
  };

  const b1 = bigrams(s1);
  const b2 = bigrams(s2);
  let hits = 0;
  for (const [bg, count] of b1.entries()) {
    const c2 = b2.get(bg) || 0;
    hits += Math.min(count, c2);
  }
  return (2 * hits) / (s1.length - 1 + (s2.length - 1));
}

function fuzzyStringSimilarity(a: string, b: string): number {
  const c1 = a.replace(/\s+/g, '');
  const c2 = b.replace(/\s+/g, '');
  if (!c1 || !c2) return 0;
  if (c1 === c2) return 1;

  const maxLen = Math.max(c1.length, c2.length);
  const levSim = 1 - levenshteinDistance(c1, c2) / maxLen;
  const diceSim = diceSimilarity(c1, c2);
  return Math.max(levSim, diceSim);
}

function scoreFieldMatch(query: string, rawVal: unknown, isPrimaryField: boolean): number {
  if (rawVal === null || rawVal === undefined) return 0;
  const rawStr = Array.isArray(rawVal) ? rawVal.map(String).join(' ') : String(rawVal);
  if (!rawStr.trim()) return 0;

  const qRaw = query.trim().toLowerCase();
  const vRaw = rawStr.trim().toLowerCase();
  if (qRaw === vRaw) return 1.0;

  // Digit-based match for phone numbers or numeric IDs
  const qDigits = qRaw.replace(/[^0-9]/g, '');
  const vDigits = vRaw.replace(/[^0-9]/g, '');
  if (qDigits.length >= 4 && vDigits.includes(qDigits)) {
    return qDigits === vDigits ? 0.99 : 0.92;
  }

  const qNorm = normalizeBasic(query);
  const vNorm = normalizeBasic(rawStr);
  if (!qNorm || !vNorm) return 0;
  if (qNorm === vNorm) return 0.99;

  const qFold = phoneticFold(query);
  const vFold = phoneticFold(rawStr);
  if (qFold && vFold && qFold === vFold) return 0.97;

  const qTokens = qNorm.split(' ').filter(Boolean);
  const vTokens = vNorm.split(' ').filter(Boolean);
  const qFoldTokens = qFold.split(' ').filter(Boolean);
  const vFoldTokens = vFold.split(' ').filter(Boolean);

  if (qTokens.length === 1) {
    const qt = qTokens[0]!;
    const qft = qFoldTokens[0] || qt;

    // Exact word token match (e.g. "abdulla" in "Abdulla M." or "Abdulla K.")
    if (vTokens.includes(qt)) {
      return isPrimaryField ? 0.96 : 0.9;
    }
    if (vFoldTokens.includes(qft)) {
      return isPrimaryField ? 0.94 : 0.88;
    }

    // Prefix match on token (require >= 3 chars)
    if (qt.length >= 3 && vTokens.some((vt) => vt.startsWith(qt))) {
      return isPrimaryField ? 0.88 : 0.82;
    }

    // Substring match (require >= 4 chars on non-primary fields to avoid email domain noise)
    if (qt.length >= (isPrimaryField ? 3 : 4) && vNorm.includes(qt)) {
      return isPrimaryField ? 0.85 : 0.78;
    }

    // Fuzzy token similarity (e.g. "abdulah" -> "abdulla", "safwaan" -> "safwan")
    if (qt.length >= 3) {
      let bestTok = 0;
      for (let i = 0; i < vTokens.length; i++) {
        const vt = vTokens[i]!;
        const vft = vFoldTokens[i] || vt;
        if (Math.abs(vt.length - qt.length) > Math.max(3, Math.floor(qt.length * 0.6))) {
          continue;
        }
        const s1 = fuzzyStringSimilarity(qt, vt);
        const s2 = qft && vft ? fuzzyStringSimilarity(qft, vft) : 0;
        bestTok = Math.max(bestTok, s1, s2 * 0.97);
      }
      if (bestTok >= 0.42) {
        return isPrimaryField ? bestTok : bestTok * 0.94;
      }
    }
    return 0;
  }

  // Multi-word query: check how well all query tokens match target tokens
  if (vNorm.includes(qNorm) || (qFold.length >= 4 && vFold.includes(qFold))) {
    return isPrimaryField ? 0.96 : 0.9;
  }

  let totalTokenScore = 0;
  let matchedCount = 0;
  for (let qi = 0; qi < qTokens.length; qi++) {
    const qt = qTokens[qi]!;
    const qft = qFoldTokens[qi] || qt;
    let bestForToken = 0;
    for (let vi = 0; vi < vTokens.length; vi++) {
      const vt = vTokens[vi]!;
      const vft = vFoldTokens[vi] || vt;
      if (qt === vt) {
        bestForToken = 1;
        break;
      }
      if (qft === vft) {
        bestForToken = Math.max(bestForToken, 0.96);
        continue;
      }
      if (qt.length >= 2 && vt.startsWith(qt)) {
        bestForToken = Math.max(bestForToken, 0.9);
        continue;
      }
      if (qt.length >= 3) {
        const sim = Math.max(fuzzyStringSimilarity(qt, vt), fuzzyStringSimilarity(qft, vft) * 0.97);
        bestForToken = Math.max(bestForToken, sim);
      }
    }
    if (bestForToken >= 0.65) matchedCount++;
    totalTokenScore += bestForToken;
  }

  const avgTokenScore = totalTokenScore / qTokens.length;
  const fullPhraseSim = Math.max(fuzzyStringSimilarity(qNorm, vNorm), fuzzyStringSimilarity(qFold, vFold) * 0.97);

  if (matchedCount === qTokens.length) {
    return Math.max(0.84, Math.min(0.95, avgTokenScore * 0.96));
  }
  return Math.max(fullPhraseSim * (isPrimaryField ? 1 : 0.92), matchedCount > 0 ? avgTokenScore * 0.72 : 0);
}

export function isRecordVisibleToScope(
  record: Record<string, unknown>,
  entityDef: EntityTypeDefinition,
  scope?: AccessScope
): boolean {
  const role: EntityScopeRole = scope?.role || 'PUBLIC';
  const rule = entityDef.visibilityRules[role] || 'none';

  if (rule === 'none') return false;
  if (rule === 'all') return true;

  // Organization isolation for all org / sector / self scopes
  if (scope && 'organizationId' in scope && scope.organizationId && entityDef.orgField) {
    const recOrg = record[entityDef.orgField];
    if (typeof recOrg === 'string' && recOrg.trim()) {
      if (recOrg.trim().toLowerCase() !== scope.organizationId.trim().toLowerCase()) {
        return false;
      }
    }
  }

  if (rule === 'org') return true;

  if (rule === 'sector') {
    if (!scope || scope.role !== 'SECTOR_MANAGER') return false;
    const allowedSectors = new Set(scope.sectorIds.map((s) => s.toLowerCase()));
    if (allowedSectors.size === 0) return false;

    const candidateValues: string[] = [];
    const pushSectorVal = (val: unknown) => {
      if (typeof val === 'string' && val.trim()) {
        candidateValues.push(val.trim().toLowerCase());
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string' && item.trim()) {
            candidateValues.push(item.trim().toLowerCase());
          }
        }
      }
    };

    if (entityDef.sectorField) {
      pushSectorVal(record[entityDef.sectorField]);
    }
    if (candidateValues.length === 0) {
      pushSectorVal(record.sectorId);
      pushSectorVal(record.sector);
      pushSectorVal(record.sectors);
      pushSectorVal(record.department);
    }

    if (candidateValues.some((sec) => allowedSectors.has(sec))) {
      return true;
    }

    // Support aggregated student ledgers (e.g. live appState `bySector`)
    if (record.bySector && typeof record.bySector === 'object') {
      const keys = Object.keys(record.bySector as Record<string, unknown>).map((k) => k.toLowerCase());
      if (keys.some((k) => allowedSectors.has(k))) return true;
    }
    return false;
  }

  if (rule === 'self') {
    if (!scope || scope.role !== 'STUDENT') return false;
    const ownerKey = entityDef.ownerIdField || entityDef.idField;
    const ownerVal = String(record[ownerKey] ?? record[entityDef.idField] ?? '').trim().toLowerCase();
    const scopeStudentId = scope.studentId.trim().toLowerCase();
    const scopeUserId = scope.userId.trim().toLowerCase();
    return Boolean(ownerVal && (ownerVal === scopeStudentId || ownerVal === scopeUserId));
  }

  return false;
}

function formatFieldValue(val: unknown, spec: EntityFieldSpec): string | null {
  if (val === undefined || val === null || val === '') return null;
  if (spec.format === 'currency' && typeof val === 'number') {
    return `₹${Math.round(val).toLocaleString('en-IN')}`;
  }
  if (spec.format === 'array' && Array.isArray(val)) {
    return val.length > 0 ? val.join(', ') : null;
  }
  if (spec.format === 'boolean') {
    return val ? 'Yes' : 'No';
  }
  if (spec.format === 'date' && typeof val === 'string') {
    return val.slice(0, 10);
  }
  return String(val);
}

function extractKeyFields(
  record: Record<string, unknown>,
  specs: EntityFieldSpec[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of specs) {
    if (record[spec.key] !== undefined && record[spec.key] !== null && record[spec.key] !== '') {
      out[spec.label] = record[spec.key];
    }
  }
  return out;
}

function formatMatchLine(match: EntitySearchMatch, specs: EntityFieldSpec[], record: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const spec of specs) {
    const formatted = formatFieldValue(record[spec.key], spec);
    if (formatted !== null) {
      parts.push(`${spec.label}: ${formatted}`);
    }
  }
  const detailsText = parts.length > 0 ? ` — ${parts.join(', ')}` : '';
  return `- **${match.name}** [**${match.roleLabel}**]${detailsText}`;
}

export async function searchEntities(params: {
  config: AssistantEntityConfig;
  collections: Record<string, Array<Record<string, unknown>>>;
  query: string;
  types?: string[];
  scope?: AccessScope;
}): Promise<EntitySearchResult> {
  const { config, collections, query, types, scope } = params;
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return {
      ok: true,
      appId: config.appId,
      appName: config.appName,
      query,
      matches: [],
      suggestions: [],
      summary: 'Please specify a name, ID, title, or keyword to search.',
    };
  }

  const allowedTypes =
    types && types.length > 0 ? new Set(types.map((t) => t.toLowerCase())) : null;
  const activeEntities = config.entities.filter(
    (e) => !allowedTypes || allowedTypes.has(e.type.toLowerCase())
  );

  interface ScoredCandidate {
    entityDef: EntityTypeDefinition;
    record: Record<string, unknown>;
    id: string;
    name: string;
    roleLabel: string;
    score: number;
    matchedField: string;
    visible: boolean;
  }

  // Search ALL registered entity types in parallel
  const perEntityResults = await Promise.all(
    activeEntities.map(async (entityDef) => {
      const rows = Array.isArray(collections[entityDef.collection])
        ? collections[entityDef.collection]!
        : [];
      const candidates: ScoredCandidate[] = [];

      for (const record of rows) {
        const id = String(record[entityDef.idField] ?? '').trim();
        const name = String(record[entityDef.nameField] ?? id).trim();
        if (!name && !id) continue;

        const dynamicRole =
          entityDef.roleField && typeof record[entityDef.roleField] === 'string' && String(record[entityDef.roleField]).trim()
            ? String(record[entityDef.roleField]).trim()
            : entityDef.label;

        let bestScore = 0;
        let matchedField = entityDef.nameField;

        for (const field of entityDef.searchableFields) {
          const isPrimary = field === entityDef.nameField || field === entityDef.idField;
          const s = scoreFieldMatch(trimmedQuery, record[field], isPrimary);
          if (s > bestScore) {
            bestScore = s;
            matchedField = field;
          }
        }

        if (bestScore >= 0.42) {
          const visible = isRecordVisibleToScope(record, entityDef, scope);
          candidates.push({
            entityDef,
            record,
            id: id || name,
            name: name || id,
            roleLabel: dynamicRole,
            score: Number(bestScore.toFixed(4)),
            matchedField,
            visible,
          });
        }
      }

      return candidates;
    })
  );

  const allCandidates = perEntityResults.flat();
  const strongThreshold = 0.65;
  const strongAuthorized = allCandidates.filter((c) => c.visible && c.score >= strongThreshold);
  const strongDenied = allCandidates.filter((c) => !c.visible && c.score >= strongThreshold);

  if (strongAuthorized.length === 0 && strongDenied.length > 0) {
    return {
      ok: false,
      denied: true,
      appId: config.appId,
      appName: config.appName,
      query: trimmedQuery,
      matches: [],
      suggestions: [],
      summary: "You don't have access to that record.",
    };
  }

  if (strongAuthorized.length === 0) {
    // Only suggest from authorized close candidates (never leak restricted records)
    const closeSuggestions = allCandidates
      .filter((c) => c.visible && c.score >= 0.42)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((c) => `${c.name} (${c.roleLabel})`);

    const uniqueSuggestions = Array.from(new Set(closeSuggestions));
    const summary =
      uniqueSuggestions.length > 0
        ? `No record found for "${trimmedQuery}" in this app. Similar names: ${uniqueSuggestions.join(', ')}.`
        : `No record found for "${trimmedQuery}" in this app.`;

    return {
      ok: true,
      appId: config.appId,
      appName: config.appName,
      query: trimmedQuery,
      matches: [],
      suggestions: uniqueSuggestions,
      summary,
    };
  }

  // Deduplicate by (type, id), keeping highest score
  const dedupedMap = new Map<string, ScoredCandidate>();
  for (const cand of strongAuthorized) {
    const key = `${cand.entityDef.type}::${cand.id.toLowerCase()}`;
    const existing = dedupedMap.get(key);
    if (!existing || cand.score > existing.score) {
      dedupedMap.set(key, cand);
    }
  }

  const sorted = Array.from(dedupedMap.values()).sort((a, b) => b.score - a.score);
  const topScore = sorted[0]!.score;

  // Keep all genuinely strong matches close to the top score (so same-name people across
  // students/principals/staff are all listed cleanly without dragging in weaker partial names).
  const keepCutoff =
    topScore >= 0.94
      ? Math.max(0.89, topScore - 0.06)
      : topScore >= 0.9
        ? Math.max(0.75, topScore - 0.14)
        : Math.max(strongThreshold, topScore - 0.15);
  const finalCandidates = sorted.filter((c) => c.score >= keepCutoff).slice(0, 12);

  const matches: EntitySearchMatch[] = finalCandidates.map((c) => ({
    type: c.entityDef.type,
    roleLabel: c.roleLabel,
    id: c.id,
    name: c.name,
    score: c.score,
    matchedField: c.matchedField,
    keyFields: extractKeyFields(c.record, c.entityDef.displayFields),
  }));

  const lines = finalCandidates.map((c, idx) =>
    formatMatchLine(matches[idx]!, c.entityDef.displayFields, c.record)
  );

  let summary: string;
  if (finalCandidates.length === 1) {
    const only = finalCandidates[0]!;
    const detailExtras = only.entityDef.detailFields
      ? formatMatchLine(matches[0]!, only.entityDef.detailFields, only.record).replace(/^- \*\*.*?\*\* \[\*\*.*?\*\*\](?: — )?/, '')
      : '';
    summary = detailExtras
      ? `${lines[0]} (${detailExtras})`
      : lines[0]!;
  } else {
    summary = `Found ${finalCandidates.length} matching records for "${trimmedQuery}":\n${lines.join('\n')}\n\nWhich one is meant?`;
  }

  return {
    ok: true,
    appId: config.appId,
    appName: config.appName,
    query: trimmedQuery,
    matches,
    suggestions: [],
    summary,
  };
}

export async function getEntityDetails(params: {
  config: AssistantEntityConfig;
  collections: Record<string, Array<Record<string, unknown>>>;
  type: string;
  id: string;
  scope?: AccessScope;
}): Promise<EntityDetailsResult> {
  const { config, collections, type, id, scope } = params;
  const entityDef = config.entities.find((e) => e.type.toLowerCase() === type.trim().toLowerCase());

  if (!entityDef) {
    return {
      ok: false,
      appId: config.appId,
      type,
      roleLabel: type,
      id,
      summary: `Unknown entity type "${type}" in ${config.appName}.`,
    };
  }

  const rows = Array.isArray(collections[entityDef.collection])
    ? collections[entityDef.collection]!
    : [];
  const targetIdLower = id.trim().toLowerCase();
  const record = rows.find(
    (r) => String(r[entityDef.idField] ?? '').trim().toLowerCase() === targetIdLower
  );

  if (!record) {
    return {
      ok: false,
      appId: config.appId,
      type: entityDef.type,
      roleLabel: entityDef.label,
      id,
      summary: `No record found for ${entityDef.label} "${id}" in this app.`,
    };
  }

  if (!isRecordVisibleToScope(record, entityDef, scope)) {
    return {
      ok: false,
      denied: true,
      appId: config.appId,
      type: entityDef.type,
      roleLabel: entityDef.label,
      id,
      summary: "You don't have access to that record.",
    };
  }

  const name = String(record[entityDef.nameField] ?? id).trim();
  const roleLabel =
    entityDef.roleField && typeof record[entityDef.roleField] === 'string' && String(record[entityDef.roleField]).trim()
      ? String(record[entityDef.roleField]).trim()
      : entityDef.label;

  const allSpecs = [...entityDef.displayFields, ...(entityDef.detailFields || [])];
  const formattedFields: string[] = [];
  const cleanRecord: Record<string, unknown> = {
    type: entityDef.type,
    roleLabel,
    id: record[entityDef.idField],
    name,
  };

  for (const spec of allSpecs) {
    const val = record[spec.key];
    if (val !== undefined && val !== null && val !== '') {
      cleanRecord[spec.key] = val;
      const formatted = formatFieldValue(val, spec);
      if (formatted !== null) {
        formattedFields.push(`${spec.label}: ${formatted}`);
      }
    }
  }

  const summary = `**${name}** [**${roleLabel}**] — ${formattedFields.join(', ')}`;

  return {
    ok: true,
    appId: config.appId,
    type: entityDef.type,
    roleLabel,
    id: String(record[entityDef.idField] ?? id),
    name,
    record: cleanRecord,
    summary,
  };
}
