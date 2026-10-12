import type { Editor } from 'grapesjs';
import type { PagesManager } from '../core/PagesManager';
import { EVENTS } from '../events';
import type { Translator } from '../i18n';
import { META, type PageStore } from '../store/types';
import type { PageRecord, ResolvedOptions, ServerSettings } from '../types';
import { normalizeUrl } from '../utils';
import { buildPlan, type SyncPlanItem } from './plan';
import { HttpError, RestClient } from './RestClient';

export interface SyncResult {
  ok: number;
  errors: Array<{ item: SyncPlanItem; error: Error }>;
}

/**
 * Manual sync with the REST server: settings, plan, apply.
 * Nothing is sent until the user applies a plan.
 */
export class SyncService {
  settings: ServerSettings;
  lastSync: number | null = null;
  readonly client: RestClient;

  constructor(
    private readonly editor: Editor,
    private readonly manager: PagesManager,
    private readonly store: PageStore,
    opts: ResolvedOptions,
    private readonly t: Translator,
    fetchImpl?: typeof fetch
  ) {
    this.settings = { url: normalizeUrl(opts.serverUrl), token: '' };
    this.client = new RestClient({
      getSettings: () => this.settings,
      headers: opts.headers,
      messages: { noServer: () => t('noServer'), conflict: () => t('conflictErr') },
      fetch: fetchImpl,
    });
  }

  get configured(): boolean {
    return !!this.settings.url;
  }

  /** Loads saved settings; a saved empty URL falls back to the `serverUrl` option. */
  async restore(): Promise<void> {
    const saved = await this.store.getMeta<Partial<ServerSettings>>(META.settings);
    if (saved) {
      this.settings = {
        ...this.settings,
        ...saved,
        url: normalizeUrl(saved.url || this.settings.url),
        token: saved.token || '',
      };
    }
    this.lastSync = (await this.store.getMeta<number>(META.lastSync)) || null;
  }

  async setSettings(s: Partial<ServerSettings>): Promise<void> {
    this.settings = {
      ...this.settings,
      ...s,
      url: normalizeUrl(s.url != null ? s.url : this.settings.url),
      token: (s.token != null ? s.token : this.settings.token).trim(),
    };
    await this.store.setMeta(META.settings, this.settings);
    this.editor.trigger(EVENTS.settings, { ...this.settings });
  }

  /** Checks a URL/token pair without saving it. Resolves to the page count. */
  async test(settings: ServerSettings): Promise<number> {
    return (await this.client.listPages({ url: normalizeUrl(settings.url), token: settings.token.trim() })).length;
  }

  /** Saves pending edits, then compares local pages with the server listing. */
  async plan(): Promise<SyncPlanItem[]> {
    await this.manager.flush();
    const listing = await this.client.listPages();
    return buildPlan(await this.store.all(), listing);
  }

  /** Runs the enabled items one by one; errors do not stop the run. */
  async apply(items: SyncPlanItem[]): Promise<SyncResult> {
    const result: SyncResult = { ok: 0, errors: [] };
    for (const it of items) {
      if (it.enabled === false || it.kind === 'same') continue;
      try {
        await this.runItem(it);
        result.ok++;
      } catch (e) {
        result.errors.push({ item: it, error: e instanceof Error ? e : new Error(String(e)) });
      }
    }
    this.lastSync = Date.now();
    await this.store.setMeta(META.lastSync, this.lastSync);
    this.editor.trigger(EVENTS.change);
    this.editor.trigger(EVENTS.sync, result);
    return result;
  }

  async runItem(it: SyncPlanItem): Promise<void> {
    if (it.kind === 'conflict') {
      const choice = it.choice || 'local';
      if (choice === 'local') return this.push(it.id, true);
      if (choice === 'remote') return this.pull(it.id);
      await this.pull(it.id, { asNew: true });
      return this.push(it.id, true);
    }
    switch (it.kind) {
      case 'push':
        return this.push(it.id, false);
      case 'pull':
        return this.pull(it.id);
      case 'del': {
        try {
          await this.client.deletePage(it.id, it.local?.remote?.version);
        } catch (e) {
          if (!(e instanceof HttpError && e.status === 404)) throw e;
        }
        await this.store.delete(it.id);
        return;
      }
      case 'purge':
        await this.store.delete(it.id);
        return;
      default:
    }
  }

  /** Uploads the current local version; `force` skips `If-Match`. */
  async push(id: string, force: boolean): Promise<void> {
    const rec = await this.store.get(id);
    if (!rec) return;
    const meta = await this.client.putPage(rec, force ? null : (rec.remote?.version ?? null));
    const cur = await this.store.get(id);
    if (!cur) return;
    cur.remote = { version: meta.version, updatedAt: meta.updatedAt };
    // Only clean if nothing was edited while the request was in flight.
    if (cur.updatedAt === rec.updatedAt) cur.dirty = false;
    await this.store.put(cur);
  }

  /** Downloads a page; `asNew` stores it as a new local copy ("… (server)"). */
  async pull(id: string, { asNew = false } = {}): Promise<void> {
    const p = await this.client.getPage(id);
    if (asNew) {
      await this.store.put(this.manager.newRecord(`${p.name} (${this.t('serverSuffix')})`, p.data));
      return;
    }
    const cur = await this.store.get(id);
    const now = Date.now();
    const rec: PageRecord = {
      ...(cur || ({} as PageRecord)),
      id,
      name: p.name,
      data: p.data,
      createdAt: cur?.createdAt || now,
      updatedAt: now,
      dirty: false,
      deleted: false,
      remote: { version: p.version, updatedAt: p.updatedAt },
    };
    await this.manager.replaceRecord(rec);
  }
}
