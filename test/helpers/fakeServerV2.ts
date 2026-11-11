import type { ProjectData } from '../../src/types';

type Coll = 'pages' | 'layouts' | 'templates';
const KIND: Record<Coll, string> = { pages: 'page', layouts: 'layout', templates: 'template' };

export interface V2Record {
  kind: string;
  id: string;
  name: string;
  version: number;
  created_at: string;
  updated_at: string;
  slug?: string;
  page_kind?: 'free' | 'entry';
  status?: string;
  layout_id?: string | null;
  template_id?: string | null;
  parent_id?: string | null;
  position?: number;
  data: ProjectData | null;
  values: Record<string, unknown>;
  revisions: Array<{ revision: number; html: string; css: string; data: ProjectData | null; created_at: string }>;
}

export interface V2Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: any;
}

const now = () => new Date().toISOString();

const slugify = (s: string) =>
  '/' +
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * In-memory server of contract v2 (openapi.v2.yaml), behaving like
 * luna-pages: integer versions in If-Match (412), slugs unique per site
 * (422), "" clears an id, omitted header fields stay, values merge (null
 * deletes), layouts need a slot to publish.
 */
export class FakeServerV2 {
  readonly colls: Record<Coll, Map<string, V2Record>> = { pages: new Map(), layouts: new Map(), templates: new Map() };
  site = { name: '', settings: {} as Record<string, unknown>, version: 1, data: null as ProjectData | null, updated_at: now(), revisions: [] as V2Record['revisions'] };
  calls: V2Call[] = [];
  /** Every request fails like a dead network while set. */
  offline = false;
  /** Every request answers with this status while set. */
  failWith: number | null = null;

  constructor(readonly base = 'https://cms.test/api/editor') {}

  seed(coll: Coll, id: string, name: string, extra: Partial<V2Record> = {}): V2Record {
    const r: V2Record = {
      kind: KIND[coll],
      id,
      name,
      version: 1,
      created_at: now(),
      updated_at: now(),
      data: null,
      values: {},
      revisions: [],
      ...(coll === 'pages' ? { slug: slugify(name), page_kind: 'free', status: 'draft', layout_id: null, template_id: null, parent_id: null, position: 0 } : {}),
      ...extra,
    } as V2Record;
    this.colls[coll].set(id, r);
    return r;
  }

  /** An edit made by somebody else. */
  touch(coll: Coll, id: string, patch: Partial<V2Record> = {}): V2Record {
    const r = this.colls[coll].get(id)!;
    Object.assign(r, patch);
    r.version++;
    r.updated_at = now();
    return r;
  }

  private header(r: V2Record) {
    const { data: _d, values: _v, revisions: _r, ...h } = r;
    return h;
  }

  private full(r: V2Record) {
    const { revisions: _r, ...f } = r;
    return f;
  }

  private siteJSON() {
    const { revisions: _r, ...s } = this.site;
    return s;
  }

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = (init.method || 'GET').toUpperCase();
    const headers = (init.headers || {}) as Record<string, string>;
    const path = url.startsWith(this.base) ? url.slice(this.base.length) : url;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ method, path, headers, body });
    if (this.offline) throw new TypeError('Failed to fetch');
    const json = (status: number, data?: unknown) =>
      new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    const invalid = (field: string, msg: string) => json(422, { error: 'The given data was invalid.', errors: { [field]: [msg] } });
    if (this.failWith) return json(this.failWith, { error: 'fail' });
    const ifMatch = headers['If-Match'] ? Number(headers['If-Match'].replace(/"/g, '')) : null;

    // The site.
    if (path === '/site') {
      if (method === 'GET') return json(200, this.siteJSON());
      if (method === 'PUT') {
        if (ifMatch != null && ifMatch !== this.site.version) return json(412, { error: 'version' });
        this.site.name = body.name ?? '';
        this.site.settings = body.settings ?? {};
        if (body.data) this.site.data = body.data;
        this.site.version++;
        this.site.updated_at = now();
        return json(200, this.siteJSON());
      }
    }
    if (path === '/site/publish' && method === 'POST') {
      if (ifMatch != null && ifMatch !== this.site.version) return json(412, { error: 'version' });
      if (body?.css == null) return invalid('css', 'Send the CSS.');
      const rev = this.site.revisions.length + 1;
      this.site.revisions.push({ revision: rev, html: '', css: body.css, data: this.site.data, created_at: now() });
      this.site.version++;
      return json(200, { record: this.siteJSON(), revision: rev, warnings: [] });
    }
    if (path === '/site/revisions' && method === 'GET') {
      return json(200, { items: [...this.site.revisions].reverse().map((r, i) => ({ revision: r.revision, created_at: r.created_at, created_by: 'key:test', live: i === 0 })) });
    }

    const m = path.match(/^\/(pages|layouts|templates)(?:\/([^/]+))?(?:\/(publish|unpublish|revisions)(?:\/(\d+)\/restore)?)?$/);
    if (!m) return json(404, { error: 'Not found.' });
    const coll = m[1] as Coll;
    const id = m[2] ? decodeURIComponent(m[2]) : undefined;
    const action = m[3];
    const map = this.colls[coll];
    if (!id) {
      if (method === 'GET') return json(200, { items: [...map.values()].map((r) => this.header(r)) });
      return json(405, { error: 'method' });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return json(422, { errors: { id: ['The id must be a UUID.'] } });
    const cur = map.get(id);
    const versionOk = ifMatch == null || (cur && ifMatch === cur.version);

    if (action === 'publish' && method === 'POST') {
      if (!cur) return json(404, { error: 'Not found.' });
      if (!versionOk) return json(412, { error: 'version' });
      const entry = coll === 'pages' && cur.template_id;
      if (!entry && body?.html == null) return invalid('html', 'Send the HTML.');
      if (coll === 'layouts' && !/<(page-slot|luna-slot)\b|data-(page|luna)-slot/.test(body.html)) return invalid('html', 'A layout needs a slot.');
      const rev = entry ? 0 : cur.revisions.length + 1;
      if (!entry) cur.revisions.push({ revision: rev, html: body.html, css: body.css ?? '', data: cur.data, created_at: now() });
      if (coll === 'pages') cur.status = 'published';
      cur.version++;
      return json(200, { record: this.header(cur), revision: rev, warnings: [] });
    }
    if (action === 'unpublish' && method === 'POST') {
      if (!cur) return json(404, { error: 'Not found.' });
      if (!versionOk) return json(412, { error: 'version' });
      cur.status = 'draft';
      cur.version++;
      return json(200, this.header(cur));
    }
    if (action === 'revisions' && method === 'GET' && !m[4]) {
      if (!cur) return json(404, { error: 'Not found.' });
      return json(200, { items: [...cur.revisions].reverse().map((r, i) => ({ revision: r.revision, created_at: r.created_at, created_by: 'key:test', live: i === 0 })) });
    }
    if (action === 'revisions' && m[4] && method === 'POST') {
      if (!cur) return json(404, { error: 'Not found.' });
      if (!versionOk) return json(412, { error: 'version' });
      const r = cur.revisions.find((x) => x.revision === Number(m[4]));
      if (!r) return json(404, { error: 'Not found.' });
      cur.data = r.data;
      cur.version++;
      return json(200, this.full(cur));
    }
    if (action) return json(405, { error: 'method' });

    if (method === 'GET') return cur ? json(200, this.full(cur)) : json(404, { error: 'Not found.' });
    if (method === 'DELETE') {
      if (!cur) return json(404, { error: 'Not found.' });
      if (!versionOk) return json(412, { error: 'version' });
      map.delete(id);
      return new Response(null, { status: 204 });
    }
    if (method === 'PUT') {
      if (ifMatch != null && !cur) return json(412, { error: 'gone' });
      if (!versionOk) return json(412, { error: 'version' });
      if (!body?.name?.trim()) return invalid('name', 'The name is required.');
      const next: V2Record = cur
        ? { ...cur }
        : this.seed(coll, id, body.name, { version: 0 });
      next.name = body.name;
      if (body.data !== undefined) next.data = body.data;
      if (coll === 'pages') {
        let slug = body.slug !== undefined ? body.slug : next.slug || slugify(body.name);
        if (!slug || slug === '/-') slug = '/page';
        const taken = [...map.values()].some((p) => p.id !== id && p.slug === slug);
        if (taken) {
          if (!cur) map.delete(id);
          return invalid('slug', 'This address is taken.');
        }
        next.slug = slug;
        if (body.parent_id !== undefined) next.parent_id = body.parent_id || null;
        if (body.layout_id !== undefined) next.layout_id = body.layout_id || null;
        if (body.position !== undefined) next.position = body.position;
        if (body.values) {
          next.values = { ...next.values };
          Object.entries(body.values as Record<string, unknown>).forEach(([k, v]) => {
            if (v === null) delete next.values[k];
            else next.values[k] = v;
          });
        }
      }
      next.version++;
      next.updated_at = now();
      map.set(id, next);
      return json(cur ? 200 : 201, this.full(next));
    }
    return json(405, { error: 'method' });
  };

  /** Requests with this method and path (a RegExp or a prefix). */
  find(method: string, path: string | RegExp): V2Call[] {
    return this.calls.filter((c) => c.method === method && (typeof path === 'string' ? c.path.startsWith(path) : path.test(c.path)));
  }
}
