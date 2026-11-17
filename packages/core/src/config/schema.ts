import { z } from 'zod';

// ==============================================================================
// 1. App Configuration Schema
// ==============================================================================
export const AppConfigSchema = z.object({
  id: z.string().min(1, 'App ID is required').regex(/^[a-z0-9-_]+$/, 'App ID must be lowercase alphanumeric with hyphens/underscores'),
  name: z.string().min(1, 'App name is required'),
  logo: z.string().optional(),
  languages: z.array(z.string()).min(1, 'At least one language must be specified').default(['en']),
  defaultLocale: z.string().default('en'),
  tone: z.string().default('helpful, professional, and concise'),
  scopeRules: z.string().default('Answer only about this app and its data. Politely decline unrelated requests.'),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// ==============================================================================
// 2. Theme Configuration Schema
// ==============================================================================
export const ThemeColorsSchema = z.object({
  primary: z.string().default('#0ea5e9'),
  primaryText: z.string().default('#ffffff'),
  accent: z.string().default('#38bdf8'),
  surface: z.string().default('#ffffff'),
  background: z.string().default('#f8fafc'),
  text: z.string().default('#0f172a'),
  textMuted: z.string().default('#64748b'),
  border: z.string().default('#e2e8f0'),
});

export const ThemeRadiiSchema = z.object({
  sm: z.string().default('4px'),
  md: z.string().default('8px'),
  lg: z.string().default('16px'),
  full: z.string().default('9999px'),
});

export const ThemeFontsSchema = z.object({
  body: z.string().default('system-ui, -apple-system, sans-serif'),
  heading: z.string().default('inherit'),
  mono: z.string().default('ui-monospace, monospace'),
});

export const ThemeLauncherSchema = z.object({
  position: z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left', 'right', 'left']).default('bottom-right'),
  icon: z.string().optional(),
  label: z.string().optional(),
});

export const ThemeConfigSchema = z.object({
  mode: z.enum(['light', 'dark', 'auto']).default('auto'),
  colors: ThemeColorsSchema.default({}),
  radii: ThemeRadiiSchema.default({}),
  fonts: ThemeFontsSchema.default({}),
  launcher: ThemeLauncherSchema.default({}),
});

export type ThemeConfig = z.infer<typeof ThemeConfigSchema>;

// ==============================================================================
// 3. User / Auth Configuration Schema
// ==============================================================================
export const AuthConfigSchema = z.object({
  mode: z.enum(['jwt', 'session', 'custom', 'none']).default('custom'),
  headerName: z.string().default('authorization'),
  orgField: z.string().default('organizationId'),
  roleField: z.string().default('role'),
  userIdField: z.string().default('id'),
});

export type AuthConfig = z.infer<typeof AuthConfigSchema>;

// ==============================================================================
// 4. Roles Configuration Schema
// ==============================================================================
export const RoleDefinitionSchema = z.object({
  name: z.string().min(1, 'Role name is required'),
  label: z.string().optional(),
  description: z.string().optional(),
  permissions: z.array(z.string()).default([]),
  canExport: z.boolean().default(false),
  canImport: z.boolean().default(false),
  canExecuteActions: z.boolean().default(false),
});

export type RoleDefinition = z.infer<typeof RoleDefinitionSchema>;

// ==============================================================================
// 5. Entities (Entity Registry) Configuration Schema
// ==============================================================================
export const EntityFieldSpecSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  format: z.enum(['text', 'currency', 'date', 'array', 'boolean']).default('text'),
});

export const EntityDefinitionSchema = z.object({
  type: z.string().min(1, 'Entity type identifier is required'),
  label: z.string().min(1, 'Entity human label is required'),
  pluralLabel: z.string().optional(),
  collection: z.string().min(1, 'Collection/table name is required'),
  idField: z.string().min(1).default('id'),
  nameField: z.string().min(1).default('name'),
  nameLabel: z.string().optional(),
  defaultExportColumns: z.array(z.string()).optional(),
  sensitiveFields: z.array(z.string()).default(['password', 'passwordHash', 'token', 'secret', 'apiKey']),
  roleField: z.string().optional(),
  orgField: z.string().optional(),
  sectorField: z.string().optional(),
  ownerIdField: z.string().optional(),
  searchableFields: z.array(z.string()).min(1, 'At least one searchable field is required'),
  displayFields: z.array(EntityFieldSpecSchema).min(1, 'At least one display field is required'),
  detailFields: z.array(EntityFieldSpecSchema).optional(),
  visibilityRules: z.record(z.string(), z.enum(['all', 'org', 'sector', 'self', 'none'])).default({}),
  importFieldMapping: z.record(z.string(), z.string()).optional(),
});

export type EntityDefinition = z.infer<typeof EntityDefinitionSchema>;

// ==============================================================================
// 6. Pages & Context Configuration Schema
// ==============================================================================
export const PageActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  labelMl: z.string().optional(),
  labelAr: z.string().optional(),
  prompt: z.string().min(1),
  promptMl: z.string().optional(),
  promptAr: z.string().optional(),
  roles: z.array(z.string()).optional(),
  icon: z.string().optional(),
  priority: z.number().optional(),
});

export const PageConfigSchema = z.object({
  pageId: z.string().min(1, 'pageId is required'),
  title: z.string().min(1, 'page title is required'),
  description: z.string().optional(),
  routePatterns: z.array(z.string()).min(1, 'At least one route pattern is required'),
  actions: z.array(PageActionSchema).default([]),
  suggestedPrompts: z.array(z.string()).optional(),
});

export type PageConfig = z.infer<typeof PageConfigSchema>;

// ==============================================================================
// 7. Actions (Tools) Configuration Schema
// ==============================================================================
export const ActionParameterPropertySchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
  description: z.string(),
  required: z.boolean().optional(),
  enum: z.array(z.string()).optional(),
});

export const ActionDefinitionSchema = z.object({
  name: z.string().min(1, 'Action name is required'),
  description: z.string().min(1, 'Action description is required'),
  roles: z.array(z.string()).default(['*']),
  confirmRequired: z.boolean().default(false),
  parameters: z.record(z.string(), ActionParameterPropertySchema).default({}),
  endpoint: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
});

export type ActionDefinition = z.infer<typeof ActionDefinitionSchema>;

// ==============================================================================
// 8. Plans & Billing Configuration Schema
// ==============================================================================
export const PlanRulesSchema = z.object({
  creditAllowance: z.number().int().nonnegative().default(100),
  priceMonthly: z.number().nonnegative().default(0),
  priceAnnual: z.number().nonnegative().default(0),
  features: z.array(z.string()).default([]),
});

export const PlansConfigSchema = z.object({
  free: PlanRulesSchema.default({ creditAllowance: 50, priceMonthly: 0, priceAnnual: 0, features: ['basic_chat', 'search'] }),
  premium: PlanRulesSchema.default({ creditAllowance: 1000, priceMonthly: 499, priceAnnual: 4990, features: ['all_tools', 'unlimited_export', 'voice', 'co_browser'] }),
  currency: z.string().default('INR'),
  perActionCreditCosts: z.record(z.string(), z.number().int().nonnegative()).default({
    chat: 1,
    export: 2,
    import: 5,
    action: 3,
  }),
});

export type PlansConfig = z.infer<typeof PlansConfigSchema>;

// ==============================================================================
// 9. AI Configuration Schema
// ==============================================================================
export const AiConfigSchema = z.object({
  providerOrder: z.array(z.enum(['gemini', 'openai', 'groq', 'anthropic', 'custom'])).default(['gemini', 'openai']),
  models: z.object({
    default: z.string().default('gemini-2.5-flash'),
    fast: z.string().default('gemini-2.5-flash'),
    reasoning: z.string().default('gemini-2.5-pro'),
  }).default({}),
  timeoutMs: z.number().int().positive().default(30000),
  systemPromptAdditions: z.string().optional(),
  safetySettings: z.record(z.string(), z.string()).optional(),
});

export type AiConfig = z.infer<typeof AiConfigSchema>;

// ==============================================================================
// 10. Feature Flags Schema
// ==============================================================================
export const FeaturesConfigSchema = z.object({
  chips: z.boolean().default(true),
  export: z.boolean().default(true),
  attachments: z.boolean().default(true),
  import: z.boolean().default(true),
  voice: z.boolean().default(false),
  payments: z.boolean().default(true),
  avatar3d: z.boolean().default(true),
  coBrowserGuide: z.boolean().default(true),
});

export type FeaturesConfig = z.infer<typeof FeaturesConfigSchema>;

// ==============================================================================
// 11. Knowledge / RAG Extension Point Schema
// ==============================================================================
export const KnowledgeDocSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  content: z.string().optional(),
  uri: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type KnowledgeDoc = z.infer<typeof KnowledgeDocSchema>;

// ==============================================================================
// MASTER UNIVERSAL ASSISTANT CONFIG SCHEMA
// ==============================================================================
const RawAssistantConfigSchema = z.object({
  app: AppConfigSchema.optional(),
  appId: z.string().optional(),
  appName: z.string().optional(),
  theme: ThemeConfigSchema.default({}),
  auth: AuthConfigSchema.default({}),
  roles: z.union([z.array(RoleDefinitionSchema), z.record(z.string(), RoleDefinitionSchema)]).default([]),
  entities: z.array(EntityDefinitionSchema).default([]),
  pages: z.array(PageConfigSchema).default([]),
  generalChips: z.array(PageActionSchema).default([]),
  actions: z.array(ActionDefinitionSchema).default([]),
  plans: PlansConfigSchema.default({}),
  ai: AiConfigSchema.default({}),
  features: FeaturesConfigSchema.default({}),
  knowledge: z.array(KnowledgeDocSchema).default([]),
});

export const AssistantConfigSchema = RawAssistantConfigSchema.transform((data) => {
  const resolvedApp = data.app || {
    id: data.appId || 'default-app',
    name: data.appName || data.appId || 'Default App',
    languages: ['en'],
    defaultLocale: 'en',
    tone: 'helpful, professional, and concise',
    scopeRules: 'Answer only questions about this application.',
  };

  return {
    ...data,
    app: resolvedApp,
    appId: data.appId || resolvedApp.id,
    appName: data.appName || resolvedApp.name,
  };
});


export type AssistantConfig = z.infer<typeof AssistantConfigSchema>;

// ==============================================================================
// Validation Helper with Readable Error Formatting
// ==============================================================================
export interface ConfigValidationResult {
  valid: boolean;
  config?: AssistantConfig;
  errors?: string[];
  summary?: string;
}

export function validateAssistantConfig(raw: unknown): ConfigValidationResult {
  const result = AssistantConfigSchema.safeParse(raw);
  if (result.success) {
    return {
      valid: true,
      config: result.data,
    };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.') || 'root';
    return `[${path}]: ${issue.message}`;
  });

  const summary = `AssistantConfig validation failed with ${errors.length} error(s):\n  - ${errors.join('\n  - ')}`;

  return {
    valid: false,
    errors,
    summary,
  };
}

/**
 * Type-safe configuration builder helper that validates on definition
 */
export function defineAssistantConfig(config: z.input<typeof AssistantConfigSchema>): AssistantConfig {
  const validation = validateAssistantConfig(config);
  if (!validation.valid || !validation.config) {
    throw new Error(validation.summary || 'Invalid AssistantConfig provided.');
  }
  return validation.config;
}
