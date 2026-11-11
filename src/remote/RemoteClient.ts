import { HttpError } from '../sync/RestClient';
import type { PageRecord, PageStatus, ProjectData, RecordKind, Revision } from '../types';
import { normalizeUrl } from '../utils';

/**
 * A record as the contract v2 server sends it (openapi.v2.yaml). Header
 * fields always; `data` (the draft project) and `values` only from a
 * single-record GET or a write.
 */
export interface WireRecord {
  kind?: RecordKind;
  id?: string;
  name: string;
  version: number | string;
  created_at?: string;
  updated_at?: string;
  slug?: string;
  page_kind?: 'free' | 'entry';
  status?: PageStatus;
  published_at?: string | null;
  layout_id?: string | null;
  template_id?: string | null;
  parent_id?: string | null;
  position?: number;
  fields?: unknown[];
  settings?: Record<string, unknown>;
  data?: ProjectData | null;
  values?: Record<string, unknown>;
}

/** What a write sends. Omitted header fields stay as they are; `""` clears an id. */
export interface WireWrite {
  name: string;
  data?: ProjectData;
  slug?: string;
  parent_id?: string;
  layout_id?: string;
  position?: number;
  values?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export interface PublishResult {
  record: WireRecord;
  revision: number;
  warnings: string[];
}

/** Collection path segment of a kind. */
export const COLLECTION: Record<Exclude<RecordKind, 'site'>, string> = {
  page: 'pages',
  layout: 'layouts',
  template: 'templates',
};

/** Local id of the site record (the server has one site per application). */
export const SITE_ID = 'site';

const toMs = (s: string | undefined): number => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : Date.now();
};

/**
 * A server record as a local one. `data` and `values` are taken when the
 * server sent them; otherwise the caller keeps its own.
 */
export function fromWire(w: WireRecord, kind: RecordKind, base?: PageRecord): PageRecord {
  const rec: PageRecord = {
    ...(base || ({} as PageRecord)),
    id: kind === 'site' ? SITE_ID : String(w.id),
    kind,
    name: w.name ?? base?.name ?? '',
    data: (w.data ?? base?.data ?? null) as ProjectData,
    createdAt: base?.createdAt ?? toMs(w.created_at),
    updatedAt: toMs(w.updated_at),
    dirty: false,
    deleted: false,
    conflict: false,
    dirtyMeta: false,
    dirtyValues: [],
    remote: { version: w.version, updatedAt: w.updated_at },
  };
  if (kind === 'page') {
    rec.slug = w.slug ?? base?.slug;
    rec.parentId = w.parent_id ?? null;
    rec.layoutId = w.layout_id ?? null;
    rec.templateId = w.template_id ?? null;
    rec.position = w.position ?? 0;
    rec.status = w.status ?? base?.status ?? 'draft';
    rec.publishedAt = w.published_at ?? base?.publishedAt ?? null;
    rec.values = w.values ?? base?.values ?? {};
  }
  if (kind === 'site') rec.values = w.settings ?? base?.values ?? {};
  return rec;
}

/** The write a local record sends; `withData` false: header fields only. */
export function toWire(rec: PageRecord, withData: boolean): WireWrite {
  const kind = rec.kind || 'page';
  const w: WireWrite = { name: rec.name };
  if (withData && rec.data) w.data = rec.data;
  if (kind === 'page') {
    if (rec.slug) w.slug = rec.slug;
    w.parent_id = rec.parentId || '';
    w.layout_id = rec.layoutId || '';
    w.position = rec.position ?? 0;
    const keys = rec.dirtyValues || [];
    if (keys.length) {
      w.values = {};
      keys.forEach((k) => {
        const v = rec.values?.[k];
        w.values![k] = v === undefined ? null : v;
      });
    }
  }
  if (kind === 'site') w.settings = (rec.values as Record<string, unknown>) || {};
  return w;
}

export interface RemoteClientConfig {
  url: string;
  headers?: (() => Record<string, string>) | null;
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
  conflictMessage?: () => string;
}

/** Thin client of contract v2 (openapi.v2.yaml). Versions travel in `If-Match`. */
export class RemoteClient {
  constructor(private readonly cfg: RemoteClientConfig) {}

  get base(): string {
    return normalizeUrl(this.cfg.url);
  }

  async request<T>(method: string, path: string, { body, version }: { body?: unknown; version?: string | number | null } = {}): Promise<T> {
    const hd: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) hd['Content-Type'] = 'application/json';
    if (version != null) hd['If-Match'] = `"${version}"`;
    if (this.cfg.headers) Object.assign(hd, this.cfg.headers());
    const doFetch = this.cfg.fetch || globalThis.fetch.bind(globalThis);
    const res = await doFetch(this.base + path, {
      method,
      headers: hd,
      credentials: this.cfg.credentials,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = j?.error || j?.message || '';
        const errs: Array<[string, unknown]> = j?.errors ? Object.entries(j.errors as Record<string, unknown>) : [];
        if (errs.length) detail += ' ' + errs.map(([k, v]) => `${k}: ${[v].flat().join(' ')}`).join('; ');
      } catch {
        /* not JSON */
      }
      const conflict = res.status === 412;
      const msg = conflict && this.cfg.conflictMessage ? this.cfg.conflictMessage() : `${method} ${path}: HTTP ${res.status}${detail ? ` — ${detail.trim()}` : ''}`;
      throw new HttpError(msg, res.status);
    }
    if (res.status === 204) return null as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  private path(kind: RecordKind, id?: string): string {
    if (kind === 'site') return '/site';
    return `/${COLLECTION[kind]}` + (id ? `/${encodeURIComponent(id)}` : '');
  }

  /** Headers of every record of a kind. */
  async list(kind: Exclude<RecordKind, 'site'>): Promise<WireRecord[]> {
    const res = await this.request<WireRecord[] | { items?: WireRecord[] }>('GET', this.path(kind));
    return Array.isArray(res) ? res : res?.items || [];
  }

  get(kind: RecordKind, id: string): Promise<WireRecord> {
    return this.request<WireRecord>('GET', this.path(kind, id));
  }

  put(kind: RecordKind, id: string, body: WireWrite, version?: string | number | null): Promise<WireRecord> {
    return this.request<WireRecord>('PUT', this.path(kind, id), { body, version });
  }

  async del(kind: RecordKind, id: string, version?: string | number | null): Promise<void> {
    await this.request<null>('DELETE', this.path(kind, id), { version });
  }

  publish(kind: RecordKind, id: string, body: { html?: string; css?: string }, version?: string | number | null): Promise<PublishResult> {
    return this.request<PublishResult>('POST', this.path(kind, id) + '/publish', { body, version });
  }

  unpublish(id: string, version?: string | number | null): Promise<WireRecord> {
    return this.request<WireRecord>('POST', this.path('page', id) + '/unpublish', { version });
  }

  async revisions(kind: RecordKind, id: string): Promise<Revision[]> {
    const res = await this.request<{ items?: Array<{ revision: number; created_at: string; created_by: string; live: boolean }> }>(
      'GET',
      this.path(kind, id) + '/revisions'
    );
    return (res?.items || []).map((r) => ({ revision: r.revision, createdAt: r.created_at, createdBy: r.created_by, live: r.live }));
  }

  restore(kind: Exclude<RecordKind, 'site'>, id: string, revision: number, version?: string | number | null): Promise<WireRecord> {
    return this.request<WireRecord>('POST', `${this.path(kind, id)}/revisions/${revision}/restore`, { version });
  }
}
