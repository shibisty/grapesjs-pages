import type { Editor } from 'grapesjs';
import type { PagesManager } from '../core/PagesManager';
import { EVENTS } from '../events';
import { canvasMarkup, normalizeSlug, type RemoteEditor } from '../remote/RemoteEditor';
import { SITE_ID } from '../remote/RemoteClient';
import type { PageStore } from '../store/types';
import type { PageRecord, RecordKind } from '../types';
import { clone, report, uuid } from '../utils';
import { type ArchiveRecord, importOrder, packArchive, readArchive } from './format';

export interface ExportOptions {
  /**
   * Also write each record's HTML and CSS (`body.html`, `style.css`,
   * `index.html`): every record is opened in the editor once, as a publish
   * would. Default `true`. Without it the archive holds the projects only.
   */
  html?: boolean;
  /** Called after each record: `(done, total)`. */
  onProgress?: (done: number, total: number) => void;
}

export type ImportMode = 'replace' | 'copy';

export interface ImportOptions {
  /**
   * `replace` (default): a record that exists here (same id; a page also
   * by its address, a layout or template by its name) is overwritten.
   * `copy`: everything comes in as new records with new ids; addresses
   * that are taken get a free one (`-2`, `-3`…).
   */
  mode?: ImportMode;
  /** Import the site record (styles and settings). Default: `true` with `replace`, `false` with `copy`. */
  site?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface ImportReport {
  created: number;
  updated: number;
  /** Records this mode cannot hold (layouts, templates and the site in local mode). */
  skipped: number;
  /** Records whose HTML or CSS was edited outside and was imported from it. */
  fromMarkup: number;
  errors: Array<{ id: string; name: string; error: string }>;
  /** Archive id → id here. */
  ids: Record<string, string>;
}

const kindOf = (r: PageRecord): RecordKind => r.kind || 'page';

/** Bytes of a file (older engines have no `Blob.arrayBuffer`). */
async function toBytes(input: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  const blob = input as Blob;
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

/** Records an archive holds: designs, not entries. */
const exportable = (r: PageRecord): boolean => !r.deleted && !(kindOf(r) === 'page' && r.templateId);

/**
 * Export and import of the whole site as a ZIP (`format.ts`). Works in
 * both modes: in local mode the archive holds the pages; in remote mode
 * also the layouts, templates (with their field lists) and the site.
 */
export class ArchiveService {
  constructor(
    private readonly editor: Editor,
    private readonly manager: PagesManager,
    private readonly store: PageStore,
    private readonly remote: RemoteEditor | null
  ) {}

  /** The records as archive records (projects, header fields, field lists, optionally markup). */
  async collect(opts: ExportOptions = {}): Promise<ArchiveRecord[]> {
    await this.manager.flush();
    if (this.remote) await this.remote.store.refresh().catch(report);
    const recs = (await this.manager.list()).filter(exportable);
    const out: ArchiveRecord[] = [];
    for (const r of recs) {
      const kind = kindOf(r);
      const a: ArchiveRecord = { id: r.id, kind, name: r.name, data: r.data ? clone(r.data) : null };
      if (kind === 'page') {
        if (r.slug) a.slug = r.slug;
        a.parentId = r.parentId ?? null;
        a.layoutId = r.layoutId ?? null;
        a.position = r.position ?? 0;
      }
      if (r.values && Object.keys(r.values).length) a.values = clone(r.values);
      if (kind === 'template' && this.remote) {
        try {
          const w = await this.remote.store.client.get('template', r.id);
          if (Array.isArray(w.fields)) a.fields = w.fields;
        } catch (e) {
          report(e);
        }
      }
      out.push(a);
    }
    if (opts.html !== false) await this.render(out, recs, opts.onProgress);
    return out;
  }

  /** Opens every record once and takes what a publish would send. */
  private async render(out: ArchiveRecord[], recs: PageRecord[], onProgress?: ExportOptions['onProgress']): Promise<void> {
    const before = this.manager.activeId;
    const byId = new Map(recs.map((r) => [r.id, r]));
    let done = 0;
    try {
      for (const a of out) {
        const rec = byId.get(a.id)!;
        await this.manager.open(a.id, { silent: true });
        const m = this.remote ? await this.remote.publishMarkup(a.kind, rec) : canvasMarkup(this.editor, a.kind);
        if (a.kind !== 'site') a.html = m.html;
        a.css = m.css;
        onProgress?.(++done, out.length);
      }
    } finally {
      // Back to where the user was (nothing open: an entry of grapesjs-storage
      // had the canvas, which this export took).
      if (before) await this.manager.open(before, { force: this.manager.activeId !== before }).catch(report);
      else if (this.manager.activeId) await this.manager.detach().catch(report);
    }
  }

  /** The site as ZIP bytes. */
  async exportBytes(opts: ExportOptions = {}): Promise<Uint8Array> {
    const records = await this.collect(opts);
    const site = records.find((r) => r.kind === 'site');
    return packArchive(records, { generator: 'grapesjs-pages', source: this.remote?.store.client.base || 'local', name: site?.name || undefined });
  }

  /** Reads an archive and writes its records here. */
  async import(input: Blob | ArrayBuffer | Uint8Array, opts: ImportOptions = {}): Promise<ImportReport> {
    const bytes = await toBytes(input);
    const arc = readArchive(bytes);
    const mode: ImportMode = opts.mode === 'copy' ? 'copy' : 'replace';
    const withSite = opts.site ?? mode === 'replace';
    const report_: ImportReport = { created: 0, updated: 0, skipped: 0, fromMarkup: arc.edited.length, errors: [], ids: {} };

    await this.manager.flush();
    const all = (await this.store.all()).filter((r) => !r.deleted);
    const here = new Map(all.map((r) => [r.id, r]));
    const usedSlugs = new Set(all.filter((r) => kindOf(r) === 'page').map((r) => r.slug || ''));
    const usedIds = new Set(all.map((r) => r.id));

    let records = arc.records.filter((r) => {
      const ok = this.remote ? r.kind !== 'site' || withSite : r.kind === 'page';
      if (!ok) report_.skipped++;
      return ok;
    });
    records = importOrder(records);

    // Archive id → id here.
    const ids = new Map<string, string>();
    const target = (a: ArchiveRecord): PageRecord | undefined => {
      if (a.kind === 'site') return here.get(SITE_ID);
      if (mode === 'copy') return undefined;
      const same = here.get(a.id);
      if (same && kindOf(same) === a.kind && !same.templateId) return same;
      if (same) return undefined; // the id is taken by another kind: a new one
      if (a.kind === 'page') {
        const slug = a.slug ? normalizeSlug(a.slug) : '';
        return slug ? all.find((r) => kindOf(r) === 'page' && !r.templateId && (r.slug || '') === slug) : undefined;
      }
      return all.find((r) => kindOf(r) === a.kind && r.name === a.name);
    };
    const plan = records.map((a) => {
      const cur = target(a);
      let id: string;
      if (a.kind === 'site') id = SITE_ID;
      else if (cur) id = cur.id;
      else if (mode === 'replace' && !usedIds.has(a.id) && /^[0-9a-f-]{36}$/i.test(a.id)) id = a.id;
      else id = uuid();
      usedIds.add(id);
      ids.set(a.id, id);
      return { a, cur, id };
    });

    const freeSlug = (want: string, self: PageRecord | undefined): string => {
      let slug = normalizeSlug(want || '/');
      if (self && (self.slug || '') === slug) return slug;
      if (!usedSlugs.has(slug)) return slug;
      const base = slug === '/' ? '/home' : slug;
      if (!usedSlugs.has(base)) return base;
      for (let n = 2; ; n++) if (!usedSlugs.has(`${base}-${n}`)) return `${base}-${n}`;
    };

    const active = this.manager.activeId;
    let reopen = false;
    let done = 0;
    for (const { a, cur, id } of plan) {
      try {
        const rec = this.recordFor(a, cur, id, ids, freeSlug, (x) => here.has(x));
        if (rec.slug) {
          if (cur?.slug) usedSlugs.delete(cur.slug);
          usedSlugs.add(rec.slug);
        }
        await this.store.put(rec);
        if (this.remote) {
          await this.remote.store.pushNow(id);
          if (a.kind === 'template' && a.fields) await this.putFields(id, rec.name, a.fields);
        }
        if (cur) report_.updated++;
        else report_.created++;
        if (id === active) reopen = true;
        report_.ids[a.id] = id;
      } catch (e) {
        report_.errors.push({ id: a.id, name: a.name, error: (e as Error)?.message || String(e) });
      }
      opts.onProgress?.(++done, plan.length);
    }
    if (reopen && active) await this.manager.open(active, { force: true, skipFlush: true }).catch(report);
    this.editor.trigger(EVENTS.change);
    return report_;
  }

  /** The local record an archive record becomes. */
  private recordFor(
    a: ArchiveRecord,
    cur: PageRecord | undefined,
    id: string,
    ids: Map<string, string>,
    freeSlug: (want: string, self: PageRecord | undefined) => string,
    exists: (id: string) => boolean
  ): PageRecord {
    const now = Date.now();
    const data = a.data ? clone(a.data) : this.manager.blank();
    const rec: PageRecord = cur
      ? { ...clone(cur), name: a.name, data, dirty: true, dirtyMeta: true, conflict: false, deleted: false, updatedAt: now }
      : { id, name: a.name, data, createdAt: now, updatedAt: now, dirty: true, deleted: false, remote: null };
    if (this.remote) {
      rec.kind = a.kind;
      rec.dirtyMeta = true;
    }
    if (a.kind === 'page' && this.remote) {
      rec.slug = freeSlug(a.slug || '/' + (a.name || 'page'), cur);
      // A reference to a record that is not in the archive stays as it is
      // (it may exist here); one that is in it follows the new id.
      rec.parentId = a.parentId ? ids.get(a.parentId) || a.parentId : null;
      rec.layoutId = a.layoutId ? ids.get(a.layoutId) || a.layoutId : null;
      if (rec.parentId && !ids.has(a.parentId!) && !exists(rec.parentId)) rec.parentId = null;
      if (rec.layoutId && !ids.has(a.layoutId!) && !exists(rec.layoutId)) rec.layoutId = null;
      rec.position = a.position ?? 0;
      // Values as in the archive: keys it lacks are deleted.
      const next = a.values ? clone(a.values) : {};
      const keys = new Set([...Object.keys(cur?.values || {}), ...Object.keys(next)]);
      rec.values = next;
      rec.dirtyValues = [...keys];
    }
    if (a.kind === 'site') {
      rec.values = { ...(cur?.values || {}), ...(a.values || {}) };
      rec.dirtyValues = [];
    }
    return rec;
  }

  /** A template's field list (luna-pages keeps it when a design save omits it). */
  private async putFields(id: string, name: string, fields: unknown[]): Promise<void> {
    const r = this.remote!;
    const rec = await r.store.get(id);
    const w = await r.store.client.put('template', id, { name, fields } as any, rec?.remote?.version ?? null);
    if (rec) {
      rec.remote = { version: w.version, updatedAt: w.updated_at };
      await r.store.cache.put(rec);
    }
  }
}
