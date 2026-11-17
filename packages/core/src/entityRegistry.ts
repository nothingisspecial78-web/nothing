export type EntityScopeRole =
  | 'PUBLIC'
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'SECTOR_MANAGER'
  | 'STUDENT';

export type EntityVisibilityScope = 'all' | 'org' | 'sector' | 'self' | 'none';

export interface EntityFieldSpec {
  key: string;
  label: string;
  format?: 'text' | 'currency' | 'date' | 'array' | 'boolean';
}

export interface EntityTypeDefinition {
  /** Machine type name: student, teacher, sector_manager, principal, office_staff, union_member, book, shelf, leave_request, etc. */
  type: string;
  /** Human-readable role / entity type label shown in responses (e.g. "Student", "Principal", "Book"). */
  label: string;
  /** Collection / table key inside live appState or connected repository (e.g. "students", "books", "leaveRequests"). */
  collection: string;
  /** Unique identifier field name on each record (e.g. "id", "slug", "isbn"). */
  idField: string;
  /** Primary display name/title field name (e.g. "name", "fullName", "title"). */
  nameField: string;
  /** Optional human-readable header label for nameField when exporting (e.g. "Full Name", "Book Title"). */
  nameLabel?: string;
  /** Optional plural noun for summaries/titles (e.g. "students", "books"). */
  pluralLabel?: string;
  /** Default ordered field keys included when user requests an export without naming specific columns. */
  defaultExportColumns?: string[];
  /** Sensitive field keys blocked from exports/results even if explicitly requested. */
  sensitiveFields?: string[];
  /** Optional dynamic role/type field if records inside the same collection carry finer roles. */
  roleField?: string;
  /** Optional organization / tenant field on records for strict org isolation. */
  orgField?: string;
  /** Optional sector / department field(s) used for SECTOR_MANAGER scoping (string or string[]). */
  sectorField?: string;
  /** Optional owner/student ID field used for STUDENT 'self' scoping. */
  ownerIdField?: string;
  /** Fields searched across with case-insensitive, partial, token, and fuzzy matching. */
  searchableFields: string[];
  /** Concise key fields returned in search_entities results and inline summaries. */
  displayFields: EntityFieldSpec[];
  /** Additional full-record fields returned by get_entity_details. */
  detailFields?: EntityFieldSpec[];
  /** Strict role-based visibility rules per AccessScope role. */
  visibilityRules: Partial<Record<EntityScopeRole, EntityVisibilityScope>>;
}

export interface PageActionConfig {
  id: string;
  label: string;
  labelMl?: string;
  prompt: string;
  promptMl?: string;
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

export interface AssistantEntityConfig {
  appId: string;
  appName: string;
  entities: EntityTypeDefinition[];
  pages?: PageDefinitionConfig[];
  generalChips?: PageActionConfig[];
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
