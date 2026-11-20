import type { PageStore } from '../store/types';
import type { PageRecord, ProjectData } from '../types';
import { clone } from '../utils';

/**
 * Where the shared project keys live (see `PagesManager.shareKey`).
 *
 * Every record of the plugin is a whole GrapesJS project, so data another
 * plugin keeps in the project (`editor.getProjectData()[key]`, e.g. the
 * scripts of grapesjs-blueprints) would otherwise be copied into every
 * page. A shared key is kept once per site instead: taken out of a
 * record's project when it is saved and put back when it is opened.
 */
export interface SharedBackend {
  /** Current values of the keys (missing: never set). */
  load(keys: string[]): Promise<Record<string, unknown>>;
  /** Writes these values (only the changed keys are passed). */
  save(values: Record<string, unknown>): Promise<void>;
  /**
   * The id of a record that itself carries the shared values in its
   * project (remote mode: the site record), or null. Saving that record
   * keeps them in its data.
   */
  readonly ownerId: string | null;
}

/** Meta key of the local backend: `{ [key]: value }`. */
export const SHARED_META = 'shared';

/** Local mode: one entry of the store's meta area. */
export class MetaSharedBackend implements SharedBackend {
  readonly ownerId = null;

  constructor(private readonly store: PageStore) {}

  async load(keys: string[]): Promise<Record<string, unknown>> {
    const all = (await this.store.getMeta<Record<string, unknown>>(SHARED_META)) || {};
    const out: Record<string, unknown> = {};
    keys.forEach((k) => {
      if (all[k] !== undefined) out[k] = all[k];
    });
    return out;
  }

  async save(values: Record<string, unknown>): Promise<void> {
    const all = (await this.store.getMeta<Record<string, unknown>>(SHARED_META)) || {};
    await this.store.setMeta(SHARED_META, { ...all, ...clone(values) });
  }
}

/**
 * Remote mode: the site record's project (`site.data[key]`), so the values
 * reach the server with the site and every editor of the site sees them.
 * Without a site record yet (an offline first start) the meta area of the
 * cache is used until there is one.
 */
export class SiteSharedBackend implements SharedBackend {
  private readonly fallback: MetaSharedBackend;

  constructor(
    private readonly store: PageStore,
    readonly ownerId: string
  ) {
    this.fallback = new MetaSharedBackend(store);
  }

  private async site(): Promise<PageRecord | undefined> {
    const r = await this.store.get(this.ownerId);
    return r && !r.deleted ? r : undefined;
  }

  async load(keys: string[]): Promise<Record<string, unknown>> {
    const site = await this.site();
    if (!site) return this.fallback.load(keys);
    const data = (site.data || {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    keys.forEach((k) => {
      if (data[k] !== undefined) out[k] = data[k];
    });
    // Values written while there was no site record yet.
    const early = await this.fallback.load(keys.filter((k) => out[k] === undefined));
    return { ...early, ...out };
  }

  async save(values: Record<string, unknown>): Promise<void> {
    const site = await this.site();
    if (!site) return this.fallback.save(values);
    const data = { ...((site.data || {}) as Record<string, unknown>), ...clone(values) } as unknown as ProjectData;
    site.data = data;
    site.updatedAt = Date.now();
    site.dirty = true;
    await this.store.put(site);
  }
}
