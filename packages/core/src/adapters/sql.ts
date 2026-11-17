import type { DataAdapter, SearchOptions, UserContext } from './types.ts';

export interface SqlQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Drop-in SQL / ORM DataAdapter for relational databases (PostgreSQL, MySQL, SQLite)
 * and ORMs like Prisma or Drizzle.
 */
export class SqlDataAdapter implements DataAdapter {
  private runner: SqlQueryRunner;
  private tableNameMap: Record<string, string>;

  constructor(runner: SqlQueryRunner, tableNameMap: Record<string, string> = {}) {
    this.runner = runner;
    this.tableNameMap = tableNameMap;
  }

  private getTable(entityType: string): string {
    return this.tableNameMap[entityType] || entityType;
  }

  async search(
    entityType: string,
    query: string,
    filters?: Record<string, unknown>,
    _user?: UserContext
  ): Promise<Record<string, unknown>[]> {
    const table = this.getTable(entityType);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        params.push(v);
        conditions.push(`"${k}" = $${params.length}`);
      }
    }

    if (query && query.trim()) {
      params.push(`%${query.trim()}%`);
      const pIdx = params.length;
      conditions.push(`("name"::text ILIKE $${pIdx} OR "title"::text ILIKE $${pIdx} OR "email"::text ILIKE $${pIdx})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM "${table}" ${whereClause} LIMIT 100`;

    return this.runner.query(sql, params);
  }

  async getById(
    entityType: string,
    id: string,
    _user?: UserContext
  ): Promise<Record<string, unknown> | null> {
    const table = this.getTable(entityType);
    const sql = `SELECT * FROM "${table}" WHERE "id" = $1 LIMIT 1`;
    const rows = await this.runner.query(sql, [id]);
    return rows[0] || null;
  }

  async list(
    entityType: string,
    options: SearchOptions = {},
    _user?: UserContext
  ): Promise<Record<string, unknown>[]> {
    const table = this.getTable(entityType);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.filters) {
      for (const [k, v] of Object.entries(options.filters)) {
        params.push(v);
        conditions.push(`"${k}" = $${params.length}`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    let sql = `SELECT * FROM "${table}" ${whereClause}`;

    if (options.sortBy) {
      const dir = options.sortDir === 'desc' ? 'DESC' : 'ASC';
      sql += ` ORDER BY "${options.sortBy}" ${dir}`;
    }

    if (options.limit !== undefined) {
      sql += ` LIMIT ${Number(options.limit)}`;
    }
    if (options.offset !== undefined) {
      sql += ` OFFSET ${Number(options.offset)}`;
    }

    return this.runner.query(sql, params);
  }

  async count(
    entityType: string,
    filters?: Record<string, unknown>,
    _user?: UserContext
  ): Promise<number> {
    const table = this.getTable(entityType);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        params.push(v);
        conditions.push(`"${k}" = $${params.length}`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT COUNT(*) as count FROM "${table}" ${whereClause}`;
    const rows = await this.runner.query<{ count: number | string }>(sql, params);
    return Number(rows[0]?.count || 0);
  }
}
