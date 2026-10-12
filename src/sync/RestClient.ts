import type { PageRecord, ProjectData, ServerSettings } from '../types';
import { normalizeUrl } from '../utils';

/** Page metadata as listed by `GET /pages` (see openapi.yaml). */
export interface RemotePageMeta {
  id: string;
  name: string;
  version: string | number;
  updatedAt?: number | string;
}

/** A full page from `GET /pages/{id}`. */
export interface RemotePage extends RemotePageMeta {
  data: ProjectData;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'HttpError';
  }

  /** 412/409 — the page changed on the server since we last saw it. */
  get isConflict(): boolean {
    return this.status === 412 || this.status === 409;
  }
}

export interface RestClientConfig {
  getSettings: () => ServerSettings;
  headers?: (() => Record<string, string>) | null;
  messages: { noServer: () => string; conflict: () => string };
  fetch?: typeof fetch;
}

/**
 * Thin client of the REST contract in `openapi.yaml`:
 * `GET /pages`, `GET|PUT|DELETE /pages/{id}`, versions in `If-Match`.
 */
export class RestClient {
  constructor(private readonly cfg: RestClientConfig) {}

  async request<T>(
    method: string,
    path: string,
    { body, headers }: { body?: unknown; headers?: Record<string, string> } = {},
    settings: ServerSettings = this.cfg.getSettings()
  ): Promise<T> {
    const base = normalizeUrl(settings.url);
    if (!base) throw new Error(this.cfg.messages.noServer());
    const hd: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) hd['Content-Type'] = 'application/json';
    if (settings.token) hd.Authorization = `Bearer ${settings.token}`;
    if (this.cfg.headers) Object.assign(hd, this.cfg.headers());
    Object.assign(hd, headers || {});
    const doFetch = this.cfg.fetch || globalThis.fetch.bind(globalThis);
    const res = await doFetch(base + path, {
      method,
      headers: hd,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const conflict = res.status === 412 || res.status === 409;
      throw new HttpError(conflict ? this.cfg.messages.conflict() : `${method} ${path}: HTTP ${res.status}`, res.status);
    }
    if (res.status === 204) return null as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Accepts both a bare array and `{ items: [...] }`. */
  async listPages(settings?: ServerSettings): Promise<RemotePageMeta[]> {
    const res = await this.request<RemotePageMeta[] | { items?: RemotePageMeta[] } | null>('GET', '/pages', {}, settings);
    if (Array.isArray(res)) return res;
    return (res && res.items) || [];
  }

  getPage(id: string): Promise<RemotePage> {
    return this.request<RemotePage>('GET', `/pages/${encodeURIComponent(id)}`);
  }

  /** `version` = the version we based our edits on (sent as `If-Match`); omit to force. */
  putPage(rec: PageRecord, version?: string | number | null): Promise<RemotePageMeta> {
    const headers: Record<string, string> = {};
    if (version != null) headers['If-Match'] = `"${version}"`;
    return this.request<RemotePageMeta>('PUT', `/pages/${encodeURIComponent(rec.id)}`, {
      headers,
      body: { id: rec.id, name: rec.name, data: rec.data, updatedAt: rec.updatedAt },
    });
  }

  async deletePage(id: string, version?: string | number | null): Promise<void> {
    const headers: Record<string, string> = {};
    if (version != null) headers['If-Match'] = `"${version}"`;
    await this.request<null>('DELETE', `/pages/${encodeURIComponent(id)}`, { headers });
  }
}
