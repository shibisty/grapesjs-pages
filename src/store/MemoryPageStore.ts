import type { PageRecord } from '../types';
import { clone } from '../utils';
import type { PageStore } from './types';

/**
 * In-memory backend: nothing survives a reload. Values are cloned on the
 * way in and out, like a structured-clone store would do.
 */
export class MemoryPageStore implements PageStore {
  private pages = new Map<string, PageRecord>();
  private meta = new Map<string, unknown>();

  constructor(initial: PageRecord[] = []) {
    initial.forEach((p) => this.pages.set(p.id, clone(p)));
  }

  async all(): Promise<PageRecord[]> {
    return [...this.pages.values()].map(clone);
  }

  async get(id: string): Promise<PageRecord | undefined> {
    const r = this.pages.get(id);
    return r ? clone(r) : undefined;
  }

  async put(rec: PageRecord): Promise<void> {
    this.pages.set(rec.id, clone(rec));
  }

  async delete(id: string): Promise<void> {
    this.pages.delete(id);
  }

  async getMeta<T = unknown>(key: string): Promise<T | undefined> {
    const v = this.meta.get(key);
    return v === undefined ? undefined : (clone(v) as T);
  }

  async setMeta<T = unknown>(key: string, value: T): Promise<void> {
    this.meta.set(key, value === undefined ? value : clone(value));
  }
}
