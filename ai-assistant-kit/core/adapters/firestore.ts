import type { DataAdapter, SearchOptions, UserContext } from './types.ts';

export interface FirestoreClientLike {
  collection(path: string): any;
}

export class FirestoreDataAdapter implements DataAdapter {
  private db: FirestoreClientLike;

  constructor(db: FirestoreClientLike) {
    this.db = db;
  }

  async search(
    entityType: string,
    query: string,
    filters?: Record<string, unknown>,
    _user?: UserContext
  ): Promise<Record<string, unknown>[]> {
    const coll = this.db.collection(entityType);
    let q = coll;
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        if (typeof q.where === 'function') {
          q = q.where(k, '==', v);
        }
      }
    }
    const snapshot = await (typeof q.get === 'function' ? q.get() : coll.get());
    const items: Record<string, unknown>[] = [];
    snapshot.forEach((doc: any) => {
      items.push({ id: doc.id, ...doc.data() });
    });

    if (!query || !query.trim()) return items;
    const lower = query.toLowerCase().trim();
    return items.filter((rec) =>
      Object.values(rec).some((val) => typeof val === 'string' && val.toLowerCase().includes(lower))
    );
  }

  async getById(
    entityType: string,
    id: string,
    _user?: UserContext
  ): Promise<Record<string, unknown> | null> {
    const docRef = this.db.collection(entityType).doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  async list(
    entityType: string,
    options: SearchOptions = {},
    _user?: UserContext
  ): Promise<Record<string, unknown>[]> {
    let q = this.db.collection(entityType);
    if (options.filters) {
      for (const [k, v] of Object.entries(options.filters)) {
        if (typeof q.where === 'function') {
          q = q.where(k, '==', v);
        }
      }
    }
    if (options.sortBy && typeof q.orderBy === 'function') {
      q = q.orderBy(options.sortBy, options.sortDir === 'desc' ? 'desc' : 'asc');
    }
    if (options.limit !== undefined && typeof q.limit === 'function') {
      q = q.limit(options.limit);
    }
    const snapshot = await q.get();
    const items: Record<string, unknown>[] = [];
    snapshot.forEach((doc: any) => {
      items.push({ id: doc.id, ...doc.data() });
    });
    return items;
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
