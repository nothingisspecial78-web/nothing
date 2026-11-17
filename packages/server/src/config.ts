import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  llmProvider: 'auto' | 'openrouter' | 'groq' | 'gemini';
  openRouterApiKey: string;
  groqApiKey: string;
  geminiApiKey: string;
  llmBaseUrl: string;
  modelFast: string;
  modelStrong: string;
  modelVision: string;
  modelEmbedding: string;
  modelFallback: string;
  llmTimeoutMs: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  vectorStoreMode: 'auto' | 'supabase' | 'memory';
  jwtSecret: string;
  confirmationSecret: string;
  rateLimitWindowMs: number;
  rateLimitMaxIp: number;
  rateLimitMaxUser: number;
  uploadMaxBytes: number;
  uploadMaxRows: number;
  responseCacheTtlMs: number;
  profilesDir: string;
  logLevel: string;
  allowDevPlanSwitch: boolean;
  razorpayKeyId: string;
  razorpayKeySecret: string;
  razorpayWebhookSecret: string;
  razorpayTestMode: boolean;
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const modeRaw = (process.env.VECTOR_STORE_MODE || 'auto').toLowerCase();
  const vectorStoreMode: 'auto' | 'supabase' | 'memory' =
    modeRaw === 'supabase' || modeRaw === 'memory' ? modeRaw : 'auto';

  const providerRaw = (process.env.LLM_PROVIDER || 'auto').toLowerCase();
  const llmProvider: ServerConfig['llmProvider'] =
    providerRaw === 'openrouter' || providerRaw === 'groq' || providerRaw === 'gemini'
      ? providerRaw
      : 'auto';

  const testModeRaw = process.env.RAZORPAY_TEST_MODE;
  const razorpayTestMode =
    testModeRaw === undefined ? true : String(testModeRaw).toLowerCase() !== 'false';

  return {
    port: Number(process.env.PORT || 3000),
    nodeEnv: process.env.NODE_ENV || 'development',
    llmProvider,
    openRouterApiKey: process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY || '',
    groqApiKey: process.env.GROQ_API_KEY || '',
    geminiApiKey:
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
        ? process.env.GEMINI_API_KEY
        : '',
    llmBaseUrl: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
    modelFast: process.env.MODEL_FAST || 'openai/gpt-4o-mini',
    modelStrong: process.env.MODEL_STRONG || 'openai/gpt-4o-mini',
    modelVision: process.env.MODEL_VISION || 'openai/gpt-4o-mini',
    modelEmbedding: process.env.MODEL_EMBEDDING || 'openai/text-embedding-3-small',
    modelFallback: process.env.MODEL_FALLBACK || 'openai/gpt-4o-mini',
    llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 25000),
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseServiceRoleKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '',
    vectorStoreMode,
    jwtSecret: process.env.JWT_SECRET || 'dev-change-this-secret-in-production',
    confirmationSecret: process.env.CONFIRMATION_SECRET || 'dev-confirm-hmac-secret',
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
    rateLimitMaxIp: Number(process.env.RATE_LIMIT_MAX_IP || 60),
    rateLimitMaxUser: Number(process.env.RATE_LIMIT_MAX_USER || 40),
    uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES || 10 * 1024 * 1024),
    uploadMaxRows: Number(process.env.UPLOAD_MAX_ROWS || 5000),
    responseCacheTtlMs: Number(process.env.RESPONSE_CACHE_TTL_MS || 300000),
    profilesDir: resolveDefaultProfilesDir(),
    logLevel: process.env.LOG_LEVEL || 'info',
    allowDevPlanSwitch:
      String(process.env.NODE_ENV || '').toLowerCase() !== 'production' &&
      String(process.env.ALLOW_DEV_PLAN_SWITCH || 'true').toLowerCase() === 'true',
    razorpayKeyId: (process.env.RAZORPAY_KEY_ID || '').trim(),
    razorpayKeySecret: (process.env.RAZORPAY_KEY_SECRET || '').trim(),
    razorpayWebhookSecret: (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim(),
    razorpayTestMode,
    ...overrides,
  };
}

function resolveDefaultProfilesDir(): string {
  if (process.env.PROFILES_DIR) {
    return path.resolve(process.cwd(), process.env.PROFILES_DIR);
  }
  const candidates = [
    path.resolve(process.cwd(), 'profiles'),
    path.resolve(import.meta.dirname, '../../../profiles'),
    path.resolve(import.meta.dirname, '../../profiles'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

export const config = loadConfig();

export const logger = pino({
  level: config.nodeEnv === 'test' ? 'silent' : config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-razorpay-signature"]',
      '*.token',
      '*.apiKey',
      '*.password',
      '*.secret',
      '*.keySecret',
      '*.razorpayKeySecret',
      '*.razorpayWebhookSecret',
      '*.webhookSecret',
      '*.razorpay_signature',
      '*.email',
    ],
    censor: '[REDACTED]',
  },
});
