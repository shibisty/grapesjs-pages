import type { ProjectData } from '../../src/types';

interface ServerPage {
  id: string;
  name: string;
  data: ProjectData;
  version: number;
  updatedAt: number;
}

export interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: any;
}

/**
 * In-memory implementation of openapi.yaml: versions are integers,
 * `If-Match` is checked on PUT/DELETE (412 on mismatch).
 */
export class FakeServer {
  pages = new Map<string, ServerPage>();
  calls: Call[] = [];
  /** Set to make every request fail with this status. */
  failWith: number | null = null;
  listShape: 'array' | 'items' = 'items';

  constructor(readonly base = 'https://api.test/v1') {}

  seed(id: string, name: string, data: ProjectData, version = 1): ServerPage {
    const p = { id, name, data, version, updatedAt: Date.now() };
    this.pages.set(id, p);
    return p;
  }

  /** Simulates an edit made by somebody else. */
  touch(id: string, name?: string): void {
    const p = this.pages.get(id)!;
    p.version++;
    if (name) p.name = name;
    p.updatedAt = Date.now();
  }

  private meta(p: ServerPage) {
    return { id: p.id, name: p.name, version: p.version, updatedAt: p.updatedAt };
  }

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = (init.method || 'GET').toUpperCase();
    const headers = (init.headers || {}) as Record<string, string>;
    const path = url.startsWith(this.base) ? url.slice(this.base.length) : url;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ method, path, headers, body });
    const json = (status: number, data: unknown) =>
      new Response(data === undefined ? null : JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (!url.startsWith(this.base)) return json(404, { error: 'unknown host' });
    if (this.failWith) return json(this.failWith, { error: 'fail' });

    if (path === '/pages' && method === 'GET') {
      const items = [...this.pages.values()].map((p) => this.meta(p));
      return json(200, this.listShape === 'array' ? items : { items });
    }
    const m = path.match(/^\/pages\/([^/]+)$/);
    if (!m) return json(404, { error: 'not found' });
    const id = decodeURIComponent(m[1]);
    const cur = this.pages.get(id);
    const ifMatch = headers['If-Match'];
    const versionOk = !ifMatch || (cur && ifMatch === `"${cur.version}"`);
    if (method === 'GET') return cur ? json(200, { ...this.meta(cur), data: cur.data }) : json(404, { error: 'nf' });
    if (method === 'PUT') {
      if (ifMatch && !cur) return json(412, { error: 'gone' });
      if (!versionOk) return json(412, { error: 'version' });
      const next: ServerPage = {
        id,
        name: body.name,
        data: body.data,
        version: (cur?.version || 0) + 1,
        updatedAt: Date.now(),
      };
      this.pages.set(id, next);
      return json(cur ? 200 : 201, this.meta(next));
    }
    if (method === 'DELETE') {
      if (!cur) return json(404, { error: 'nf' });
      if (!versionOk) return json(412, { error: 'version' });
      this.pages.delete(id);
      return new Response(null, { status: 204 });
    }
    return json(405, { error: 'method' });
  };
}
