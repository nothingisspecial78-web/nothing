/**
 * Universal App Integration SDK — Adapter Interfaces & Contracts
 */

export interface UserContext {
  id: string;
  name?: string;
  email?: string;
  role: string;
  organizationId?: string;
  scopeId?: string;
  scopeIds?: string[];
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

export interface AuthAdapter {
  getCurrentUser(req?: unknown): Promise<UserContext | null>;
  getOrganizationId(req?: unknown): Promise<string | null>;
  hasPermission(permission: string, user?: UserContext): Promise<boolean>;
}

export interface DataAdapter {
  search(
    entityType: string,
    query: string,
    filters?: Record<string, unknown>,
    user?: UserContext
  ): Promise<Record<string, unknown>[]>;
  getById(
    entityType: string,
    id: string,
    user?: UserContext
  ): Promise<Record<string, unknown> | null>;
  list(
    entityType: string,
    options?: SearchOptions,
    user?: UserContext
  ): Promise<Record<string, unknown>[]>;
  count(
    entityType: string,
    filters?: Record<string, unknown>,
    user?: UserContext
  ): Promise<number>;
}

export interface ActionAdapter {
  requiresConfirmation(actionName: string, params: Record<string, unknown>): boolean;
  executeAction(
    actionName: string,
    params: Record<string, unknown>,
    user?: UserContext
  ): Promise<ActionResult>;
}

export interface PageContextAdapter {
  getCurrentPage(): PageContext;
  subscribe(listener: (context: PageContext) => void): () => void;
}

export interface BillingAdapter {
  getPlan(orgId: string): Promise<PlanStatus>;
  createCheckout(planId: string, orgId: string, user?: UserContext): Promise<CheckoutSession>;
  verify(payload: PaymentVerificationPayload): Promise<{ verified: boolean; plan?: PlanStatus }>;
  consumeCredits(orgId: string, amount: number, reason: string): Promise<{ success: boolean; remaining: number }>;
}

export interface AssistantAdapters {
  auth?: AuthAdapter;
  data: DataAdapter;
  actions?: ActionAdapter;
  pageContext?: PageContextAdapter;
  billing?: BillingAdapter;
}
