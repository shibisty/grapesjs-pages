import type { PageStore } from '../store/types';
import { HttpError } from '../sync/RestClient';
import type { PageRecord, RecordKind } from '../types';
import { report } from '../utils';
import { COLLECTION, fromWire, type RemoteClient, SITE_ID, toWire, type WireRecord } from './RemoteClient';

/** Where the store stands with the server. */
export type RemoteState = 'idle' | 'saving' | 'offline' | 'error';

export interface RemoteStoreHooks {
  /** Something the UI shows changed (state, a record's version, slug, conflict…). */
  onChange?: () => void;
  /** A record was replaced by the server's version: reload it if it is open. */
  onRemote?: (rec: PageRecord) => void;
  /** A record is gone on the server and was dropped here. */
  onRemoved?: (id: string) => void;
  /** A save hit a newer server version (412). */
  onConflict?: (rec: PageRecord) => void;
}

export interface RemoteStoreOptions {
  /** First retry delay after a failed save, ms (doubles up to 60 s). */
  retryDelay?: number;
}

const KINDS: Array<Exclude<RecordKind, 'site'>> = ['page', 'layout', 'template'];

const kindOf = (r: PageRecord): RecordKind => r.kind || 'page';

/** Network errors and 5xx are worth retrying; 4xx answers are not. */
const transient = (e: unknown): boolean =>
  !(e instanceof HttpError) || e.status >= 500 || e.status === 408 || e.status === 429;

/**
 * Contract v2 backend: the server is the source of truth, `cache` (IndexedDB
 * by default) keeps every record for fast and offline work and queues the
 * writes. Same interface as any `PageStore`, so `PagesManager` writes to it
 * as to a local store:
 *
 * - `put` of a changed record queues a push (`PUT` with `If-Match`); one
 *   request per record at a time, retried with backoff while offline;
 * - a `412` marks the record as a conflict and stops its pushes until
 *   `resolve()`;
 * - `refresh()` reads the server's lists and brings in what others
 *   changed (records with local edits become conflicts instead);
 * - a tombstone (`deleted`) is deleted on the server, then dropped.
 */
export class RemotePageStore implements PageStore {
  state: RemoteState = 'idle';
  /** Last error per record (a refused save), for the UI. */
  readonly errors = new Map<string, string>();
  private readonly pending = new Set<string>();
  private running: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private delay: number;
  private closed = false;

  constructor(
    readonly cache: PageStore,
    readonly client: RemoteClient,
    private readonly hooks: RemoteStoreHooks = {},
    private readonly opts: RemoteStoreOptions = {}
  ) {
    this.delay = opts.retryDelay ?? 2000;
  }

  /* ------------------------- PageStore ------------------------- */

  all(): Promise<PageRecord[]> {
    return this.cache.all();
  }

  get(id: string): Promise<PageRecord | undefined> {
    return this.cache.get(id);
  }

  async put(rec: PageRecord): Promise<void> {
    await this.cache.put(rec);
    if (rec.dirty || rec.dirtyMeta || rec.deleted) {
      this.errors.delete(rec.id);
      this.schedule(rec.id);
    }
  }

  delete(id: string): Promise<void> {
    this.pending.delete(id);
    return this.cache.delete(id);
  }

  getMeta<T = unknown>(key: string): Promise<T | undefined> {
    return this.cache.getMeta<T>(key);
  }

  setMeta<T = unknown>(key: string, value: T): Promise<void> {
    return this.cache.setMeta(key, value);
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.cache.close?.();
  }

  /* ------------------------- the queue ------------------------- */

  /** Queues a record's push. */
  schedule(id: string): void {
    if (this.closed) return;
    this.pending.add(id);
    void this.run();
  }

  /** Has the record unsent changes (queued or in flight)? */
  isPending(id: string): boolean {
    return this.pending.has(id);
  }

  /** Runs the queue until it is empty (or offline). */
  run(): Promise<void> {
    if (!this.running) {
      this.running = this.drain().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private setState(s: RemoteState): void {
    if (this.state === s) return;
    this.state = s;
    this.hooks.onChange?.();
  }

  private async drain(): Promise<void> {
    while (this.pending.size && !this.closed) {
      this.setState('saving');
      const id = this.pending.values().next().value as string;
      this.pending.delete(id);
      try {
        await this.pushOne(id);
        this.delay = this.opts.retryDelay ?? 2000;
      } catch (e) {
        if (transient(e)) {
          this.pending.add(id);
          this.setState('offline');
          this.retryLater();
          return;
        }
        this.errors.set(id, (e as Error).message);
        report(e);
      }
    }
    this.setState(this.errors.size ? 'error' : 'idle');
  }

  private retryLater(): void {
    if (this.retryTimer || this.closed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.run();
    }, this.delay);
    this.delay = Math.min(this.delay * 2, 60_000);
  }

  /** Back online (the window's `online` event, a focus): retry now. */
  wake(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.run();
  }

  /**
   * Waits until the record is on the server as it is now. Rejects with the
   * reason when it cannot be (a conflict, a refused write, offline).
   */
  async pushNow(id: string): Promise<PageRecord> {
    this.pending.add(id);
    while (this.running) await this.running;
    await this.run();
    const rec = await this.cache.get(id);
    if (!rec) throw new Error(`no record ${id}`);
    if (rec.conflict) throw new HttpError('conflict', 412);
    const err = this.errors.get(id);
    if (err) throw new Error(err);
    if (this.pending.has(id) || rec.dirty || rec.dirtyMeta) throw new Error('offline');
    return rec;
  }

  /** One record to the server: delete a tombstone, or write the changes. */
  private async pushOne(id: string): Promise<void> {
    const rec = await this.cache.get(id);
    if (!rec || rec.conflict) return;
    const kind = kindOf(rec);
    if (rec.deleted) {
      if (rec.remote) {
        try {
          await this.client.del(kind, id, rec.remote.version);
        } catch (e) {
          if (e instanceof HttpError && e.status === 412) return this.conflict(rec);
          if (!(e instanceof HttpError && e.status === 404)) throw e;
        }
      }
      await this.cache.delete(id);
      this.hooks.onChange?.();
      return;
    }
    if (!rec.dirty && !rec.dirtyMeta) return;
    const sent = { updatedAt: rec.updatedAt, values: [...(rec.dirtyValues || [])] };
    let w: WireRecord;
    try {
      w = await this.client.put(kind, kind === 'site' ? SITE_ID : id, toWire(rec, rec.dirty), rec.remote?.version ?? null);
    } catch (e) {
      if (e instanceof HttpError && e.status === 412) return this.conflict(rec);
      throw e;
    }
    await this.saved(id, kind, w, sent);
  }

  /** Takes in the server's answer to a write, keeping what changed meanwhile. */
  private async saved(id: string, kind: RecordKind, w: WireRecord, sent: { updatedAt: number; values: string[] }): Promise<void> {
    const cur = await this.cache.get(id);
    if (!cur) return;
    const same = cur.updatedAt === sent.updatedAt;
    const next = fromWire({ ...w, data: undefined, values: undefined }, kind, cur);
    next.values = cur.values;
    next.data = cur.data;
    next.updatedAt = cur.updatedAt;
    if (!same) {
      // Edited while the request was in flight: keep the local header
      // fields and send again.
      next.dirty = cur.dirty;
      next.dirtyMeta = cur.dirtyMeta;
      next.name = cur.name;
      if (kind === 'page') {
        next.slug = cur.slug || next.slug;
        next.parentId = cur.parentId;
        next.layoutId = cur.layoutId;
        next.position = cur.position;
      }
      next.dirtyValues = cur.dirtyValues;
    } else {
      next.dirtyValues = (cur.dirtyValues || []).filter((k) => !sent.values.includes(k));
    }
    await this.cache.put(next);
    if (next.dirty || next.dirtyMeta) this.pending.add(id);
    this.hooks.onChange?.();
  }

  private async conflict(rec: PageRecord): Promise<void> {
    const cur = (await this.cache.get(rec.id)) || rec;
    cur.conflict = true;
    await this.cache.put(cur);
    this.hooks.onConflict?.(cur);
    this.hooks.onChange?.();
  }

  /* ------------------------- reading ------------------------- */

  /**
   * Reads the server's lists and brings every record up to date: new and
   * changed ones are downloaded (unless edited here: then a conflict),
   * ones gone on the server are dropped (or re-created, when edited here),
   * ones made offline are queued.
   */
  async refresh(): Promise<void> {
    const [lists, site] = await Promise.all([
      Promise.all(KINDS.map((k) => this.client.list(k))),
      this.client.get('site', SITE_ID),
    ]);
    const seen = new Set<string>();
    let changed = false;
    const sync = async (kind: RecordKind, w: WireRecord): Promise<void> => {
      const id = kind === 'site' ? SITE_ID : String(w.id);
      seen.add(id);
      const local = await this.cache.get(id);
      if (local && local.remote && String(local.remote.version) === String(w.version)) return;
      if (local && (local.dirty || local.dirtyMeta || local.deleted)) {
        if (!local.remote) return; // made here, the server has another one: the push decides
        if (!local.conflict) {
          local.conflict = true;
          await this.cache.put(local);
          this.hooks.onConflict?.(local);
          changed = true;
        }
        return;
      }
      const full = kind === 'site' ? w : await this.client.get(kind, id);
      const rec = fromWire(full, kind, local);
      await this.cache.put(rec);
      changed = true;
      if (local) this.hooks.onRemote?.(rec);
    };
    for (let i = 0; i < KINDS.length; i++) {
      for (const w of lists[i]) await sync(KINDS[i], w);
    }
    await sync('site', site);
    for (const local of await this.cache.all()) {
      if (seen.has(local.id)) continue;
      if (!local.remote) {
        if (!local.deleted) this.pending.add(local.id); // made offline
        continue;
      }
      if (local.dirty || local.dirtyMeta) {
        // Deleted on the server while edited here: keep it as a new record.
        local.remote = null;
        await this.cache.put(local);
        this.pending.add(local.id);
      } else {
        await this.cache.delete(local.id);
        this.hooks.onRemoved?.(local.id);
      }
      changed = true;
    }
    if (changed) this.hooks.onChange?.();
    if (this.pending.size) void this.run();
  }

  /** Downloads one record and replaces the local copy (drops local edits). */
  async pull(id: string): Promise<PageRecord> {
    const local = await this.cache.get(id);
    const kind = local ? kindOf(local) : 'page';
    const w = await this.client.get(kind, kind === 'site' ? SITE_ID : id);
    const rec = fromWire(w, kind, local ? { ...local, values: undefined } : undefined);
    await this.cache.put(rec);
    this.pending.delete(id);
    this.errors.delete(id);
    this.hooks.onRemote?.(rec);
    this.hooks.onChange?.();
    return rec;
  }

  /**
   * Ends a conflict. `local`: overwrite the server with the local version;
   * `remote`: take the server's.
   */
  async resolve(id: string, choice: 'local' | 'remote'): Promise<void> {
    const rec = await this.cache.get(id);
    if (!rec) return;
    if (choice === 'remote') {
      await this.pull(id);
      return;
    }
    const kind = kindOf(rec);
    // Base the write on the server's current version.
    try {
      const w = await this.client.get(kind, kind === 'site' ? SITE_ID : id);
      rec.remote = { version: w.version, updatedAt: w.updated_at };
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
      rec.remote = null; // gone there: create it again
    }
    rec.conflict = false;
    if (!rec.deleted) {
      rec.dirty = true;
      rec.dirtyMeta = true;
    }
    await this.put(rec);
    await this.pushNow(id).catch(() => undefined);
  }

  /** Is this a record kind the server keeps in a collection? */
  static isCollection(kind: RecordKind): kind is keyof typeof COLLECTION {
    return kind !== 'site';
  }
}
