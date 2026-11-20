import type { Editor } from 'grapesjs';
import { EVENTS } from '../events';
import type { Translator } from '../i18n';
import { META, type PageStore } from '../store/types';
import type { CreateInit, OpenOptions, PageRecord, ProjectData, ResolvedOptions } from '../types';
import { clone, report, sleep, uid } from '../utils';
import { MetaSharedBackend, type SharedBackend } from './SharedData';
import { SnapshotHistory } from './SnapshotHistory';

/** Is the editor still alive? GrapesJS 0.21 sends no `destroy` event. */
export const isEditorAlive = (editor: Editor): boolean => {
  try {
    const em = editor.getModel() as unknown as { destroyed?: boolean } | undefined;
    return !!em && !em.destroyed;
  } catch {
    return false;
  }
};

/**
 * A hook of another plugin on the project of a record: on load it may add
 * to the data (e.g. site-wide CSS rules), on save it takes that out again,
 * so a record stores only its own content. Must be pure and idempotent.
 */
export type RecordHook = (data: ProjectData, rec: PageRecord | undefined) => ProjectData | void | Promise<ProjectData | void>;

export const emptyProject = (): ProjectData =>
  ({
    assets: [],
    styles: [],
    pages: [{ frames: [{ component: { type: 'wrapper', components: [] } }] }],
  }) as unknown as ProjectData;

/**
 * Page lifecycle without any UI: CRUD over the store, loading a page into
 * the editor, debounced autosave and per-page snapshot undo/redo.
 *
 * Every page is a whole GrapesJS project (`getProjectData()`), so switching
 * pages is a `loadProjectData()` of another record.
 *
 * UI and integrations react to the editor events in `EVENTS` instead of
 * being called from here.
 */
export class PagesManager {
  private active: string | null = null;
  private readonly hist = new Map<string, SnapshotHistory>();
  private muted = false;
  private ready = false;
  private dead = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private readonly loadHooks: RecordHook[] = [];
  private readonly saveHooks: RecordHook[] = [];
  private readonly sharedKeys: string[] = [];
  /** Shared values as last loaded or saved (JSON, to compare). */
  private sharedStr: Record<string, string> = {};
  private sharedVals: Record<string, unknown> = {};
  private shared: SharedBackend;

  constructor(
    private readonly editor: Editor,
    readonly store: PageStore,
    private readonly opts: ResolvedOptions,
    private readonly t: Translator
  ) {
    this.readyPromise = new Promise((r) => (this.resolveReady = r));
    this.shared = new MetaSharedBackend(store);
  }

  /* ------------------------------------------------------------------ */
  /* Hooks and shared keys (for other plugins)                          */
  /* ------------------------------------------------------------------ */

  /** Runs on a record's project before it is loaded; returns the remover. */
  addLoadHook(fn: RecordHook): () => void {
    this.loadHooks.push(fn);
    return () => {
      const i = this.loadHooks.indexOf(fn);
      if (i >= 0) this.loadHooks.splice(i, 1);
    };
  }

  /** Runs on the editor's project before it is stored as a record; returns the remover. */
  addSaveHook(fn: RecordHook): () => void {
    this.saveHooks.push(fn);
    return () => {
      const i = this.saveHooks.indexOf(fn);
      if (i >= 0) this.saveHooks.splice(i, 1);
    };
  }

  /** Where the shared keys are kept (remote mode: the site record). */
  setSharedBackend(b: SharedBackend): void {
    this.shared = b;
  }

  sharedKeysList(): string[] {
    return [...this.sharedKeys];
  }

  /** The current value of a shared key (a copy), or undefined. */
  getShared<T = unknown>(key: string): T | undefined {
    const v = this.sharedVals[key];
    return v === undefined ? undefined : clone(v as T);
  }

  /**
   * Makes a key of the project data site-wide: kept once instead of in
   * every record, put into whatever record is opened. If it has no shared
   * value yet, the value in the open record (or the first one opened that
   * has it) becomes the shared one — the migration from per-page copies.
   */
  async shareKey(key: string): Promise<void> {
    if (!key || this.sharedKeys.includes(key)) return;
    this.sharedKeys.push(key);
    const got = await this.shared.load([key]);
    if (got[key] !== undefined) this.remember(key, got[key]);
    if (!this.active || !this.alive()) return;
    // Already open: adopt the editor's value, or give it the shared one.
    const cur = (this.editor.getProjectData() as Record<string, unknown>)[key];
    if (this.sharedVals[key] === undefined) {
      if (cur !== undefined) await this.writeShared({ [key]: cur });
    } else if (JSON.stringify(cur) !== this.sharedStr[key]) {
      this.applyStorable(key, this.sharedVals[key]);
    }
    const hs = this.hist.get(this.active);
    if (hs) hs.replaceCurrent(JSON.stringify(await this.finalize(this.editor.getProjectData() as ProjectData, undefined)));
  }

  /** Sets a shared value from outside (another plugin, an import) and gives it to the open record. */
  async setShared(key: string, value: unknown): Promise<void> {
    if (!this.sharedKeys.includes(key)) this.sharedKeys.push(key);
    if (JSON.stringify(value) === this.sharedStr[key]) return;
    await this.writeShared({ [key]: value });
    if (this.active && this.alive()) this.applyStorable(key, value);
  }

  /**
   * Writes shared values that came from outside (an archive). `overwrite`
   * false keeps the keys that have a value here. Keys no plugin registered
   * are stored too, for when it is installed.
   */
  async importShared(values: Record<string, unknown>, overwrite = true): Promise<void> {
    const cur = await this.shared.load(Object.keys(values));
    const next: Record<string, unknown> = {};
    Object.entries(values).forEach(([k, v]) => {
      if (v !== undefined && (overwrite || cur[k] === undefined)) next[k] = v;
    });
    if (!Object.keys(next).length) return;
    await this.shared.save(next);
    for (const [k, v] of Object.entries(next)) {
      if (!this.sharedKeys.includes(k)) continue;
      this.remember(k, v);
      if (this.active && this.alive()) this.applyStorable(k, v);
      this.emit(EVENTS.shared, { key: k, value: clone(v) });
    }
  }

  /** Reads the shared values again (e.g. the server sent a new site record). */
  async reloadShared(): Promise<void> {
    if (!this.sharedKeys.length) return;
    const got = await this.shared.load(this.sharedKeys);
    for (const k of this.sharedKeys) {
      if (got[k] === undefined || JSON.stringify(got[k]) === this.sharedStr[k]) continue;
      this.remember(k, got[k]);
      if (this.active && this.alive()) this.applyStorable(k, got[k]);
      this.emit(EVENTS.shared, { key: k, value: clone(got[k]) });
    }
  }

  private remember(key: string, value: unknown): void {
    this.sharedVals[key] = clone(value);
    this.sharedStr[key] = JSON.stringify(value);
  }

  private async writeShared(values: Record<string, unknown>): Promise<void> {
    Object.entries(values).forEach(([k, v]) => this.remember(k, v));
    await this.shared.save(values);
    Object.entries(values).forEach(([k, v]) => this.emit(EVENTS.shared, { key: k, value: clone(v) }));
  }

  /** Gives one key to the plugin that owns it, without reloading the whole project. */
  private applyStorable(key: string, value: unknown): void {
    const em = this.editor.getModel() as any;
    const list: any[] = em?.storables || em?.get?.('storables') || [];
    const owner = list.find((s) => s && (s.storageKey === key || (Array.isArray(s.storageKey) && s.storageKey.includes(key))));
    if (!owner?.load) return;
    this.muted = true;
    try {
      owner.load({ [key]: clone(value) });
    } finally {
      this.muted = false;
    }
  }

  /** A record's project as it goes into the editor: hooks, then the shared values. */
  private async materialize(data: ProjectData, rec: PageRecord | undefined): Promise<ProjectData> {
    let d = clone(data) as ProjectData;
    for (const h of this.loadHooks) {
      try {
        const r = await h(d, rec);
        if (r) d = r;
      } catch (e) {
        report(e); // a broken plugin must not keep the record from opening
      }
    }
    const adopt: Record<string, unknown> = {};
    for (const k of this.sharedKeys) {
      const own = (d as Record<string, unknown>)[k];
      if (this.sharedVals[k] !== undefined) (d as Record<string, unknown>)[k] = clone(this.sharedVals[k]);
      else if (own !== undefined) adopt[k] = own; // first record with a per-page copy
    }
    if (Object.keys(adopt).length) await this.writeShared(adopt);
    return d;
  }

  /** The editor's project as a record stores it: no shared keys, save hooks applied. */
  private async finalize(data: ProjectData, rec: PageRecord | undefined): Promise<ProjectData> {
    let d = { ...(data as Record<string, unknown>) } as ProjectData;
    for (const k of this.sharedKeys) delete (d as Record<string, unknown>)[k];
    for (const h of this.saveHooks) {
      try {
        const r = await h(d, rec);
        if (r) d = r;
      } catch (e) {
        report(e);
      }
    }
    return d;
  }

  /** The shared keys of the editor's project, written if they changed. */
  private async collectShared(data: ProjectData): Promise<void> {
    const changed: Record<string, unknown> = {};
    for (const k of this.sharedKeys) {
      const v = (data as Record<string, unknown>)[k];
      if (v !== undefined && JSON.stringify(v) !== this.sharedStr[k]) changed[k] = v;
    }
    if (Object.keys(changed).length) await this.writeShared(changed);
  }

  /** What a record stores: its own content (+ the shared values if it is their owner). */
  private storedForm(id: string, rest: ProjectData): ProjectData {
    if (id !== this.shared.ownerId) return rest;
    const d = { ...(rest as Record<string, unknown>) };
    for (const k of this.sharedKeys) if (this.sharedVals[k] !== undefined) d[k] = clone(this.sharedVals[k]);
    return d as ProjectData;
  }

  get activeId(): string | null {
    return this.active;
  }

  isReady(): boolean {
    return this.ready;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  private alive(): boolean {
    if (this.dead) return false;
    if (!isEditorAlive(this.editor)) {
      this.destroy();
      return false;
    }
    return true;
  }

  private emit(event: string, ...args: unknown[]): void {
    if (this.alive()) this.editor.trigger(event, ...args);
  }

  private emitChange(): void {
    this.emit(EVENTS.change);
  }

  private emitHistory(): void {
    this.emit(EVENTS.history);
  }

  blank(): ProjectData {
    const b = this.opts.blank;
    if (typeof b === 'function') return b();
    if (b) return clone(b);
    return emptyProject();
  }

  /* ------------------------------------------------------------------ */
  /* Loading + autosave                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Loads project data into the editor. Editor events are ignored meanwhile
   * (plus `settleMs` for GrapesJS' deferred updates) so loading never looks
   * like a user edit. Returns the editor-normalized data.
   */
  private async load(data: ProjectData, rec: PageRecord | undefined): Promise<{ data: ProjectData; str: string }> {
    const full = await this.materialize(data, rec);
    this.muted = true;
    try {
      this.editor.loadProjectData(full);
      await sleep(this.opts.settleMs);
      const d = await this.finalize(this.editor.getProjectData() as ProjectData, rec);
      return { data: d, str: JSON.stringify(d) };
    } finally {
      this.muted = false;
    }
  }

  private async persist(id: string, data: ProjectData): Promise<void> {
    const rec = await this.store.get(id);
    if (!rec || rec.deleted) return;
    rec.data = this.storedForm(id, data);
    rec.updatedAt = Date.now();
    rec.dirty = true;
    await this.store.put(rec);
    this.emitChange();
  }

  private async commit(): Promise<void> {
    if (this.muted || !this.ready || !this.active || !this.alive()) return;
    const id = this.active;
    const full = this.editor.getProjectData() as ProjectData;
    await this.collectShared(full);
    const data = await this.finalize(full, await this.store.get(id));
    if (this.active !== id) return; // another record was opened meanwhile
    const hs = this.hist.get(id);
    if (!hs || !hs.push(JSON.stringify(data))) return; // nothing really changed
    await this.persist(id, data);
    this.emitHistory();
  }

  /** Editor change handler: debounced commit. */
  readonly schedule = (): void => {
    if (this.muted || !this.ready || this.dead) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saving = this.saving.then(() => this.commit()).catch(report);
    }, this.opts.autosaveDelay);
  };

  /**
   * Commits the current editor state right away (if it differs from the last
   * snapshot) and waits for every save in flight. It does not rely on a
   * pending autosave timer: GrapesJS reports some changes asynchronously, so
   * an edit made just before a page switch may have no timer yet.
   */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.saving = this.saving.then(() => this.commit()).catch(report);
    await this.saving;
  }

  /** Drops a pending (not yet committed) change and waits for saves in flight. */
  private async discardPending(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.saving;
  }

  /** Best effort for `beforeunload`: start the pending commit now. */
  flushOnUnload(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.commit().catch(report);
  }

  /* ------------------------------------------------------------------ */
  /* Undo / redo                                                        */
  /* ------------------------------------------------------------------ */

  canUndo(): boolean {
    const hs = this.active ? this.hist.get(this.active) : undefined;
    return !!hs && hs.canUndo();
  }

  canRedo(): boolean {
    const hs = this.active ? this.hist.get(this.active) : undefined;
    return !!hs && hs.canRedo();
  }

  private async step(dir: -1 | 1): Promise<boolean> {
    await this.flush();
    const id = this.active;
    const hs = id ? this.hist.get(id) : undefined;
    if (!id || !hs) return false;
    const snap = hs.step(dir);
    if (snap == null) return false;
    const { data, str } = await this.load(JSON.parse(snap), await this.store.get(id));
    hs.replaceCurrent(str);
    await this.persist(id, data);
    this.emitHistory();
    return true;
  }

  /** Undo/redo calls are queued, so fast repeated key presses apply in order. */
  undo(): Promise<boolean> {
    const p = this.queue.then(() => this.step(-1));
    this.queue = p.catch(report);
    return p.catch((e) => (report(e), false));
  }

  redo(): Promise<boolean> {
    const p = this.queue.then(() => this.step(1));
    this.queue = p.catch(report);
    return p.catch((e) => (report(e), false));
  }

  /* ------------------------------------------------------------------ */
  /* CRUD                                                               */
  /* ------------------------------------------------------------------ */

  /** Live (not deleted) pages, oldest first. */
  async list(): Promise<PageRecord[]> {
    return (await this.store.all()).filter((r) => !r.deleted).sort((a, b) => a.createdAt - b.createdAt);
  }

  async nextName(): Promise<string> {
    const base = this.t('defaultName');
    const names = new Set((await this.list()).map((r) => r.name));
    let n = names.size + 1;
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  newRecord(name: string, data: ProjectData, extra: Omit<CreateInit, 'name' | 'data'> = {}): PageRecord {
    const now = Date.now();
    const rec: PageRecord = { id: uid(), name, data, createdAt: now, updatedAt: now, dirty: true, deleted: false, remote: null };
    // Contract v2 fields only when given, so v1 records keep their shape.
    (Object.keys(extra) as (keyof typeof extra)[]).forEach((k) => {
      if (extra[k] !== undefined) (rec as any)[k] = extra[k];
    });
    if (extra.kind || extra.slug || extra.parentId !== undefined || extra.layoutId !== undefined) rec.dirtyMeta = true;
    return rec;
  }

  async open(id: string, { force = false, skipFlush = false, silent = false }: OpenOptions = {}): Promise<void> {
    if (id === this.active && !force) return;
    if (!skipFlush) await this.flush();
    const rec = await this.store.get(id);
    if (!rec || rec.deleted || !this.alive()) return;
    this.active = id;
    await this.store.setMeta(META.active, id);
    let data = rec.data || this.blank();
    if (this.prepare) {
      try {
        data = await this.prepare(data, rec);
      } catch (e) {
        report(e); // a broken component must not keep the page from opening
      }
    }
    if (this.active !== id || !this.alive()) return; // another open() won meanwhile
    const { str } = await this.load(data, rec);
    const hs = this.hist.get(id);
    if (hs) hs.replaceCurrent(str);
    else this.hist.set(id, new SnapshotHistory(str, this.opts.historyLimit));
    this.emitHistory();
    this.emitChange();
    if (!silent) this.emit(EVENTS.open, rec);
  }

  /**
   * Hook run on the project data of a record right before it is loaded into
   * the editor (linked components expand their instances here). The stored
   * record is not changed.
   */
  private prepare: ((data: ProjectData, rec: PageRecord) => ProjectData | Promise<ProjectData>) | null = null;

  setPrepare(fn: ((data: ProjectData, rec: PageRecord) => ProjectData | Promise<ProjectData>) | null): void {
    this.prepare = fn;
  }

  /** Stores a new record without opening it. */
  async add(rec: PageRecord): Promise<PageRecord> {
    await this.store.put(rec);
    this.emitChange();
    return rec;
  }

  async create({ name, data, ...extra }: CreateInit = {}): Promise<PageRecord> {
    await this.flush();
    const rec = this.newRecord(name || (await this.nextName()), data ? clone(data) : this.blank(), extra);
    await this.store.put(rec);
    await this.open(rec.id, { force: true });
    return rec;
  }

  async duplicate(id: string): Promise<PageRecord | undefined> {
    await this.flush();
    const src = await this.store.get(id);
    if (!src || src.deleted) return undefined;
    return this.create({
      name: `${src.name} (${this.t('copySuffix')})`,
      data: src.data || this.blank(),
      ...(src.kind ? { kind: src.kind } : {}),
      ...(src.kind === 'page' || (!src.kind && src.layoutId) ? { parentId: src.parentId ?? null, layoutId: src.layoutId ?? null } : {}),
    });
  }

  async rename(id: string, name: string): Promise<boolean> {
    const rec = await this.store.get(id);
    const next = (name || '').trim();
    if (!rec || !next || next === rec.name) return false;
    rec.name = next;
    rec.updatedAt = Date.now();
    rec.dirty = true;
    await this.store.put(rec);
    this.emitChange();
    return true;
  }

  /**
   * Deletes a page. A page that has been on the server becomes a tombstone,
   * deleted on the server at the next sync. When the active page goes, the
   * first remaining page is opened (or a new blank one is created).
   */
  async remove(id: string): Promise<boolean> {
    const rec = await this.store.get(id);
    if (!rec || rec.deleted) return false;
    const wasActive = id === this.active;
    if (wasActive) await this.discardPending();
    if (rec.remote) {
      rec.deleted = true;
      rec.dirty = true;
      await this.store.put(rec);
    } else {
      await this.store.delete(id);
    }
    this.hist.delete(id);
    if (wasActive) {
      this.active = null;
      const rest = await this.list();
      // Prefer a page over a layout, a template or a component.
      const next = rest.find((r) => (r.kind || 'page') === 'page' && !r.templateId) || rest[0];
      if (next) await this.open(next.id, { force: true, skipFlush: true });
      else await this.create();
    } else {
      this.emitChange();
    }
    return true;
  }

  /**
   * Lets go of the canvas: pending changes of the active record are saved,
   * then nothing is open and editor changes are not saved anywhere until
   * the next `open()`. For another plugin that loads its own content into
   * the editor (grapesjs-storage's entries).
   */
  async detach(): Promise<void> {
    await this.flush();
    if (!this.active) return;
    this.active = null;
    this.emitHistory();
    this.emitChange();
    this.emit(EVENTS.detach);
  }

  /**
   * Writes a record that came from outside (e.g. the server) and, if it is
   * the active page, reloads it. Pending local edits of that page are
   * discarded — the caller decided the external version wins.
   */
  async replaceRecord(rec: PageRecord): Promise<void> {
    const isActive = rec.id === this.active;
    if (isActive) await this.discardPending();
    await this.store.put(rec);
    this.hist.delete(rec.id);
    if (isActive) await this.open(rec.id, { force: true, skipFlush: true });
    else this.emitChange();
  }

  /* ------------------------------------------------------------------ */
  /* Start / stop                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Opens the last active page. On an empty store the current editor
   * content becomes "Page 1" (so `components`/`projectData` given to
   * `grapesjs.init` are not lost).
   */
  async start(): Promise<void> {
    const pages = await this.list();
    if (!this.alive()) return;
    // Layouts, templates, the site and entries are not pages: a remote site
    // without pages gets its home page from the editor content too.
    if (this.sharedKeys.length) {
      const got = await this.shared.load(this.sharedKeys);
      Object.entries(got).forEach(([k, v]) => this.remember(k, v));
    }
    if (!pages.some((p) => (p.kind || 'page') === 'page' && !p.templateId)) {
      const full = this.editor.getProjectData() as ProjectData;
      // The editor keeps its content (no load). A shared value that exists
      // wins (the site's, e.g. from the server); the initial content only
      // fills keys that have none yet.
      const adopt: Record<string, unknown> = {};
      for (const k of this.sharedKeys) {
        const own = (full as Record<string, unknown>)[k];
        if (this.sharedVals[k] === undefined) {
          if (own !== undefined) adopt[k] = own;
        } else if (JSON.stringify(own) !== this.sharedStr[k]) this.applyStorable(k, this.sharedVals[k]);
      }
      if (Object.keys(adopt).length) await this.writeShared(adopt);
      const data = await this.finalize(full, undefined);
      const rec = this.newRecord(`${this.t('defaultName')} 1`, data, this.opts.remote ? { kind: 'page', slug: '/' } : {});
      await this.store.put(rec);
      this.active = rec.id;
      await this.store.setMeta(META.active, rec.id);
      this.hist.set(rec.id, new SnapshotHistory(JSON.stringify(data), this.opts.historyLimit));
    } else {
      const last = await this.store.getMeta<string>(META.active);
      // Back to the last open record; else the first page (not a layout,
      // a template, the site or an entry).
      const target =
        pages.find((p) => p.id === last) || pages.find((p) => (p.kind || 'page') === 'page' && !p.templateId) || pages[0];
      await this.open(target.id, { force: true });
    }
    this.ready = true;
    this.resolveReady();
    this.emitHistory();
    this.emitChange();
    this.emit(EVENTS.ready);
  }

  destroy(): void {
    this.dead = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
