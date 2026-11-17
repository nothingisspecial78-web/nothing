/**
 * Universal App Integration SDK — Adapter Interfaces & Contracts
 * 
 * Adapters are the bridge between the app-agnostic Assistant SDK and the host application.
 * The host app supplies implementations of these interfaces matching its backend architecture.
 */

export interface UserContext {
  id: string;
  name?: string;
  email?: string;
  role: string;
  organizationId?: string;
  sectorId?: string;
  permissions?: string[];
  metadata?: Record<string, unknown>;
}

export interface PageContext {
  route: string;
  pageName?: string;
  pageTitle?: string;
  selectedRecord?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  filters?: Record<string, unknown>;
}

export interface ActionResult<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  requiresConfirmation?: boolean;
  confirmationToken?: string;
}

export interface PlanStatus {
  planId: string;
  isPremium: boolean;
  creditsRemaining: number;
  creditsMonthlyAllowance: number;
  expiresAt?: string;
  features: string[];
}

export interface CheckoutSession {
  orderId: string;
  amount: number;
  currency: string;
  keyId?: string;
  customerName?: string;
  customerEmail?: string;
  notes?: Record<string, string>;
}

export interface PaymentVerificationPayload {
  orderId: string;
  paymentId: string;
  signature: string;
  planId?: string;
}

// ==============================================================================
// 1. AuthAdapter
// ==============================================================================
export interface AuthAdapter {
  /**
   * Resolves the current user context from the request or session.
   */
  getCurrentUser(req?: unknown): Promise<UserContext | null>;

  /**
   * Resolves the current tenant/organization ID.
   */
  getOrganizationId(req?: unknown): Promise<string | null>;

  /**
   * Checks whether the current user has the specified permission.
   */
  hasPermission(permission: string, user?: UserContext): Promise<boolean>;
}

// ==============================================================================
// 2. DataAdapter
// ==============================================================================
export interface DataAdapter {
  /**
   * Searches an entity collection with full-text or fuzzy queries.
   * MUST enforce user's role and organization boundaries.
   */
  search(
    entityType: string,
    query: string,
    filters?: Record<string, unknown>,
    user?: UserContext
  ): Promise<Record<string, unknown>[]>;

  /**
   * Gets a single entity record by ID.
   */
  getById(
    entityType: string,
    id: string,
    user?: UserContext
  ): Promise<Record<string, unknown> | null>;

  /**
   * Lists entity records with pagination, sorting and filters.
   */
  list(
    entityType: string,
    options?: SearchOptions,
    user?: UserContext
  ): Promise<Record<string, unknown>[]>;

  /**
   * Returns count of matching records.
   */
  count(
    entityType: string,
    filters?: Record<string, unknown>,
    user?: UserContext
  ): Promise<number>;
}

// ==============================================================================
// 3. ActionAdapter
// ==============================================================================
export interface ActionAdapter {
  /**
   * Determines if the action requires explicit human confirmation before execution.
   */
  requiresConfirmation(actionName: string, params: Record<string, unknown>): boolean;

  /**
   * Executes an action with the user's permissions.
   */
  executeAction(
    actionName: string,
    params: Record<string, unknown>,
    user?: UserContext
  ): Promise<ActionResult>;
}

// ==============================================================================
// 4. PageContextAdapter
// ==============================================================================
export interface PageContextAdapter {
  /**
   * Returns the current page/screen context.
   */
  getCurrentPage(): PageContext;

  /**
   * Subscribes to route or page context changes. Returns an unsubscribe function.
   */
  subscribe(listener: (context: PageContext) => void): () => void;
}

// ==============================================================================
// 5. BillingAdapter
// ==============================================================================
export interface BillingAdapter {
  /**
   * Returns current plan status and remaining credits for the organization.
   */
  getPlan(orgId: string): Promise<PlanStatus>;

  /**
   * Creates a checkout order for upgrading plan or purchasing credit top-ups.
   */
  createCheckout(
    planId: string,
    orgId: string,
    user?: UserContext
  ): Promise<CheckoutSession>;

  /**
   * Verifies payment gateway signature and applies plan upgrade.
   */
  verify(payload: PaymentVerificationPayload): Promise<{ verified: boolean; plan?: PlanStatus }>;

  /**
   * Consumes credits for an action and returns remaining balance.
   */
  consumeCredits(orgId: string, amount: number, reason: string): Promise<{ success: boolean; remaining: number }>;
}

/**
 * Composite container for all adapters provided by the host app
 */
export interface AssistantAdapters {
  auth?: AuthAdapter;
  data: DataAdapter;
  actions?: ActionAdapter;
  pageContext?: PageContextAdapter;
  billing?: BillingAdapter;
}
