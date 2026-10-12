import type { PageRecord } from '../types';
import type { PageStore } from './types';

const PAGES = 'pages';
const META_STORE = 'meta';
const VERSION = 1;

/**
 * IndexedDB backend. The schema (DB version 1, object stores `pages`
 * keyed by `id` and `meta` keyed by `key`) is the one of the original
 * `gjs-pages-manager.js`, so databases created by it keep working.
 */
export class IndexedDbPageStore implements PageStore {
  private dbp: Promise<IDBDatabase> | null = null;

  constructor(
    readonly dbName = 'gjs-pages-manager',
    private readonly factory: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.dbp) return this.dbp;
    const factory = this.factory;
    if (!factory) return Promise.reject(new Error('IndexedDB is not available'));
    this.dbp = new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(this.dbName, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PAGES)) db.createObjectStore(PAGES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab upgraded the schema: let it, reconnect lazily.
        db.onversionchange = () => {
          db.close();
          this.dbp = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error(`IndexedDB "${this.dbName}" is blocked by another tab`));
    });
    this.dbp.catch(() => {
      this.dbp = null; // allow a retry after a failure
    });
    return this.dbp;
  }

  private async tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const rq = fn(t.objectStore(store));
      t.oncomplete = () => resolve((rq ? rq.result : undefined) as T);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
    });
  }

  all(): Promise<PageRecord[]> {
    return this.tx<PageRecord[]>(PAGES, 'readonly', (s) => s.getAll());
  }

  get(id: string): Promise<PageRecord | undefined> {
    return this.tx<PageRecord | undefined>(PAGES, 'readonly', (s) => s.get(id));
  }

  async put(rec: PageRecord): Promise<void> {
    await this.tx(PAGES, 'readwrite', (s) => s.put(rec));
  }

  async delete(id: string): Promise<void> {
    await this.tx(PAGES, 'readwrite', (s) => s.delete(id));
  }

  async getMeta<T = unknown>(key: string): Promise<T | undefined> {
    const row = await this.tx<{ key: string; value: T } | undefined>(META_STORE, 'readonly', (s) => s.get(key));
    return row?.value;
  }

  async setMeta<T = unknown>(key: string, value: T): Promise<void> {
    await this.tx(META_STORE, 'readwrite', (s) => s.put({ key, value }));
  }

  close(): void {
    const p = this.dbp;
    this.dbp = null;
    p?.then((db) => db.close()).catch(() => {});
  }
}
