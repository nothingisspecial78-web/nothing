import type { z } from 'zod';
import type { AppProfile, CursorWaypoint, ExportFilePayload, FormRequest } from '../schemas.ts';
import type { ActionLogStore } from '../security/confirmation.ts';
import type { AccessScope } from '../security/scope.ts';

export interface KitRuntimeConfigLike {
  appName?: string;
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
  providerOrder?: Array<'openrouter' | 'gemini' | 'groq'>;
  retriesPerProvider?: number;
}

export interface AssistantTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown>;
}

export interface ToolExecutionContext {
  appId: string;
  profile: AppProfile;
  userId: string;
  authToken: string;
  cfg: KitRuntimeConfigLike;
  actionStore: ActionLogStore;
  appState?: Record<string, unknown>;
  scope?: AccessScope;
  conversationId?: string;
}

export interface UiActionPayload {
  action: 'click' | 'refresh' | 'set_value';
  selector?: string;
  fallbackTabSelector?: string;
  value?: string;
  highlightSelector?: string;
  refreshApp?: boolean;
  followUpActions?: Array<{
    action: 'click' | 'set_value';
    selector: string;
    value?: string;
  }>;
  appCommand?: {
    command: string;
    payload: Record<string, unknown>;
  };
  cursorWaypoints?: CursorWaypoint[];
  label: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  summary: string;
  data: unknown;
  createdIds?: string[];
  uiAction?: UiActionPayload;
  formRequest?: FormRequest;
  exportFile?: ExportFilePayload;
  followUpChips?: Array<{ id: string; label: string; prompt: string }>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  risk: 'read' | 'write';
  uiTrigger?: boolean;
  autoExecute?: boolean;
  allowedRoles?: string[];
  inputSchema: z.ZodTypeAny;
  jsonParameters: Record<string, unknown>;
  summarize(args: Record<string, unknown>): string;
  execute(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolExecutionResult>;
  undo?(createdIds: string[], args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolExecutionResult>;
}
