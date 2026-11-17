export type EntityScopeRole =
  | 'PUBLIC'
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'SCOPED_MANAGER'
  | 'END_USER'
  | string;

export type EntityVisibilityScope = 'all' | 'org' | 'scope' | 'self' | 'none';

export interface EntityFieldSpec {
  key: string;
  label: string;
  format?: 'text' | 'currency' | 'date' | 'array' | 'boolean';
}

export interface EntityTypeDefinition {
  /** Machine type name declared by the host adapter */
  type: string;
  /** Human-readable entity label shown in responses */
  label: string;
  /** Collection / table key inside live appState or connected repository */
  collection: string;
  /** Unique identifier field name on each record */
  idField: string;
  /** Primary display name/title field name */
  nameField: string;
  /** Optional human-readable header label for nameField when exporting */
  nameLabel?: string;
  /** Optional plural noun for summaries/titles */
  pluralLabel?: string;
  /** Default ordered field keys included when user requests an export without naming specific columns */
  defaultExportColumns?: string[];
  /** Sensitive field keys blocked from exports/results even if explicitly requested */
  sensitiveFields?: string[];
  /** Optional dynamic role/type field if records inside the same collection carry finer roles */
  roleField?: string;
  /** Optional organization / tenant field on records for strict org isolation */
  orgField?: string;
  /** Optional scope partition field(s) (e.g. department/branch/group) used for scoped manager visibility */
  scopeField?: string;
  /** Optional owner/end-user ID field used for 'self' scoping */
  ownerIdField?: string;
  /** Semantic keywords declared by the adapter for intent matching */
  keywords?: string[];
  /** Fields searched across with case-insensitive, partial, token, and fuzzy matching */
  searchableFields: string[];
  /** Concise key fields returned in search_entities results and inline summaries */
  displayFields: EntityFieldSpec[];
  /** Additional full-record fields returned by get_entity_details */
  detailFields?: EntityFieldSpec[];
  /** Strict role-based visibility rules per role */
  visibilityRules: Partial<Record<EntityScopeRole, EntityVisibilityScope>>;
}

export type ScopedEntityDef = EntityTypeDefinition;

export interface PageActionConfig {
  id: string;
  label: string;
  labelMl?: string;
  labelAr?: string;
  prompt: string;
  promptMl?: string;
  promptAr?: string;
  roles?: EntityScopeRole[];
  icon?: string;
  priority?: number;
}

export interface PageDefinitionConfig {
  pageId: string;
  title: string;
  routePatterns?: string[];
  actions: PageActionConfig[];
}

export interface ScopeGuardConfig {
  appTopicDescription: string;
  allowedPublicTopics: string[];
  publicGuideRoutes?: string[];
  publicBlockedKeywords?: string[];
  offTopicRefusal: string;
}

export interface AssistantEntityConfig {
  appId: string;
  appName: string;
  entities: EntityTypeDefinition[];
  pages?: PageDefinitionConfig[];
  generalChips?: PageActionConfig[];
  scopeGuard?: ScopeGuardConfig;
}

export interface EntitySearchMatch {
  type: string;
  roleLabel: string;
  id: string;
  name: string;
  score: number;
  matchedField: string;
  keyFields: Record<string, unknown>;
}

export interface EntitySearchResult {
  ok: boolean;
  denied?: boolean;
  appId: string;
  appName: string;
  query: string;
  matches: EntitySearchMatch[];
  suggestions: string[];
  summary: string;
}

export interface EntityDetailsResult {
  ok: boolean;
  denied?: boolean;
  appId: string;
  type: string;
  roleLabel: string;
  id: string;
  name?: string;
  record?: Record<string, unknown>;
  summary: string;
}
