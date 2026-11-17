import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DocumentChunk, RetrievedChunk } from '../../schemas.ts';
import type { KitRuntimeConfigLike } from '../../tools/types.ts';
import type { KitLoggerLike } from '../../payments/paymentProvider.ts';
import { tokenizeForEmbedding } from './embedder.ts';

export interface EmbeddedChunk extends DocumentChunk {
  embedding: number[];
}

export interface VectorStore {
  readonly backend: 'supabase' | 'memory';
  upsertChunks(appId: string, chunks: EmbeddedChunk[]): Promise<void>;
  deleteAppChunks(appId: string): Promise<void>;
  query(params: {
    appId: string;
    queryEmbedding: number[];
    queryText: string;
    topK: number;
    minScore: number;
    allowedVisibilities?: Array<'all' | 'manager' | 'admin'>;
  }): Promise<RetrievedChunk[]>;
  count(appId: string): Promise<number>;
}

const silentLogger: KitLoggerLike = {
  info: () => {},
  warn: (obj, msg) => console.warn(msg || '', obj),
  error: (obj, msg) => console.error(msg || '', obj),
};

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function lexicalOverlapScore(queryText: string, chunkText: string, heading: string): number {
  const qTokens = new Set(tokenizeForEmbedding(queryText));
  if (qTokens.size === 0) return 0;
  const docTokens = new Set(tokenizeForEmbedding(`${heading} ${chunkText}`));
  let hits = 0;
  for (const tok of qTokens) {
    if (docTokens.has(tok)) hits += 1;
  }
  return hits / qTokens.size;
}

export class InMemoryVectorStore implements VectorStore {
  readonly backend = 'memory' as const;
  private readonly namespaces = new Map<string, EmbeddedChunk[]>();

  async upsertChunks(appId: string, chunks: EmbeddedChunk[]): Promise<void> {
    const existing = this.namespaces.get(appId) || [];
    const byId = new Map(existing.map((c) => [c.id, c]));
    for (const chunk of chunks) {
      if (chunk.appId !== appId) {
        throw new Error(`Namespace violation: chunk appId "${chunk.appId}" !== "${appId}"`);
      }
      byId.set(chunk.id, chunk);
    }
    this.namespaces.set(appId, Array.from(byId.values()));
  }

  async deleteAppChunks(appId: string): Promise<void> {
    this.namespaces.delete(appId);
  }

  async query(params: {
    appId: string;
    queryEmbedding: number[];
    queryText: string;
    topK: number;
    minScore: number;
    allowedVisibilities?: Array<'all' | 'manager' | 'admin'>;
  }): Promise<RetrievedChunk[]> {
    let appChunks = this.namespaces.get(params.appId) || [];
    if (appChunks.length === 0) return [];

    if (params.allowedVisibilities && params.allowedVisibilities.length > 0) {
      const allowed = new Set(params.allowedVisibilities);
      appChunks = appChunks.filter((c) => allowed.has(c.visibility || 'all'));
    }

    const scored: RetrievedChunk[] = appChunks.map((chunk) => {
      const cos = Math.max(0, cosineSimilarity(params.queryEmbedding, chunk.embedding));
      const lex = lexicalOverlapScore(params.queryText, chunk.content, chunk.heading);
      const combined = Math.min(1, cos * 0.65 + lex * 0.45);
      return {
        id: chunk.id,
        appId: chunk.appId,
        source: chunk.source,
        heading: chunk.heading,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        visibility: chunk.visibility || 'all',
        metadata: chunk.metadata,
        score: Number(combined.toFixed(4)),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, params.topK).filter((item) => item.score >= params.minScore);
  }

  async count(appId: string): Promise<number> {
    return (this.namespaces.get(appId) || []).length;
  }
}

export class SupabaseVectorStore implements VectorStore {
  readonly backend = 'supabase' as const;
  private readonly client: SupabaseClient;
  private readonly fallback = new InMemoryVectorStore();
  private schemaMissing = false;
  private readonly log: KitLoggerLike;

  constructor(url: string, serviceRoleKey: string, logger: KitLoggerLike = silentLogger) {
    this.log = logger;
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  private isMissingSchemaError(error: { code?: string | null; message?: string } | null): boolean {
    if (!error) return false;
    return (
      error.code === 'PGRST205' ||
      error.code === 'PGRST202' ||
      /schema cache/i.test(error.message || '')
    );
  }

  async upsertChunks(appId: string, chunks: EmbeddedChunk[]): Promise<void> {
    await this.fallback.upsertChunks(appId, chunks);
    const rows = chunks.map((c) => ({
      id: c.id,
      app_id: appId,
      source: c.source,
      heading: c.heading,
      chunk_index: c.chunkIndex,
      content: c.content,
      token_count: c.tokenCount,
      metadata: c.metadata || {},
      embedding: c.embedding,
    }));

    const { error } = await this.client.from('assistant_chunks').upsert(rows, { onConflict: 'id' });
    if (error) {
      if (this.isMissingSchemaError(error)) {
        if (!this.schemaMissing) {
          this.schemaMissing = true;
          this.log.warn({ appId }, 'Supabase tables not initialized yet; using in-memory vector store');
        }
      } else {
        this.log.warn({ error, appId }, 'Supabase upsert failed; in-memory store remains active');
      }
      return;
    }
    this.schemaMissing = false;
  }

  async deleteAppChunks(appId: string): Promise<void> {
    await this.fallback.deleteAppChunks(appId);
    if (this.schemaMissing) return;
    const { error } = await this.client.from('assistant_chunks').delete().eq('app_id', appId);
    if (error) {
      if (this.isMissingSchemaError(error)) {
        this.schemaMissing = true;
      } else {
        this.log.warn({ error, appId }, 'Supabase deleteAppChunks failed');
      }
    }
  }

  async query(params: {
    appId: string;
    queryEmbedding: number[];
    queryText: string;
    topK: number;
    minScore: number;
    allowedVisibilities?: Array<'all' | 'manager' | 'admin'>;
  }): Promise<RetrievedChunk[]> {
    if (this.schemaMissing) {
      return this.fallback.query(params);
    }

    const visibilities = params.allowedVisibilities || ['all', 'manager', 'admin'];
    let data: unknown[] | null = null;
    let error: { code?: string | null; message?: string } | null = null;

    const scopedRes = await this.client.rpc('match_assistant_chunks_scoped', {
      query_embedding: params.queryEmbedding,
      filter_app_id: params.appId,
      allowed_visibilities: visibilities,
      match_count: params.topK,
      min_similarity: params.minScore,
    });

    if (!scopedRes.error && Array.isArray(scopedRes.data)) {
      data = scopedRes.data;
    } else {
      const fallbackRes = await this.client.rpc('match_assistant_chunks', {
        query_embedding: params.queryEmbedding,
        filter_app_id: params.appId,
        match_count: params.topK,
        min_similarity: params.minScore,
      });
      data = fallbackRes.data;
      error = fallbackRes.error;
    }

    if (error || !Array.isArray(data)) {
      if (error && this.isMissingSchemaError(error)) {
        this.schemaMissing = true;
      } else {
        this.log.warn({ error, appId: params.appId }, 'Supabase RPC query failed; using in-memory fallback');
      }
      return this.fallback.query(params);
    }

    if (data.length === 0) {
      const fallbackCount = await this.fallback.count(params.appId);
      if (fallbackCount > 0) {
        const { count: remoteCount } = await this.client
          .from('assistant_chunks')
          .select('id', { count: 'exact', head: true })
          .eq('app_id', params.appId);
        if (!remoteCount) {
          return this.fallback.query(params);
        }
      }
    }

    const mapped = (data as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      appId: String(row.app_id),
      source: String(row.source),
      heading: String(row.heading),
      chunkIndex: Number(row.chunk_index || 0),
      content: String(row.content),
      tokenCount: Number(row.token_count || 0),
      visibility: String(row.visibility || 'all') as 'all' | 'manager' | 'admin',
      metadata: (row.metadata as Record<string, unknown>) || {},
      score: Number(Number(row.similarity || 0).toFixed(4)),
    }));

    if (params.allowedVisibilities && params.allowedVisibilities.length > 0) {
      const allowed = new Set(params.allowedVisibilities);
      return mapped.filter((c) => allowed.has(c.visibility || 'all'));
    }

    return mapped;
  }

  async count(appId: string): Promise<number> {
    if (this.schemaMissing) {
      return this.fallback.count(appId);
    }
    const { count, error } = await this.client
      .from('assistant_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', appId);
    if (error || count === null) {
      if (error && this.isMissingSchemaError(error)) {
        this.schemaMissing = true;
      }
      return this.fallback.count(appId);
    }
    return count;
  }
}

export function createVectorStore(
  cfg: KitRuntimeConfigLike,
  logger: KitLoggerLike = silentLogger
): VectorStore {
  const useSupabase =
    cfg.vectorStoreMode === 'supabase' ||
    (cfg.vectorStoreMode === 'auto' && Boolean(cfg.supabaseUrl && cfg.supabaseServiceRoleKey));

  if (useSupabase && cfg.supabaseUrl && cfg.supabaseServiceRoleKey) {
    logger.info({}, 'Using Supabase pgvector store');
    return new SupabaseVectorStore(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, logger);
  }
  logger.info({}, 'Using isolated in-memory vector store');
  return new InMemoryVectorStore();
}
