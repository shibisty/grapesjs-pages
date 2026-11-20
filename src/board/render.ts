import type { Editor } from 'grapesjs';
import type { PagesManager } from '../core/PagesManager';
import { runMarkupHooks, type MarkupHook } from '../remote/RemoteEditor';
import type { PageRecord, RecordKind } from '../types';
import { report } from '../utils';
import type { BoardSnapshot } from './Board';

import { EVENTS } from '../events';

const RENDERING_EVENT = EVENTS.rendering;

const SNAP_META = 'board:snap:';

/**
 * Renders records for the board one at a time, the way a publish does:
 * the record is opened in the editor silently, other plugins get
 * `pages-manager:rendering` to load what it shows (grapesjs-storage: its
 * data), then the markup goes through the publish hooks. Kept by the
 * record's (and its design's) `updatedAt`, in memory and in the store.
 * `finish()` puts the editor back on a record.
 */
export class BoardRenderer {
  private queue: Array<{ id: string; force: boolean; resolve(s: BoardSnapshot | null): void }> = [];
  private running: Promise<void> | null = null;
  private touched = false;
  private readonly cache = new Map<string, { key: string; snap: BoardSnapshot }>();
  private disposed = false;

  /**
   * Live board: after a batch the canvas gets back the record being edited
   * (`home`), and `busy` tells when the canvas holds other records.
   */
  live: { home(): string | null; busy(b: boolean): void; restored?(): void } | null = null;
  private home: string | null = null;
  private selectedId: string | null = null;

  constructor(
    private readonly editor: Editor,
    private readonly manager: PagesManager,
    private readonly hooks: () => MarkupHook[],
    private readonly meta: { get<T>(k: string): Promise<T | undefined>; set<T>(k: string, v: T): Promise<void> }
  ) {}

  /** The canvas holds another record than the one being edited (a render is running). */
  get busy(): boolean {
    return !!this.running;
  }

  /** Resolves when nothing is being rendered (the canvas holds the record being edited). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  /** The open record's markup as it is now (no open: the record being edited, after a change). */
  async snapshotNow(): Promise<{ id: string; snap: BoardSnapshot } | null> {
    if (this.running || !this.alive()) return null;
    const id = this.manager.activeId;
    if (!id) return null;
    await this.manager.flush();
    const rec = await this.manager.store.get(id);
    if (!rec || this.running || this.manager.activeId !== id) return null;
    const snap = await runMarkupHooks(this.editor, (rec.kind || 'page') as RecordKind, rec, this.hooks());
    const entry = { key: await this.keyOf(rec), snap };
    this.cache.set(id, entry);
    void this.meta.set(SNAP_META + id, entry).catch(report);
    return { id, snap };
  }

  /** The editor is going away: nothing more is rendered. */
  dispose(): void {
    this.disposed = true;
    this.queue.splice(0).forEach((q) => q.resolve(null));
  }

  private alive(): boolean {
    return !this.disposed && !!(this.editor as any).getModel?.() && !!(this.editor as any).Canvas;
  }

  render(id: string, force = false): Promise<BoardSnapshot | null> {
    if (this.disposed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.queue.push({ id, force, resolve });
      if (!this.running) this.running = this.run().finally(() => (this.running = null));
    });
  }

  /** Drops what is waiting, lets the current render end, opens `target` (or `back`) again for real. */
  async finish(target: string | null, back: string | null): Promise<void> {
    this.queue.splice(0).forEach((q) => q.resolve(null));
    await this.running;
    const id = target || back;
    if (this.disposed || (!this.touched && id === this.manager.activeId)) return;
    this.touched = false;
    if (id) await this.manager.open(id, { force: true });
    else if (this.manager.activeId) await this.manager.detach();
  }

  private async keyOf(rec: PageRecord): Promise<string> {
    let key = `${rec.updatedAt || 0}`;
    if (rec.dataOf) {
      const owner = await this.manager.store.get(rec.dataOf);
      key += `|${owner?.updatedAt || 0}`;
    }
    return key;
  }

  private async run(): Promise<void> {
    while (this.queue.length) {
      const q = this.queue.shift()!;
      try {
        q.resolve(await this.one(q.id, q.force));
      } catch (e) {
        report(e);
        q.resolve(null);
      }
    }
    // Live: the record being edited back in the canvas.
    if (this.live && this.touched && this.alive()) {
      const home = this.home;
      this.touched = false;
      try {
        if (home) await this.openFor(home);
        if (this.selectedId) {
          const sel = this.findById(this.selectedId);
          if (sel) this.editor.select(sel);
        }
      } catch (e) {
        report(e);
      } finally {
        this.live.busy(false);
        this.live.restored?.();
      }
    }
  }

  private findById(id: string): any {
    let hit: any = null;
    const walk = (c: any): void => {
      if (hit) return;
      if (c.getId?.() === id) hit = c;
      else c.components?.().forEach(walk);
    };
    const w = this.editor.getWrapper?.();
    if (w) walk(w);
    return hit;
  }

  /** Opens a record silently and lets the plugins load what it shows. */
  private async openFor(id: string): Promise<PageRecord | null> {
    await this.manager.open(id, { force: true, silent: true });
    const rec = await this.manager.store.get(id);
    if (!rec) return null;
    const waits: Array<Promise<unknown>> = [];
    try {
      this.editor.trigger(RENDERING_EVENT, { record: rec, waitFor: (p: Promise<unknown>) => waits.push(Promise.resolve(p).catch(report)) });
    } catch (e) {
      report(e);
    }
    await Promise.all(waits);
    await new Promise((r) => setTimeout(r, 0));
    return rec;
  }

  private async one(id: string, force: boolean): Promise<BoardSnapshot | null> {
    if (!this.alive()) return null;
    const rec = await this.manager.store.get(id);
    if (!rec || rec.deleted || !this.alive()) return null;
    const key = await this.keyOf(rec);
    if (!force) {
      const mem = this.cache.get(id);
      if (mem && mem.key === key) return mem.snap;
      const kept = await this.meta.get<{ key: string; snap: BoardSnapshot }>(SNAP_META + id).catch(() => undefined);
      if (kept && kept.key === key && kept.snap) {
        this.cache.set(id, kept);
        return kept.snap;
      }
    }
    // The record in the canvas: taken as it is, nothing to open.
    if (!this.touched && id === this.manager.activeId) {
      await this.manager.flush();
      const snap = await runMarkupHooks(this.editor, (rec.kind || 'page') as RecordKind, rec, this.hooks());
      const entry = { key: await this.keyOf((await this.manager.store.get(id)) || rec), snap };
      this.cache.set(id, entry);
      void this.meta.set(SNAP_META + id, entry).catch(report);
      return snap;
    }
    if (!this.touched) {
      await this.manager.flush();
      if (this.live) {
        this.home = this.live.home();
        this.selectedId = (this.editor.getSelected?.() as any)?.getId?.() || null;
        this.live.busy(true);
      }
    }
    this.touched = true;
    await this.openFor(id);
    if (!this.alive() || this.manager.activeId !== id) return null;
    const kind = (rec.kind || 'page') as RecordKind;
    const snap = await runMarkupHooks(this.editor, kind, rec, this.hooks());
    const entry = { key, snap };
    this.cache.set(id, entry);
    void this.meta.set(SNAP_META + id, entry).catch(report);
    return snap;
  }
}
