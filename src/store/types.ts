import type { PageRecord } from '../types';

/**
 * Storage backend of the plugin.
 *
 * Pages and a small key/value "meta" area (active page id, server settings,
 * clipboard, last sync time). The default implementation is
 * `IndexedDbPageStore`; `MemoryPageStore` is handy for tests and demos.
 * A CMS integration can provide its own store (e.g. one that talks to the
 * CMS API directly) without touching the rest of the plugin.
 *
 * All methods may be called concurrently; implementations must be safe for
 * that (IndexedDB transactions are).
 */
export interface PageStore {
  /** Every record, including tombstones (`deleted: true`). */
  all(): Promise<PageRecord[]>;
  get(id: string): Promise<PageRecord | undefined>;
  put(rec: PageRecord): Promise<void>;
  delete(id: string): Promise<void>;
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta<T = unknown>(key: string, value: T): Promise<void>;
  /** Optional: release resources (close the DB connection). */
  close?(): void;
}

/** Keys of the meta area used by the plugin. */
export const META = {
  active: 'active',
  settings: 'settings',
  clipboard: 'clipboard',
  lastSync: 'lastSync',
} as const;
