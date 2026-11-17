import { z } from 'zod';

// ==============================================================================
// App Profile Schemas (multi-tenant configuration per connected web app)
// ==============================================================================

export const ToolParameterPropertySchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'array']),
  description: z.string(),
  required: z.boolean().optional(),
  enum: z.array(z.string()).optional(),
});

export const DeclarativeToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  risk: z.enum(['read', 'write']),
  autoExecute: z.boolean().optional(),
  tabSelector: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  path: z.string().min(1),
  undoPath: z.string().optional(),
  summaryTemplate: z.string().optional(),
  parameters: z.record(z.string(), ToolParameterPropertySchema).default({}),
});

export const AppProfileSchema = z.object({
  appId: z.string().min(1).regex(/^[a-z0-9-]+$/),
  displayName: z.string().min(1),
  systemPrompt: z.string().min(1),
  languages: z.array(z.string()).min(1).default(['en']),
  refusalMessage: z.string().min(1),
  retrieval: z
    .object({
      topK: z.number().int().min(1).max(20).default(5),
      minScore: z.number().min(0).max(1).default(0.35),
    })
    .default({ topK: 5, minScore: 0.35 }),
  tools: z.array(z.string()).default([]),
  customTools: z.array(DeclarativeToolSchema).default([]),
  api: z.object({
    baseUrl: z.string().min(1),
    meEndpoint: z.string().optional(),
  }),
  auth: z
    .object({
      mode: z.enum(['jwt', 'me', 'hybrid', 'none']).default('hybrid'),
      jwtSecretEnv: z.string().optional(),
    })
    .default({ mode: 'hybrid' }),
  corsOrigins: z.array(z.string()).default(['*']),
  templates: z.array(z.string()).default([]),
});

export type AppProfile = z.infer<typeof AppProfileSchema>;
export type DeclarativeToolDefinition = z.infer<typeof DeclarativeToolSchema>;

// ==============================================================================
// Context Capture & Chat Schemas
// ==============================================================================

export const RightClickContextSchema = z.object({
  tag: z.string().max(40).optional(),
  text: z.string().max(500).optional(),
  nearbyLabel: z.string().max(300).optional(),
  cssSelector: z.string().max(400).optional(),
  routePath: z.string().max(300).optional(),
  selectedText: z.string().max(1000).optional(),
  pageTitle: z.string().max(200).optional(),
});

export type RightClickContext = z.infer<typeof RightClickContextSchema>;

export const ChatAttachmentSchema = z.object({
  type: z.enum(['image', 'file']),
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  dataUrl: z.string().optional(),
  uploadId: z.string().optional(),
  previewSummary: z.string().max(2000).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  pageCount: z.number().int().nonnegative().optional(),
  sheetNames: z.array(z.string()).optional(),
  selectedSheet: z.string().optional(),
  geminiFileUri: z.string().optional(),
  extractedText: z.string().max(40000).optional(),
  sha256: z.string().optional(),
});

export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().max(20000),
  context: RightClickContextSchema.optional(),
  contexts: z.array(RightClickContextSchema).max(5).optional(),
  attachments: z.array(ChatAttachmentSchema).max(5).optional(),
  createdAt: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const PersonalizationSettingsSchema = z.object({
  displayName: z.string().max(80).optional(),
  tone: z.enum(['balanced', 'concise', 'detailed', 'friendly']).default('balanced'),
  preferredLanguage: z.enum(['auto', 'en', 'ml']).default('auto'),
  customInstructions: z.string().max(600).optional(),
  voiceAutoSend: z.boolean().default(false),
});

export type PersonalizationSettings = z.infer<typeof PersonalizationSettingsSchema>;

export const CursorWaypointSchema = z.object({
  label: z.string().min(1).max(120),
  selector: z.string().max(300).optional(),
  textMatch: z.string().max(120).optional(),
  xPercent: z.number().min(0).max(100).optional(),
  yPercent: z.number().min(0).max(100).optional(),
  action: z.enum(['move', 'click', 'type']).default('move'),
  value: z.string().max(200).optional(),
  delayMs: z.number().int().min(50).max(2000).optional(),
});

export type CursorWaypoint = z.infer<typeof CursorWaypointSchema>;

export const FormFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'number', 'date', 'select', 'textarea', 'password', 'email']),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export type FormField = z.infer<typeof FormFieldSchema>;

export const FormRequestSchema = z.object({
  formId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  submitLabel: z.string().default('Submit'),
  command: z.string().min(1),
  presetPayload: z.record(z.string(), z.unknown()).optional(),
  fields: z.array(FormFieldSchema).min(1),
});

export type FormRequest = z.infer<typeof FormRequestSchema>;

export const ChatRequestSchema = z.object({
  appId: z.string().min(1).regex(/^[a-z0-9-]+$/),
  messages: z.array(ChatMessageSchema).min(1).max(50),
  context: RightClickContextSchema.optional(),
  contexts: z.array(RightClickContextSchema).max(5).optional(),
  attachments: z.array(ChatAttachmentSchema).max(5).optional(),
  language: z.string().max(10).optional(),
  appState: z.record(z.string(), z.unknown()).optional(),
  personalization: PersonalizationSettingsSchema.optional(),
  conversationId: z.string().optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// ==============================================================================
// Sheet Template & File Import Preview Schemas
// ==============================================================================

export const SheetColumnRuleSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  type: z.enum(['string', 'number', 'email', 'date', 'enum']),
  required: z.boolean().default(false),
  enumValues: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().int().optional(),
  maxLength: z.number().int().optional(),
  pattern: z.string().optional(),
});

export const SheetTemplateSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  targetTool: z.string().min(1),
  columns: z.array(SheetColumnRuleSchema).min(1),
});

export type SheetColumnRule = z.infer<typeof SheetColumnRuleSchema>;
export type SheetTemplate = z.infer<typeof SheetTemplateSchema>;

export const ColumnMappingSuggestionSchema = z.object({
  expectedKey: z.string(),
  expectedLabel: z.string(),
  matchedHeader: z.string().nullable(),
  confidence: z.enum(['exact', 'alias', 'fuzzy', 'missing']),
  suggestions: z.array(z.string()),
});

export const ImportRowErrorSchema = z.object({
  rowNumber: z.number().int(),
  raw: z.record(z.string(), z.unknown()),
  reasons: z.array(z.string()),
});

export const ImportValidRowSchema = z.object({
  rowNumber: z.number().int(),
  data: z.record(z.string(), z.unknown()),
});

export const ImportPreviewResultSchema = z.object({
  uploadId: z.string(),
  appId: z.string(),
  fileName: z.string(),
  templateId: z.string(),
  targetTool: z.string(),
  totalRows: z.number().int(),
  validCount: z.number().int(),
  invalidCount: z.number().int(),
  detectedHeaders: z.array(z.string()),
  columnMapping: z.array(ColumnMappingSuggestionSchema),
  validRows: z.array(ImportValidRowSchema),
  errors: z.array(ImportRowErrorSchema),
  truncated: z.boolean(),
  confirmationToken: z.string().optional(),
  actionId: z.string().optional(),
  formatMatched: z.boolean().optional(),
  missingRequiredColumns: z.array(z.string()).optional(),
  duplicateCount: z.number().int().optional(),
  permissionError: z.string().optional(),
  sheetNames: z.array(z.string()).optional(),
  selectedSheet: z.string().optional(),
  headerRowIndex: z.number().int().nonnegative().optional(),
  normalizedPreview: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type ColumnMappingSuggestion = z.infer<typeof ColumnMappingSuggestionSchema>;
export type ImportRowError = z.infer<typeof ImportRowErrorSchema>;
export type ImportValidRow = z.infer<typeof ImportValidRowSchema>;
export type ImportPreviewResult = z.infer<typeof ImportPreviewResultSchema>;

// ==============================================================================
// RAG & Retrieval Types
// ==============================================================================

export interface DocumentChunk {
  id: string;
  appId: string;
  source: string;
  heading: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  visibility?: 'all' | 'manager' | 'admin';
  metadata?: Record<string, unknown>;
}

export interface RetrievedChunk extends DocumentChunk {
  score: number;
}

export interface SourceCitation {
  source: string;
  heading: string;
  score: number;
}

// ==============================================================================
// Agent Actions, Confirmation & Audit Log Schemas
// ==============================================================================

export const ConfirmActionRequestSchema = z.object({
  appId: z.string().min(1),
  confirmationToken: z.string().min(1),
  decision: z.enum(['confirm', 'cancel']).default('confirm'),
  columnOverrides: z.record(z.string(), z.string()).optional(),
  sheetName: z.string().optional(),
  idempotencyKey: z.string().max(120).optional(),
  appState: z.record(z.string(), z.unknown()).optional(),
});

export type ConfirmActionRequest = z.infer<typeof ConfirmActionRequestSchema>;

export interface WidgetBillingStatus {
  orgId: string;
  plan: 'free' | 'premium';
  effectivePlan: 'free' | 'premium';
  planInterval: 'monthly' | 'annual' | null;
  status: 'active' | 'cancelled' | 'expired';
  premiumStartedAt: string | null;
  premiumExpiresAt: string | null;
  daysUntilExpiry?: number | null;
  expiringSoon?: boolean;
  creditsRemaining: number;
  creditsMonthlyAllowance: number;
  periodStart: string;
  periodEnd: string;
  role: string;
  isAdmin: boolean;
  canUseAssistant: boolean;
  lockedReason: 'UPGRADE_REQUIRED' | 'CREDITS_EXHAUSTED' | null;
  devSwitchEnabled: boolean;
  razorpay?: {
    configured: boolean;
    testMode: boolean;
    liveKeyBlocked: boolean;
    webhookConfigured: boolean;
  };
  persistence?: {
    backend: 'supabase' | 'memory';
    schemaReady: boolean;
    lastError?: string;
  };
}

export const ActionLogEntrySchema = z.object({
  id: z.string(),
  appId: z.string(),
  userId: z.string(),
  toolName: z.string(),
  risk: z.enum(['read', 'write']),
  status: z.enum(['pending', 'confirmed', 'executed', 'failed', 'undone', 'cancelled']),
  summary: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.unknown().optional(),
  createdIds: z.array(z.string()).default([]),
  createdAt: z.string(),
  executedAt: z.string().optional(),
  undoneAt: z.string().optional(),
});

export type ActionLogEntry = z.infer<typeof ActionLogEntrySchema>;

// ==============================================================================
// Assistant-Generated Downloadable Export Schemas
// ==============================================================================

export const ExportFormatSchema = z.enum(['xlsx', 'pdf', 'csv', 'docx', 'json', 'txt']);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const ExportColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  format: z.enum(['text', 'currency', 'date', 'array', 'boolean']).optional(),
});
export type ExportColumn = z.infer<typeof ExportColumnSchema>;

export const ExportFilePayloadSchema = z.object({
  exportId: z.string().min(1),
  title: z.string().min(1),
  filename: z.string().min(1),
  format: ExportFormatSchema,
  columns: z.array(ExportColumnSchema).min(1),
  rows: z.array(z.record(z.string(), z.unknown())),
  previewRows: z.array(z.record(z.string(), z.unknown())).max(5),
  totalRows: z.number().int().min(0),
  exportedRows: z.number().int().min(0),
  truncated: z.boolean().default(false),
  rowLimit: z.number().int().min(1).default(5000),
  generatedAt: z.string(),
  entityType: z.string().optional(),
  summaryLine: z.string(),
});
export type ExportFilePayload = z.infer<typeof ExportFilePayloadSchema>;

// ==============================================================================
// SSE Streaming Event Union
// ==============================================================================

export type AssistantSseEvent =
  | { type: 'status'; phase: string; label: string }
  | { type: 'token'; delta: string }
  | { type: 'stream_reset'; reason?: string }
  | {
      type: 'start_guide';
      guideId: string;
      startStep?: string;
    }
  | {
      type: 'follow_up_chips';
      chips: Array<{ id: string; label: string; prompt: string }>;
    }
  | {
      type: 'export_file';
      exportFile: ExportFilePayload;
    }
  | {
      type: 'tool_call';
      toolName: string;
      risk: 'read' | 'write';
      args: Record<string, unknown>;
      status: 'running' | 'completed' | 'failed';
      summary?: string;
    }
  | {
      type: 'confirmation_required';
      actionId: string;
      confirmationToken: string;
      toolName: string;
      summary: string;
      details: Record<string, unknown>;
      expiresAt: string;
    }
  | {
      type: 'ui_action';
      actionId: string;
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
  | {
      type: 'form_request';
      form: FormRequest;
    }
  | {
      type: 'action_executed';
      actionId: string;
      toolName: string;
      summary: string;
      details?: Record<string, unknown>;
      canUndo: boolean;
      action?: ActionLogEntry;
    }
  | {
      type: 'source';
      sources: SourceCitation[];
    }
  | {
      type: 'done';
      refusal: boolean;
      model: string;
      latencyMs: number;
      sources: SourceCitation[];
      actionLogId?: string;
      cached?: boolean;
      provider?: string;
    }
  | {
      type: 'error';
      message: string;
      code?: string;
    };

// ==============================================================================
// Evaluation Suite Schema
// ==============================================================================

export const EvalCaseSchema = z.object({
  id: z.string(),
  question: z.string(),
  expectedScope: z.enum(['in-scope', 'out-of-scope']),
  expectedKeywords: z.array(z.string()).default([]),
  context: RightClickContextSchema.optional(),
});

export const EvalSuiteSchema = z.object({
  appId: z.string(),
  cases: z.array(EvalCaseSchema),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalSuite = z.infer<typeof EvalSuiteSchema>;

// ==============================================================================
// Guide Me Interactive Co-Browsing Schemas (DOM-Based, Token-Minimized)
// ==============================================================================

export const GuideStepActionSchema = z.enum([
  'navigate',
  'point_and_wait',
  'click_safe',
  'complete',
  'ask_user',
  'refresh_and_retry',
]);

export type GuideStepAction = z.infer<typeof GuideStepActionSchema>;

export const GuideQuickReplySchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(60),
  value: z.string().min(1).max(160),
  variant: z.enum(['primary', 'secondary', 'danger']).optional(),
});

export type GuideQuickReply = z.infer<typeof GuideQuickReplySchema>;

export const GuideTroubleshootingContextSchema = z.object({
  errorText: z.string().max(300).default(''),
  questionAsked: z.string().max(300).default(''),
  stage: z.enum(['diagnostic', 'follow_up_guide']),
});

export type GuideTroubleshootingContext = z.infer<typeof GuideTroubleshootingContextSchema>;

export const GuideClarificationOptionSchema = z.object({
  id: z.string().min(1).max(160),
  label: z.string().min(1).max(80),
  description: z.string().max(140).optional(),
  refinedGoal: z.string().min(1).max(300),
  targetId: z.string().max(160).optional(),
  route: z.string().max(300).optional(),
});

export type GuideClarificationOption = z.infer<typeof GuideClarificationOptionSchema>;

export const AvailableRouteHintSchema = z.object({
  route: z.string().min(1).max(300),
  label: z.string().min(1).max(100),
});

export type AvailableRouteHint = z.infer<typeof AvailableRouteHintSchema>;

export const PageMapElementSchema = z.object({
  id: z.string().min(1).max(200),
  tag: z.string().min(1).max(32),
  type: z.string().min(1).max(40),
  label: z.string().max(180),
  hasValue: z.boolean(),
  currentRoute: z.string().max(320),
  sensitive: z.boolean().optional(),
});

export type PageMapElement = z.infer<typeof PageMapElementSchema>;

export const GuideStepRequestSchema = z.object({
  goal: z.string().min(1).max(800),
  previousStepSummary: z.string().max(1600).default(''),
  stepNumber: z.number().int().min(1).max(20).default(1),
  currentRoute: z.string().max(320).default('/'),
  pageMap: z.array(PageMapElementSchema).max(200),
  confirmedPath: z.boolean().optional(),
  preferredTargetId: z.string().max(200).optional(),
  preferredRoute: z.string().max(320).optional(),
  availableRoutes: z.array(AvailableRouteHintSchema).max(60).optional(),
  appContext: z.string().max(600).optional(),
  pageErrors: z.array(z.string().max(240)).max(5).optional(),
  userReply: z.string().max(400).optional(),
  troubleshootingContext: GuideTroubleshootingContextSchema.optional(),
});

export type GuideStepRequest = z.infer<typeof GuideStepRequestSchema>;

export const GuideStepResponseSchema = z.object({
  action: z.enum([
    'navigate',
    'point_and_wait',
    'click_safe',
    'complete',
    'clarify',
    'ask_user',
    'refresh_and_retry',
  ]),
  targetId: z.string().max(160).optional(),
  route: z.string().max(300).optional(),
  tip: z.string().min(1).max(180),
  question: z.string().max(280).optional(),
  askStage: z.enum(['diagnostic', 'follow_up_guide']).optional(),
  quickReplies: z.array(GuideQuickReplySchema).max(6).optional(),
  refreshApp: z.boolean().optional(),
  options: z.array(GuideClarificationOptionSchema).max(6).optional(),
  totalSteps: z.number().int().min(1).max(20).optional(),
  sensitiveBlocked: z.boolean().optional(),
  provider: z.string().optional(),
});

export type GuideStepResponse = z.infer<typeof GuideStepResponseSchema>;


