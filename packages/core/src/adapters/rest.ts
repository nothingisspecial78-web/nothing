import type { AuthAdapter, DataAdapter, SearchOptions, UserContext } from './types.ts';

export interface RestAdapterOptions {
  baseUrl: string;
  endpoints?: {
    me?: string;
    search?: string;
    entities?: Record<string, string>;
  };
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  fetchFn?: typeof fetch;
}

/**
 * Drop-in REST DataAdapter for applications with standard JSON HTTP APIs.
 */
export class RestDataAdapter implements DataAdapter {
  private baseUrl: string;
  private endpoints: Record<string, string>;
  private headers: RestAdapterOptions['headers'];
  private fetchFn: typeof fetch;

  constructor(options: RestAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.endpoints = options.endpoints?.entities || {};
    this.headers = options.headers;
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const base: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!this.headers) return base;
    const custom = typeof this.headers === 'function' ? await this.headers() : this.headers;
    return { ...base, ...custom };
  }

  private getEndpoint(entityType: string): string {
    return this.endpoints[entityType] || `/${entityType}`;
  }

  async search(
    entityType: string,
    query: string,
    filters?: Record<string, unknown>,
    _user?: UserContext
  ): Promise<Record<string, unknown>[]> {
    const endpoint = this.getEndpoint(entityType);
    const params = new URLSearchParams({ q: query });
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== null) params.append(k, String(v));
      }
    }
    const url = `${this.baseUrl}${endpoint}?${params.toString()}`;
    const headers = await this.getHeaders();
    const res = await this.fetchFn(url, { headers });
    if (!res.ok) throw new Error(`RestDataAdapter search failed with status ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : data.items || data.data || [];
  }

  async getById(
    entityType: string,
    id: string,
    _user?: UserContext
  ): Promise<Record<string, unknown> | null> {
    const endpoint = this.getEndpoint(entityType);
    const url = `${this.baseUrl}${endpoint}/${encodeURIComponent(id)}`;
    const headers = await this.getHeaders();
    const res = await this.fetchFn(url, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`RestDataAdapter getById failed with status ${res.status}`);
    return res.json();
  }

  async list(
    entityType: string,
    options: SearchOptions = {},
    _user?: UserContext
  ): Promise<Record<string, unknown>[]> {
    const endpoint = this.getEndpoint(entityType);
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.append('limit', String(options.limit));
    if (options.offset !== undefined) params.append('offset', String(options.offset));
    if (options.sortBy) params.append('sortBy', options.sortBy);
    if (options.sortDir) params.append('sortDir', options.sortDir);
    if (options.filters) {
      for (const [k, v] of Object.entries(options.filters)) {
        if (v !== undefined && v !== null) params.append(k, String(v));
      }
    }
    const url = `${this.baseUrl}${endpoint}?${params.toString()}`;
    const headers = await this.getHeaders();
    const res = await this.fetchFn(url, { headers });
    if (!res.ok) throw new Error(`RestDataAdapter list failed with status ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : data.items || data.data || [];
  }

  async count(
    entityType: string,
    filters?: Record<string, unknown>,
    user?: UserContext
  ): Promise<number> {
    const items = await this.list(entityType, { filters }, user);
    return items.length;
  }
}

/**
 * Drop-in REST AuthAdapter using host app's `/me` endpoint.
 */
export class RestAuthAdapter implements AuthAdapter {
  private meUrl: string;
  private headers: RestAdapterOptions['headers'];
  private fetchFn: typeof fetch;

  constructor(options: { meUrl: string; headers?: RestAdapterOptions['headers']; fetchFn?: typeof fetch }) {
    this.meUrl = options.meUrl;
    this.headers = options.headers;
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  async getCurrentUser(_req?: unknown): Promise<UserContext | null> {
    try {
      const headers: Record<string, string> = {};
      if (this.headers) {
        Object.assign(headers, typeof this.headers === 'function' ? await this.headers() : this.headers);
      }
      const res = await this.fetchFn(this.meUrl, { headers });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        id: data.id || data.userId || 'anonymous',
        name: data.name || data.fullName,
        email: data.email,
        role: data.role || 'USER',
        organizationId: data.organizationId || data.orgId,
        permissions: data.permissions || [],
      };
    } catch {
      return null;
    }
  }

  async getOrganizationId(req?: unknown): Promise<string | null> {
    const user = await this.getCurrentUser(req);
    return user?.organizationId || null;
  }

  async hasPermission(permission: string, user?: UserContext): Promise<boolean> {
    const u = user || (await this.getCurrentUser());
    if (!u) return false;
    if (u.role === 'SUPER_ADMIN' || u.role === 'admin') return true;
    return u.permissions ? u.permissions.includes(permission) : false;
  }
}
