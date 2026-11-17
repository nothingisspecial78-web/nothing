import type {
  ActionDefinition,
  AiConfig,
  AppConfig,
  AuthConfig,
  EntityDefinition,
  EntityFieldSpec,
  FeaturesConfig,
  KnowledgeDoc,
  PageAction,
  PageConfig,
  PlansConfig,
  RoleDefinition,
  ThemeConfig,
} from '../core/config/schema.ts';
import type {
  AssistantEntityConfig,
  EntityFieldSpec as LegacyEntityFieldSpec,
  ScopedEntityDef,
} from '../core/entityRegistry.ts';
import type { SheetTemplate } from '../core/schemas.ts';

/**
 * Runtime session context passed into adapter scope predicates and entity handlers.
 */
export interface AdapterSessionContext {
  userId: string;
  role: string;
  organizationId?: string;
  sectorId?: string;
  assignedSectors?: string[];
  ownerId?: string;
  email?: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
  appState?: Record<string, unknown>;
}

/**
 * Per-role access scope predicate returning true when `ctx` may read `record`.
 */
export type RoleScopePredicate<TRecord = Record<string, unknown>> = (
  ctx: AdapterSessionContext,
  record: TRecord
) => boolean;

/**
 * Normalized entity record returned by adapter query/get/search handlers.
 */
export type AdapterRecord = Record<string, unknown>;

export interface AdapterEntityQueryFilters {
  filters?: Record<string, unknown>;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * Spec Section 4 #4: Entities definition with per-role scope predicates and live handlers.
 */
export interface AdapterEntityDef<TRecord extends AdapterRecord = AdapterRecord> {
  name: string;
  label: string;
  pluralLabel?: string;
  collection: string;
  idField: string;
  nameField: string;
  nameLabel?: string;
  fields: Array<EntityFieldSpec & { searchable?: boolean; detail?: boolean; sensitive?: boolean }>;
  searchableFields: string[];
  displayFields: EntityFieldSpec[];
  detailFields?: EntityFieldSpec[];
  defaultExportColumns?: string[];
  sensitiveFields?: string[];
  relations?: Array<{
    entity: string;
    localField: string;
    foreignField: string;
    label?: string;
  }>;
  orgField?: string;
  sectorField?: string;
  ownerIdField?: string;
  roleField?: string;
  /** Semantic keywords / domain aliases used by the intent & query engine (no hardcoded core strings). */
  keywords?: string[];
  visibilityRules: Record<string, 'all' | 'org' | 'sector' | 'self' | 'none'>;
  scopePredicates?: Record<string, RoleScopePredicate<TRecord>>;
  query?: (ctx: AdapterSessionContext, filters?: AdapterEntityQueryFilters) => Promise<TRecord[]> | TRecord[];
  get?: (ctx: AdapterSessionContext, id: string) => Promise<TRecord | null> | TRecord | null;
  search?: (ctx: AdapterSessionContext, text: string) => Promise<TRecord[]> | TRecord[];
}

export interface AdapterRoleDef extends RoleDefinition {
  id: string;
  label: string;
  level: number;
  authMethod?: string;
  scopeDescription: string;
}

export interface AdapterPageDef extends PageConfig {
  route: string;
  pageName: string;
  guideAnchorIds?: string[];
}

export interface AdapterGuideStepDef {
  id: string;
  route: string;
  selector: string;
  instructionEn: string;
  instructionMl?: string;
  completionCondition: 'click' | 'input' | 'route_change' | 'submit' | 'manual';
  expectedRoute?: string;
  sensitive?: boolean;
}

export interface AdapterGuideFlowDef {
  id: string;
  title: string;
  triggerPhrases: string[];
  roles: string[];
  steps: AdapterGuideStepDef[];
}

export interface AdapterToolParam {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface AdapterToolDef {
  name: string;
  description: string;
  parameters: Record<string, AdapterToolParam>;
  roles: string[];
  risk: 'read' | 'write';
  needsConfirmation: boolean;
  handler: (
    args: Record<string, unknown>,
    ctx: AdapterSessionContext
  ) => Promise<{
    ok: boolean;
    summary: string;
    data?: unknown;
    uiAction?: Record<string, unknown>;
  }>;
}

export interface AdapterImportTemplateDef extends SheetTemplate {
  allowedRoles?: string[];
  areaAliases?: string[];
}

export interface AdapterExportColumnDef {
  key: string;
  label: string;
  format?: 'text' | 'currency' | 'date' | 'array' | 'boolean';
}

export interface AdapterExportDef {
  id: string;
  entity: string;
  title: string;
  filenamePrefix: string;
  formats: Array<'csv' | 'xlsx' | 'pdf' | 'docx'>;
  columns: AdapterExportColumnDef[];
  allowedRoles?: string[];
  supportsUnicodePdf?: boolean;
}

export interface AdapterCreditsConfig {
  freeMonthlyAllowance: number;
  ownerRole: string;
  resetCycle: 'monthly';
  allowNonAdminOnFree: boolean;
  costs: {
    chat: number;
    toolCall: number;
    attachment: number;
    export: number;
    import: number;
  };
}

export interface AdapterPlansConfig {
  currency: string;
  monthlyPrice: number;
  annualPrice: number;
  freeFeatures: string[];
  premiumFeatures: string[];
}

export interface AdapterProvidersConfig {
  order: Array<'openrouter' | 'gemini' | 'groq'>;
  models: {
    openrouter?: { fast: string; strong: string; vision: string };
    gemini?: { fast: string; strong: string; vision: string };
    groq?: { fast: string; strong: string };
  };
  timeoutMs: number;
  retriesPerProvider: number;
}

export interface AdapterScopeGuardConfig {
  appTopicDescription: string;
  allowedPublicTopics: string[];
  publicGuideRoutes?: string[];
  publicBlockedKeywords?: string[];
  offTopicRefusal: string;
}

/**
 * COMPLETE 12-KEY ADAPTER CONTRACT (Spec Section 4)
 * The ONLY contract a new host application must fill in inside `ai-assistant-kit/adapter/`.
 */
export interface AssistantKitAdapter {
  /** 1. App metadata, default languages, logo & theme tokens */
  app: AppConfig & {
    shortDescription: string;
    theme: ThemeConfig;
    personalizationExamples?: {
      displayNamePlaceholder?: string;
      instructionsPlaceholder?: string;
    };
  };
  /** 2. Authentication & session extractor config */
  auth: AuthConfig & {
    extractSession?: (reqOrState: Record<string, unknown>) => AdapterSessionContext | null;
  };
  /** 3. Role hierarchy definitions (level 0 highest -> higher numbers lower) */
  roles: AdapterRoleDef[];
  /** 4. Entities registry with fields, scope predicates, and live query/get/search handlers */
  entities: AdapterEntityDef[];
  /** 5. App pages, possible actions, per-role chips, and guide anchors */
  pages: AdapterPageDef[];
  /** 6. Interactive step-by-step 3D avatar guide flows */
  guideFlows: AdapterGuideFlowDef[];
  /** 7. Custom action tools registered beyond built-ins */
  tools: AdapterToolDef[];
  /** 8a. Spreadsheet import templates */
  importTemplates: AdapterImportTemplateDef[];
  /** 8b. Export file schema definitions */
  exportDefinitions: AdapterExportDef[];
  /** 9. Credits rules (100/month free default, owned by Admin) */
  credits: AdapterCreditsConfig;
  /** 10. Subscription plans & upgrade page features */
  plans: AdapterPlansConfig;
  /** 11. Multi-provider fallback configuration (OpenRouter -> Gemini -> Groq) */
  providers: AdapterProvidersConfig;
  /** 12. Scope guard policy to refuse off-topic queries politely */
  scopeGuard: AdapterScopeGuardConfig;
  /** Optional site-wide general chips & knowledge snippets */
  generalChips?: PageAction[];
  knowledge?: KnowledgeDoc[];
}

export function defineAssistantAdapter(adapter: AssistantKitAdapter): AssistantKitAdapter {
  return adapter;
}

/**
 * Projects the 12-key Adapter Contract down to the legacy `AssistantEntityConfig` shape
 * consumed by chips, entityRegistry, and server routing.
 */
export function toAssistantEntityConfig(adapter: AssistantKitAdapter): AssistantEntityConfig {
  const entities: ScopedEntityDef[] = adapter.entities.map((e) => {
    const mappedVisibility: Record<string, 'all' | 'org' | 'scope' | 'self' | 'none'> = {};
    for (const [roleKey, visVal] of Object.entries(e.visibilityRules)) {
      mappedVisibility[roleKey] = visVal === 'sector' ? 'scope' : visVal;
    }
    return {
      type: e.name,
      label: e.label,
      pluralLabel: e.pluralLabel,
      collection: e.collection,
      idField: e.idField,
      nameField: e.nameField,
      nameLabel: e.nameLabel,
      defaultExportColumns: e.defaultExportColumns,
      sensitiveFields: e.sensitiveFields,
      roleField: e.roleField,
      orgField: e.orgField,
      scopeField: e.sectorField,
      ownerIdField: e.ownerIdField,
      searchableFields: e.searchableFields,
      displayFields: e.displayFields as LegacyEntityFieldSpec[],
      detailFields: e.detailFields as LegacyEntityFieldSpec[] | undefined,
      visibilityRules: mappedVisibility,
      keywords: e.keywords,
    };
  });

  const pages = adapter.pages.map((p) => ({
    pageId: p.pageId,
    title: p.title,
    routePatterns: p.routePatterns,
    actions: p.actions,
  }));

  return {
    appId: adapter.app.id,
    appName: adapter.app.name,
    entities,
    pages,
    generalChips: adapter.generalChips || [],
    scopeGuard: adapter.scopeGuard,
  };
}

export type { ActionDefinition, AiConfig, EntityDefinition, PlansConfig };
