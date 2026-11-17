import type { DataAdapter, SearchOptions, UserContext } from './types.ts';

/**
 * In-Memory DataAdapter for sample applications, testing, and rapid prototyping.
 */
export class MemoryDataAdapter implements DataAdapter {
  private tables = new Map<string, Record<string, unknown>[]>();

  constructor(initialData: Record<string, Record<string, unknown>[]> = {}) {
    for (const [table, rows] of Object.entries(initialData)) {
      this.tables.set(table, [...rows]);
    }
  }

  public setTableData(table: string, data: Record<string, unknown>[]): void {
    this.tables.set(table, [...data]);
  }

  public getTableData(table: string): Record<string, unknown>[] {
    return this.tables.get(table) || [];
  }

  private filterByScope(
    records: Record<string, unknown>[],
    user?: UserContext
  ): Record<string, unknown>[] {
    if (!user) return records;
    if (user.role === 'SUPER_ADMIN' || user.role === 'admin') return records;

    return records.filter((rec) => {
      // Org isolation
      if (user.organizationId && rec.organizationId && rec.organizationId !== user.organizationId) {
        return false;
      }
      // Sector isolation
      if (user.sectorId && rec.sectorId && rec.sectorId !== user.sectorId) {
        return false;
      }
      return true;
    });
  }

  async search(
    entityType: string,
    query: string,
    filters?: Record<string, unknown>,
    user?: UserContext
  ): Promise<Record<string, unknown>[]> {
    const raw = this.getTableData(entityType);
    let records = this.filterByScope(raw, user);

    if (filters) {
      records = records.filter((rec) =>
        Object.entries(filters).every(([k, v]) => rec[k] === v)
      );
    }

    if (!query || !query.trim()) return records;

    const q = query.toLowerCase().trim();
    return records.filter((rec) =>
      Object.values(rec).some((val) => {
        if (typeof val === 'string') return val.toLowerCase().includes(q);
        if (typeof val === 'number') return String(val).includes(q);
        return false;
      })
    );
  }

  async getById(
    entityType: string,
    id: string,
    user?: UserContext
  ): Promise<Record<string, unknown> | null> {
    const raw = this.getTableData(entityType);
    const records = this.filterByScope(raw, user);
    return records.find((r) => r.id === id || r.uuid === id || r.slug === id) || null;
  }

  async list(
    entityType: string,
    options: SearchOptions = {},
    user?: UserContext
  ): Promise<Record<string, unknown>[]> {
    const raw = this.getTableData(entityType);
    let records = this.filterByScope(raw, user);

    if (options.filters) {
      records = records.filter((rec) =>
        Object.entries(options.filters!).every(([k, v]) => rec[k] === v)
      );
    }

    if (options.sortBy) {
      const field = options.sortBy;
      const dir = options.sortDir === 'desc' ? -1 : 1;
      records = [...records].sort((a, b) => {
        const valA = a[field] ?? '';
        const valB = b[field] ?? '';
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
      });
    }

    const offset = options.offset || 0;
    const limit = options.limit || records.length;
    return records.slice(offset, offset + limit);
  }

  async count(
    entityType: string,
    filters?: Record<string, unknown>,
    user?: UserContext
  ): Promise<number> {
    const records = await this.list(entityType, { filters }, user);
    return records.length;
  }
}
