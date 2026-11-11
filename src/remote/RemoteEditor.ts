import type { Editor } from 'grapesjs';
import type { PagesManager } from '../core/PagesManager';
import { EVENTS } from '../events';
import type { Translator } from '../i18n';
import { IndexedDbPageStore } from '../store/IndexedDbPageStore';
import type { PageStore } from '../store/types';
import type { PageRecord, RecordKind, RecordPatch, Revision } from '../types';
import { clone, uid } from '../utils';
import { fromWire, SITE_ID } from './RemoteClient';
import type { RemotePageStore } from './RemotePageStore';

/** A page address: `/` or `/a/b-c` (lower case, dashes). */
export function normalizeSlug(raw: string): string {
  const parts = String(raw || '')
    .toLowerCase()
    .split('/')
    .map((p) =>
      p
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    )
    .filter(Boolean);
  return '/' + parts.join('/');
}

const kindOf = (r: PageRecord): RecordKind => r.kind || 'page';

/** The meta key a v1 database gets once imported into a server. */
export const importedKey = (url: string): string => `importedTo:${url}`;

/**
 * Remote-mode actions on top of `RemotePageStore`: header edits, publishing,
 * revisions, conflicts and the v1 import. No DOM: the sidebar calls these.
 */
export class RemoteEditor {
  constructor(
    private readonly editor: Editor,
    private readonly manager: PagesManager,
    readonly store: RemotePageStore,
    private readonly t: Translator,
    private readonly v1Store: () => PageStore = () => new IndexedDbPageStore()
  ) {}

  private emit(event: string, ...args: unknown[]): void {
    this.editor.trigger(event, ...args);
  }

  private async must(id: string): Promise<PageRecord> {
    const rec = await this.store.get(id);
    if (!rec || rec.deleted) throw new Error(`no record ${id}`);
    return rec;
  }

  /** Header fields: name, slug, parent, layout, position, values (null deletes). */
  async update(id: string, patch: RecordPatch): Promise<PageRecord | undefined> {
    const rec = await this.store.get(id);
    if (!rec || rec.deleted) return undefined;
    if (patch.name != null && patch.name.trim()) rec.name = patch.name.trim();
    if (kindOf(rec) === 'page') {
      if (patch.slug != null) rec.slug = normalizeSlug(patch.slug);
      if (patch.parentId !== undefined) rec.parentId = patch.parentId && patch.parentId !== id ? patch.parentId : null;
      if (patch.layoutId !== undefined) rec.layoutId = patch.layoutId || null;
      if (patch.position != null && Number.isFinite(patch.position)) rec.position = Math.trunc(patch.position);
    }
    if (patch.values && (kindOf(rec) === 'page' || kindOf(rec) === 'site')) {
      const values = { ...(rec.values || {}) };
      const dirty = new Set(rec.dirtyValues || []);
      Object.entries(patch.values).forEach(([k, v]) => {
        const next = v === null || v === undefined || v === '' ? undefined : v;
        if (JSON.stringify(next) === JSON.stringify(values[k])) return; // unchanged: not sent
        if (next === undefined) delete values[k];
        else values[k] = next;
        dirty.add(k);
      });
      rec.values = values;
      // The site's settings are sent whole; a page's values key by key.
      rec.dirtyValues = kindOf(rec) === 'page' ? [...dirty] : [];
    }
    rec.dirtyMeta = true;
    rec.updatedAt = Date.now();
    await this.store.put(rec);
    this.emit(EVENTS.change);
    return rec;
  }

  /** The canvas content as a page body (no <body> wrapper) and its CSS. */
  private markup(kind: RecordKind): { html: string; css: string } {
    const wrapper = this.editor.getWrapper();
    const html = wrapper ? wrapper.getInnerHTML() : this.editor.getHtml();
    // The site's CSS carries the base rules (box-sizing, body margin); the
    // other kinds leave them out so they are not repeated on every page.
    const css = (this.editor.getCss({ avoidProtected: kind !== 'site' } as any) as string) || '';
    return { html, css };
  }

  /**
   * Makes a record live. It is saved first (a conflict or an offline
   * server stops here). Pages, layouts and templates send their HTML and
   * CSS, the site its CSS, an entry nothing (its values go live).
   */
  async publish(id = this.manager.activeId || ''): Promise<PageRecord> {
    let rec = await this.must(id);
    const kind = kindOf(rec);
    const entry = kind === 'page' && !!rec.templateId;
    if (!entry && id !== this.manager.activeId) await this.manager.open(id);
    if (id === this.manager.activeId) await this.manager.flush();
    rec = await this.store.pushNow(id);
    const body = entry ? {} : kind === 'site' ? { css: this.markup(kind).css } : this.markup(kind);
    const res = await this.store.client.publish(kind, kind === 'site' ? SITE_ID : id, body, rec.remote?.version ?? null);
    const next = fromWire({ ...res.record, data: undefined, values: undefined }, kind, rec);
    await this.store.cache.put(next);
    this.emit(EVENTS.publish, { record: next, revision: res.revision, warnings: res.warnings || [] });
    this.emit(EVENTS.change);
    return next;
  }

  /** Takes a page off the site. */
  async unpublish(id: string): Promise<PageRecord> {
    const rec = await this.store.pushNow(id);
    const w = await this.store.client.unpublish(id, rec.remote?.version ?? null);
    const next = fromWire({ ...w, data: undefined, values: undefined }, 'page', rec);
    await this.store.cache.put(next);
    this.emit(EVENTS.change);
    return next;
  }

  async revisions(id: string): Promise<Revision[]> {
    const rec = await this.must(id);
    return this.store.client.revisions(kindOf(rec), kindOf(rec) === 'site' ? SITE_ID : id);
  }

  /**
   * The revision's project becomes the draft and is reopened (it is not
   * published). Local edits are saved first; the restore replaces them
   * (they survive only if they were published as a revision).
   */
  async restore(id: string, revision: number): Promise<void> {
    const rec = await this.must(id);
    const kind = kindOf(rec);
    if (kind === 'site') throw new Error('the site has no restore');
    if (id === this.manager.activeId) await this.manager.flush();
    const cur = await this.store.pushNow(id);
    const w = await this.store.client.restore(kind, id, revision, cur.remote?.version ?? null);
    const next = fromWire({ ...w, values: undefined }, kind, cur);
    await this.manager.replaceRecord(next);
    this.emit(EVENTS.change);
  }

  /** Ends a conflict; `both` keeps the local version as a new record first. */
  async resolve(id: string, choice: 'local' | 'remote' | 'both'): Promise<void> {
    const rec = await this.must(id);
    if (choice === 'both') {
      const copy: PageRecord = {
        ...clone(rec),
        id: uid(),
        name: `${rec.name} (${this.t('copySuffix')})`,
        remote: null,
        conflict: false,
        dirty: true,
        dirtyMeta: true,
        dirtyValues: Object.keys(rec.values || {}),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      if (copy.slug) copy.slug = `${copy.slug === '/' ? '' : copy.slug}/${this.t('copySuffix')}`.replace(/\/+/g, '/');
      await this.store.put(copy);
      choice = 'remote';
    }
    await this.store.resolve(id, choice);
    this.emit(EVENTS.change);
  }

  /** Pages of the v1 local database not yet imported into this server. */
  async localPages(): Promise<PageRecord[]> {
    const v1 = this.v1Store();
    try {
      if (await v1.getMeta(importedKey(this.store.client.base))) return [];
      return (await v1.all()).filter((r) => !r.deleted && !r.kind && r.data);
    } catch {
      return []; // no IndexedDB, or no v1 database
    } finally {
      v1.close?.();
    }
  }

  /** Uploads the v1 local pages as new free pages (new ids, slugs from their names). */
  async importLocal(): Promise<number> {
    const pages = await this.localPages();
    for (const p of pages) {
      const rec = this.manager.newRecord(p.name, p.data, { kind: 'page' });
      rec.createdAt = p.createdAt;
      await this.store.put(rec);
    }
    const v1 = this.v1Store();
    try {
      await v1.setMeta(importedKey(this.store.client.base), Date.now());
    } finally {
      v1.close?.();
    }
    this.emit(EVENTS.change);
    return pages.length;
  }
}
