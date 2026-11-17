import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthAdapter, DataAdapter, SearchOptions, UserContext } from './types.ts';

/**
 * Drop-in Supabase DataAdapter reusing `@supabase/supabase-js`.
 */
export class SupabaseDataAdapter implements DataAdapter {
  private client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async search(
    entityType: string,
    query: string,
    filters?: Record<string, unknown>,
    _user?: UserContext
  ): Promise<Record<string, unknown>[]> {
    let q = this.client.from(entityType).select('*');
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        q = q.eq(k, v);
      }
    }
    if (query && query.trim()) {
      // Use textSearch if available, or fall back to ilike
      q = q.or(`name.ilike.%${query}%,title.ilike.%${query}%,email.ilike.%${query}%`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async getById(
    entityType: string,
    id: string,
    _user?: UserContext
  ): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.client
      .from(entityType)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async list(
    entityType: string,
    options: SearchOptions = {},
    _user?: UserContext
  ): Promise<Record<string, unknown>[]> {
    let q = this.client.from(entityType).select('*');
    if (options.filters) {
      for (const [k, v] of Object.entries(options.filters)) {
        q = q.eq(k, v);
      }
    }
    if (options.sortBy) {
      q = q.order(options.sortBy, { ascending: options.sortDir !== 'desc' });
    }
    if (options.limit !== undefined) {
      const from = options.offset || 0;
      const to = from + options.limit - 1;
      q = q.range(from, to);
    }
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async count(
    entityType: string,
    filters?: Record<string, unknown>,
    _user?: UserContext
  ): Promise<number> {
    let q = this.client.from(entityType).select('*', { count: 'exact', head: true });
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        q = q.eq(k, v);
      }
    }
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  }
}

/**
 * Drop-in Supabase AuthAdapter using Supabase Auth.
 */
export class SupabaseAuthAdapter implements AuthAdapter {
  private client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async getCurrentUser(_req?: unknown): Promise<UserContext | null> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) return null;
    return {
      id: data.user.id,
      email: data.user.email,
      name: data.user.user_metadata?.name || data.user.email?.split('@')[0],
      role: data.user.user_metadata?.role || data.user.app_metadata?.role || 'USER',
      organizationId: data.user.user_metadata?.organizationId || data.user.app_metadata?.organizationId,
    };
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
