import type { Editor } from 'grapesjs';
import { EVENTS } from '../events';
import type { Translator } from '../i18n';
import { META, type PageStore } from '../store/types';
import type { OpenOptions, PageRecord, ProjectData, ResolvedOptions } from '../types';
import { clone, report, sleep, uid } from '../utils';
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

  constructor(
    private readonly editor: Editor,
    readonly store: PageStore,
    private readonly opts: ResolvedOptions,
    private readonly t: Translator
  ) {
    this.readyPromise = new Promise((r) => (this.resolveReady = r));
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
  private async load(data: ProjectData): Promise<{ data: ProjectData; str: string }> {
    this.muted = true;
    try {
      this.editor.loadProjectData(clone(data));
      await sleep(this.opts.settleMs);
      const d = this.editor.getProjectData() as ProjectData;
      return { data: d, str: JSON.stringify(d) };
    } finally {
      this.muted = false;
    }
  }

  private async persist(id: string, data: ProjectData): Promise<void> {
    const rec = await this.store.get(id);
    if (!rec || rec.deleted) return;
    rec.data = data;
    rec.updatedAt = Date.now();
    rec.dirty = true;
    await this.store.put(rec);
    this.emitChange();
  }

  private async commit(): Promise<void> {
    if (this.muted || !this.ready || !this.active || !this.alive()) return;
    const id = this.active;
    const data = this.editor.getProjectData() as ProjectData;
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
    const { data, str } = await this.load(JSON.parse(snap));
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

  newRecord(name: string, data: ProjectData): PageRecord {
    const now = Date.now();
    return { id: uid(), name, data, createdAt: now, updatedAt: now, dirty: true, deleted: false, remote: null };
  }

  async open(id: string, { force = false, skipFlush = false }: OpenOptions = {}): Promise<void> {
    if (id === this.active && !force) return;
    if (!skipFlush) await this.flush();
    const rec = await this.store.get(id);
    if (!rec || rec.deleted || !this.alive()) return;
    this.active = id;
    await this.store.setMeta(META.active, id);
    const { str } = await this.load(rec.data);
    const hs = this.hist.get(id);
    if (hs) hs.replaceCurrent(str);
    else this.hist.set(id, new SnapshotHistory(str, this.opts.historyLimit));
    this.emitHistory();
    this.emitChange();
    this.emit(EVENTS.open, rec);
  }

  async create({ name, data }: { name?: string; data?: ProjectData } = {}): Promise<PageRecord> {
    await this.flush();
    const rec = this.newRecord(name || (await this.nextName()), data ? clone(data) : this.blank());
    await this.store.put(rec);
    await this.open(rec.id, { force: true });
    return rec;
  }

  async duplicate(id: string): Promise<PageRecord | undefined> {
    await this.flush();
    const src = await this.store.get(id);
    if (!src || src.deleted) return undefined;
    return this.create({ name: `${src.name} (${this.t('copySuffix')})`, data: src.data });
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
      if (rest.length) await this.open(rest[0].id, { force: true, skipFlush: true });
      else await this.create();
    } else {
      this.emitChange();
    }
    return true;
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
    if (!pages.length) {
      const data = this.editor.getProjectData() as ProjectData;
      const rec = this.newRecord(`${this.t('defaultName')} 1`, data);
      await this.store.put(rec);
      this.active = rec.id;
      await this.store.setMeta(META.active, rec.id);
      this.hist.set(rec.id, new SnapshotHistory(JSON.stringify(data), this.opts.historyLimit));
    } else {
      const last = await this.store.getMeta<string>(META.active);
      const target = pages.find((p) => p.id === last) || pages[0];
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
