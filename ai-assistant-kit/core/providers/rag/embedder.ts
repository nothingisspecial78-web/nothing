import OpenAI from 'openai';
import type { KitRuntimeConfigLike } from '../../tools/types.ts';
import type { KitLoggerLike } from '../../payments/paymentProvider.ts';

export interface Embedder {
  readonly mode: 'remote' | 'local';
  embed(texts: string[]): Promise<number[][]>;
  embedOne(text: string): Promise<number[]>;
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'can', 'could', 'may', 'might', 'to', 'of', 'in', 'for', 'on', 'with',
  'at', 'by', 'from', 'as', 'into', 'through', 'during', 'and', 'or',
  'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those', 'what',
  'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'i', 'me', 'my',
  'we', 'our', 'you', 'your', 'it', 'its', 'they', 'their', 'about',
]);

// Generic cross-lingual Malayalam -> English concept bridge for local embeddings
const ML_EN_SYNONYMS: Array<[RegExp, string[]]> = [
  [/ഫണ്ടിംഗ്|ഫണ്ട്/g, ['funding', 'fund', 'source', 'option']],
  [/ഓപ്ഷൻ|തിരഞ്ഞെടുക്ക/g, ['option', 'select', 'choose']],
  [/ഇംപോർട്ട്|എക്സൽ/g, ['import', 'excel', 'csv', 'upload']],
  [/ഫീസ്|തുക/g, ['fee', 'fees', 'amount', 'payment']],
  [/ലോഗിൻ|അക്കൗണ്ട്/g, ['login', 'account', 'signin']],
  [/ലിസ്റ്റ്|വിവരങ്ങൾ/g, ['list', 'details', 'records']],
];

function fnv1aHash(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function tokenizeForEmbedding(
  text: string,
  extraSynonyms: Array<[RegExp, string[]]> = []
): string[] {
  let expanded = text.toLowerCase();
  for (const [pattern, extras] of [...ML_EN_SYNONYMS, ...extraSynonyms]) {
    if (pattern.test(expanded)) {
      expanded += ' ' + extras.join(' ');
    }
  }
  const rawTokens = expanded
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  const out: string[] = [];
  for (const tok of rawTokens) {
    out.push(tok);
    const stem = tok.replace(/(ing|ed|es|s)$/, '');
    if (stem.length >= 3 && stem !== tok) {
      out.push(stem);
    }
  }
  return out;
}

export function computeLocalEmbedding(text: string, dims = 1536): number[] {
  const vec = new Float64Array(dims);
  const tokens = tokenizeForEmbedding(text);
  if (tokens.length === 0) {
    return Array.from(vec);
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    const idx = fnv1aHash(`u:${tok}`) % dims;
    const sign = (fnv1aHash(`s:${tok}`) & 1) === 0 ? 1 : -1;
    vec[idx] += sign * 1.5;

    if (i + 1 < tokens.length) {
      const bigram = `${tok}_${tokens[i + 1]}`;
      const bIdx = fnv1aHash(`b:${bigram}`) % dims;
      const bSign = (fnv1aHash(`bs:${bigram}`) & 1) === 0 ? 1 : -1;
      vec[bIdx] += bSign * 0.9;
    }

    if (tok.length >= 4) {
      for (let c = 0; c <= tok.length - 4; c += 1) {
        const tri = tok.slice(c, c + 4);
        const cIdx = fnv1aHash(`c:${tri}`) % dims;
        vec[cIdx] += 0.25;
      }
    }
  }

  let norm = 0;
  for (let i = 0; i < dims; i += 1) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return Array.from(vec);

  const normalized = new Array<number>(dims);
  for (let i = 0; i < dims; i += 1) {
    normalized[i] = vec[i] / norm;
  }
  return normalized;
}

const silentLogger: KitLoggerLike = {
  info: () => {},
  warn: (obj, msg) => console.warn(msg || '', obj),
  error: (obj, msg) => console.error(msg || '', obj),
};

export function createEmbedder(
  cfg: KitRuntimeConfigLike,
  logger: KitLoggerLike = silentLogger
): Embedder {
  const openRouterClient = cfg.openRouterApiKey
    ? new OpenAI({
        apiKey: cfg.openRouterApiKey,
        baseURL: cfg.llmBaseUrl,
        timeout: cfg.llmTimeoutMs,
      })
    : null;

  const geminiClient = cfg.geminiApiKey
    ? new OpenAI({
        apiKey: cfg.geminiApiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        timeout: cfg.llmTimeoutMs,
      })
    : null;

  const hasRemoteKey = Boolean(openRouterClient || geminiClient);
  const embeddingCache = new Map<string, { vector: number[]; timestamp: number }>();
  const MAX_CACHE_SIZE = 500;
  const CACHE_TTL_MS = 10 * 60 * 1000;

  return {
    mode: hasRemoteKey ? 'remote' : 'local',

    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      if (openRouterClient) {
        try {
          const response = await openRouterClient.embeddings.create({
            model: cfg.modelEmbedding,
            input: texts,
          });
          return response.data.map((item) => item.embedding);
        } catch (err) {
          logger.warn({ err }, 'OpenRouter embedding failed; trying next embedding provider');
        }
      }

      if (geminiClient) {
        try {
          const response = await geminiClient.embeddings.create({
            model: 'gemini-embedding-001',
            input: texts,
            dimensions: 1536,
          });
          return response.data.map((item) => item.embedding);
        } catch (err) {
          logger.warn({ err }, 'Gemini embedding failed; falling back to local embeddings');
        }
      }

      return texts.map((t) => computeLocalEmbedding(t));
    },

    async embedOne(text: string): Promise<number[]> {
      const cleanKey = text.trim().slice(0, 1000);
      const cached = embeddingCache.get(cleanKey);
      const now = Date.now();
      if (cached && now - cached.timestamp < CACHE_TTL_MS) {
        return cached.vector;
      }

      const [first] = await this.embed([text]);
      const vec = first || computeLocalEmbedding(text);

      if (embeddingCache.size >= MAX_CACHE_SIZE) {
        const oldestKey = embeddingCache.keys().next().value;
        if (oldestKey) embeddingCache.delete(oldestKey);
      }
      embeddingCache.set(cleanKey, { vector: vec, timestamp: now });
      return vec;
    },
  };
}
