import { z } from 'zod';
import {
  getEntityDetails,
  getRegisteredEntityConfig,
  searchEntities,
} from '../entityRegistry/searchEngine.ts';
import { scopedRepository } from '../db/scopedDataRepository.ts';
import { appInternalFetch, resolveAppBaseUrl } from '../auth.ts';
import type { ToolDefinition, ToolExecutionContext } from './types.ts';

type CollectionRecord = Record<string, unknown>;
type CollectionMap = Record<string, CollectionRecord[]>;

export async function resolveCollectionsForApp(ctx: ToolExecutionContext): Promise<CollectionMap> {
  const config = getRegisteredEntityConfig(ctx.appId);
  const merged: CollectionMap = {};
  if (!config) return merged;

  const activeOrgId =
    (typeof ctx.appState?.activeOrgId === 'string' && ctx.appState.activeOrgId) ||
    (ctx.scope && 'organizationId' in ctx.scope && ctx.scope.organizationId) ||
    'demo';

  const appendRecords = (collectionKey: string, records: CollectionRecord[], idField: string) => {
    const bucket = (merged[collectionKey] ||= []);
    const seenIds = new Set(
      bucket
        .map((r) => String(r[idField] ?? '').trim().toLowerCase())
        .filter(Boolean)
    );
    for (const rec of records) {
      const id = String(rec[idField] ?? '').trim().toLowerCase();
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      bucket.push(rec);
    }
  };

  // 1. Live appState collections (highest priority because they reflect real-time client mutations)
  const appState = ctx.appState || {};
  const explicitCollections =
    appState.collections && typeof appState.collections === 'object'
      ? (appState.collections as Record<string, unknown>)
      : {};

  for (const entityDef of config.entities) {
    const colKey = entityDef.collection;
    const fromExplicit = explicitCollections[colKey];
    if (Array.isArray(fromExplicit)) {
      appendRecords(colKey, fromExplicit as CollectionRecord[], entityDef.idField);
    }
    const fromTopLevel = appState[colKey];
    if (Array.isArray(fromTopLevel)) {
      appendRecords(colKey, fromTopLevel as CollectionRecord[], entityDef.idField);
    }
    if (
      colKey === 'students' &&
      appState.meStudent &&
      typeof appState.meStudent === 'object'
    ) {
      const meStu = appState.meStudent as CollectionRecord;
      const mySummary =
        appState.mySummary && typeof appState.mySummary === 'object'
          ? (appState.mySummary as Record<string, unknown>)
          : {};
      const bal = Number(mySummary.balance ?? meStu.balance ?? 0);
      appendRecords(
        'students',
        [
          {
            ...meStu,
            organizationId: meStu.organizationId || activeOrgId,
            paidTotal: Number(mySummary.credit ?? meStu.paidTotal ?? 0),
            debitTotal: Number(mySummary.debit ?? meStu.debitTotal ?? 0),
            balance: bal,
            pendingFee: bal < 0 ? Math.abs(bal) : 0,
          },
        ],
        entityDef.idField
      );
    }
  }

  // 2. Server-side repository collections for active org (ensures cross-role scope checks & full org coverage)
  if (ctx.appId === 'khazna-ledger' || ctx.appId === 'college-finance') {
    const repoCols = scopedRepository.getEntityCollections();
    for (const entityDef of config.entities) {
      const repoList = repoCols[entityDef.collection];
      if (!Array.isArray(repoList)) continue;
      const orgFiltered =
        ctx.scope?.role === 'SUPER_ADMIN'
          ? repoList
          : repoList.filter((r) => {
              if (!entityDef.orgField || !r[entityDef.orgField]) return true;
              return (
                String(r[entityDef.orgField]).trim().toLowerCase() ===
                activeOrgId.trim().toLowerCase()
              );
            });
      appendRecords(entityDef.collection, orgFiltered, entityDef.idField);
    }
  } else if (ctx.profile?.api?.baseUrl) {
    // Generic REST hydration for plug-and-play external/demo apps when appState didn't inline collections
    await Promise.all(
      config.entities.map(async (entityDef) => {
        if ((merged[entityDef.collection] || []).length > 0) return;
        try {
          const base = resolveAppBaseUrl(ctx.profile.api.baseUrl, ctx.cfg.port, ctx.appId).replace(
            /\/$/,
            ''
          );
          const endpoint = new URL(entityDef.collection, `${base}/`);
          const res = await appInternalFetch(endpoint, {
            method: 'GET',
            headers: {
              'x-app-id': ctx.appId,
              ...(ctx.authToken ? { Authorization: `Bearer ${ctx.authToken}` } : {}),
            },
          });
          if (!res.ok) return;
          const json = (await res.json()) as Record<string, unknown>;
          const list = Array.isArray(json[entityDef.collection])
            ? (json[entityDef.collection] as CollectionRecord[])
            : Array.isArray(json.items)
              ? (json.items as CollectionRecord[])
              : [];
          if (list.length > 0) {
            appendRecords(entityDef.collection, list, entityDef.idField);
          }
        } catch {
          // Optional collection endpoint not present; skip cleanly
        }
      })
    );
  }

  return merged;
}

export const searchEntitiesTool: ToolDefinition = {
  name: 'search_entities',
  description:
    'Search across ALL registered live entity types in this app in parallel (students, teachers, sector managers, principals, office staff, union managers, sectors, books, shelves, leave requests, etc.) using case-insensitive, partial, phonetic, and fuzzy matching. ALWAYS call this first for any question about a person, record, item, amount, status, or location.',
  risk: 'read',
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe('Person name, item title, ID, admission number, phone, email, ISBN, or keyword'),
    types: z
      .array(z.string())
      .optional()
      .describe('Optional filter of entity type names (e.g. ["student", "teacher", "book"])'),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Name, ID, admission number, phone, email, book title, ISBN, or keyword',
      },
      types: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of entity types to restrict search to',
      },
    },
    required: ['query'],
  },
  summarize: (args) => `Search live app entities matching "${String(args.query || '')}"`,
  async execute(args, ctx) {
    const config = getRegisteredEntityConfig(ctx.appId);
    if (!config) {
      return {
        ok: false,
        summary: `No entity registry config found for app "${ctx.appId}".`,
        data: { matches: [] },
      };
    }

    const collections = await resolveCollectionsForApp(ctx);
    const result = await searchEntities({
      config,
      collections,
      query: String(args.query || ''),
      types: Array.isArray(args.types) ? args.types.map(String) : undefined,
      scope: ctx.scope,
    });

    return {
      ok: result.ok,
      summary: result.summary,
      data: result,
    };
  },
};

export const getEntityDetailsTool: ToolDefinition = {
  name: 'get_entity_details',
  description:
    'Fetch the complete live record details for a specific entity (fees paid/pending, class, department, phone, office, shelf/location, leave dates, etc.) by type and id.',
  risk: 'read',
  inputSchema: z.object({
    type: z.string().min(1).describe('Entity type (e.g. student, principal, teacher, sector_manager, office_staff, union_member, book, leave_request)'),
    id: z.string().min(1).describe('Entity ID or slug (e.g. S0135, ADM-01, T01, BK-101)'),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'Entity type name from search_entities' },
      id: { type: 'string', description: 'Entity unique ID' },
    },
    required: ['type', 'id'],
  },
  summarize: (args) => `Get full details for ${String(args.type || 'entity')} ${String(args.id || '')}`,
  async execute(args, ctx) {
    const config = getRegisteredEntityConfig(ctx.appId);
    if (!config) {
      return {
        ok: false,
        summary: `No entity registry config found for app "${ctx.appId}".`,
        data: {},
      };
    }

    const collections = await resolveCollectionsForApp(ctx);
    const result = await getEntityDetails({
      config,
      collections,
      type: String(args.type || ''),
      id: String(args.id || ''),
      scope: ctx.scope,
    });

    return {
      ok: result.ok,
      summary: result.summary,
      data: result,
    };
  },
};

export const ENTITY_TOOLS: Record<string, ToolDefinition> = {
  search_entities: searchEntitiesTool,
  get_entity_details: getEntityDetailsTool,
};
