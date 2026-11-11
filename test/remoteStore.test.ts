import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fromWire, RemoteClient, toWire } from '../src/remote/RemoteClient';
import { RemotePageStore } from '../src/remote/RemotePageStore';
import { normalizeSlug } from '../src/remote/RemoteEditor';
import { MemoryPageStore } from '../src/store/MemoryPageStore';
import type { PageRecord } from '../src/types';
import { UUID_RE, uuid } from '../src/utils';
import { FakeServerV2 } from './helpers/fakeServerV2';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = (text: string) => ({ pages: [{ component: `<p>${text}</p>` }] }) as any;

let server: FakeServerV2;
let cache: MemoryPageStore;
let store: RemotePageStore;
const hooks = { onChange: vi.fn(), onRemote: vi.fn(), onRemoved: vi.fn(), onConflict: vi.fn() };

beforeEach(() => {
  server = new FakeServerV2();
  cache = new MemoryPageStore();
  Object.values(hooks).forEach((h) => h.mockReset());
  store = new RemotePageStore(cache, new RemoteClient({ url: server.base + '/', fetch: server.fetch }), hooks, { retryDelay: 5 });
});

const local = (id: string, patch: Partial<PageRecord> = {}): PageRecord => ({
  id,
  name: 'Local',
  data: project('local'),
  createdAt: 1,
  updatedAt: Date.now(),
  dirty: true,
  deleted: false,
  remote: null,
  ...patch,
});

describe('ids and slugs', () => {
  it('uuid is a v4 UUID, also without crypto.randomUUID (insecure contexts)', () => {
    expect(uuid()).toMatch(UUID_RE);
    const c = globalThis.crypto as any;
    const orig = c.randomUUID;
    c.randomUUID = () => {
      throw new Error('insecure');
    };
    try {
      const ids = new Set(Array.from({ length: 50 }, () => uuid()));
      expect(ids.size).toBe(50);
      ids.forEach((id) => expect(id).toMatch(UUID_RE));
      expect([...ids][0][14]).toBe('4');
    } finally {
      c.randomUUID = orig;
    }
  });

  it('normalizeSlug', () => {
    expect(normalizeSlug('')).toBe('/');
    expect(normalizeSlug('About Us')).toBe('/about-us');
    expect(normalizeSlug('/Products//Café Crème/')).toBe('/products/cafe-creme');
    expect(normalizeSlug('a/b c/d')).toBe('/a/b-c/d');
  });
});

describe('wire mapping', () => {
  it('fromWire keeps local data and values when the server sent none', () => {
    const base = local(ID(1), { data: project('mine'), values: { 'seo.title': 'T' } });
    const rec = fromWire({ id: ID(1), name: 'S', version: 3, slug: '/s', status: 'published', parent_id: ID(2) }, 'page', base);
    expect(rec).toMatchObject({ name: 'S', kind: 'page', slug: '/s', status: 'published', parentId: ID(2), dirty: false, remote: { version: 3 } });
    expect(rec.data).toEqual(project('mine'));
    expect(rec.values).toEqual({ 'seo.title': 'T' });
  });

  it('toWire sends changed values only, null for removed ones, "" to clear ids', () => {
    const rec = local(ID(1), { kind: 'page', slug: '/a', values: { a: 1 }, dirtyValues: ['a', 'gone'], parentId: null, layoutId: null });
    expect(toWire(rec, false)).toEqual({ name: 'Local', slug: '/a', parent_id: '', layout_id: '', position: 0, values: { a: 1, gone: null } });
    expect(toWire({ ...rec, dirtyValues: [] }, true)).toMatchObject({ data: project('local') });
    expect(toWire({ ...rec, kind: 'layout' }, true)).toEqual({ name: 'Local', data: project('local') });
    expect(toWire({ ...rec, kind: 'site', values: { lang: 'en' } }, false)).toEqual({ name: 'Local', settings: { lang: 'en' } });
  });
});

describe('RemotePageStore', () => {
  it('refresh brings every kind and the site into the cache', async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/', data: project('home') });
    server.seed('layouts', ID(2), 'Main', { data: project('layout') });
    server.seed('templates', ID(3), 'Product');
    server.site.name = 'Shop';
    await store.refresh();
    const all = await cache.all();
    expect(all.map((r) => [r.kind, r.name]).sort()).toEqual([
      ['layout', 'Main'],
      ['page', 'Home'],
      ['site', 'Shop'],
      ['template', 'Product'],
    ]);
    expect((await cache.get(ID(1)))!.data).toEqual(project('home')); // full records were fetched
    expect(server.find('GET', '/pages/').length).toBe(1);
    // Nothing changed: no second download.
    await store.refresh();
    expect(server.find('GET', '/pages/').length).toBe(1);
  });

  it('a new record is created without If-Match, then written with its version', async () => {
    await store.put(local(ID(1), { kind: 'page' }));
    await store.run();
    const [create] = server.find('PUT', `/pages/${ID(1)}`);
    expect(create.headers['If-Match']).toBeUndefined();
    let rec = (await cache.get(ID(1)))!;
    expect(rec).toMatchObject({ dirty: false, remote: { version: 1 }, slug: '/local' }); // the server named it
    rec.data = project('edited');
    rec.dirty = true;
    rec.updatedAt++;
    await store.put(rec);
    await store.run();
    const puts = server.find('PUT', `/pages/${ID(1)}`);
    expect(puts[1].headers['If-Match']).toBe('"1"');
    expect(puts[1].body.data).toEqual(project('edited'));
    rec = (await cache.get(ID(1)))!;
    expect(rec).toMatchObject({ dirty: false, remote: { version: 2 } });
    expect(server.colls.pages.get(ID(1))!.data).toEqual(project('edited'));
  });

  it('header changes go without the project', async () => {
    server.seed('pages', ID(1), 'Home', { data: project('x') });
    await store.refresh();
    const rec = (await cache.get(ID(1)))!;
    await store.put({ ...rec, name: 'Start', slug: '/start', dirtyMeta: true, values: { in_menu: true }, dirtyValues: ['in_menu'], updatedAt: rec.updatedAt + 1 });
    await store.run();
    const put = server.find('PUT', `/pages/${ID(1)}`)[0];
    expect(put.body).toEqual({ name: 'Start', slug: '/start', parent_id: '', layout_id: '', position: 0, values: { in_menu: true } });
    expect(await cache.get(ID(1))).toMatchObject({ dirtyMeta: false, dirtyValues: [] });
  });

  it('a 412 makes a conflict and stops the pushes until resolved', async () => {
    server.seed('pages', ID(1), 'Home', { data: project('server') });
    await store.refresh();
    server.touch('pages', ID(1), { data: project('theirs') });
    const rec = (await cache.get(ID(1)))!;
    await store.put({ ...rec, data: project('mine'), dirty: true, updatedAt: rec.updatedAt + 1 });
    await store.run();
    expect((await cache.get(ID(1)))!.conflict).toBe(true);
    expect(hooks.onConflict).toHaveBeenCalledTimes(1);
    await expect(store.pushNow(ID(1))).rejects.toMatchObject({ status: 412 });

    await store.resolve(ID(1), 'local');
    expect(server.colls.pages.get(ID(1))!.data).toEqual(project('mine'));
    expect(await cache.get(ID(1))).toMatchObject({ conflict: false, dirty: false, remote: { version: 3 } });
  });

  it('resolve remote takes the server version', async () => {
    server.seed('pages', ID(1), 'Home', { data: project('server') });
    await store.refresh();
    server.touch('pages', ID(1), { data: project('theirs'), name: 'Theirs' });
    const rec = (await cache.get(ID(1)))!;
    await store.put({ ...rec, data: project('mine'), dirty: true, updatedAt: rec.updatedAt + 1 });
    await store.run();
    await store.resolve(ID(1), 'remote');
    expect(await cache.get(ID(1))).toMatchObject({ name: 'Theirs', data: project('theirs'), dirty: false, conflict: false });
    expect(hooks.onRemote).toHaveBeenCalled();
  });

  it('offline: keeps the change and retries, then sends it', async () => {
    server.offline = true;
    await store.put(local(ID(1)));
    await store.run();
    expect(store.state).toBe('offline');
    expect((await cache.get(ID(1)))!.dirty).toBe(true);
    await expect(store.pushNow(ID(1))).rejects.toThrow('offline');
    server.offline = false;
    store.wake();
    await store.run();
    expect(store.state).toBe('idle');
    expect((await cache.get(ID(1)))!.dirty).toBe(false);
    expect(server.colls.pages.has(ID(1))).toBe(true);
  });

  it('a refused write is an error for that record, not a retry loop', async () => {
    server.seed('pages', ID(9), 'Taken', { slug: '/taken' });
    await store.put(local(ID(1), { slug: '/taken', dirtyMeta: true }));
    await store.run();
    expect(store.state).toBe('error');
    expect(store.errors.get(ID(1))).toMatch(/422.*slug/);
    await expect(store.pushNow(ID(1))).rejects.toThrow(/slug/);
    // A new change clears the error and is tried again.
    const rec = (await cache.get(ID(1)))!;
    await store.put({ ...rec, slug: '/free', updatedAt: rec.updatedAt + 1 });
    await store.run();
    expect(store.state).toBe('idle');
    expect(server.colls.pages.get(ID(1))!.slug).toBe('/free');
  });

  it('a tombstone is deleted on the server with If-Match, then dropped', async () => {
    server.seed('pages', ID(1), 'Old');
    await store.refresh();
    const rec = (await cache.get(ID(1)))!;
    await store.put({ ...rec, deleted: true, dirty: true });
    await store.run();
    expect(server.find('DELETE', `/pages/${ID(1)}`)[0].headers['If-Match']).toBe('"1"');
    expect(server.colls.pages.has(ID(1))).toBe(false);
    expect(await cache.get(ID(1))).toBeUndefined();
  });

  it('refresh: changed elsewhere (clean here) comes in; edited here becomes a conflict; gone there goes', async () => {
    server.seed('pages', ID(1), 'Clean', { data: project('a') });
    server.seed('pages', ID(2), 'Edited', { data: project('b') });
    server.seed('pages', ID(3), 'Gone');
    await store.refresh();
    server.touch('pages', ID(1), { data: project('a2') });
    server.touch('pages', ID(2), { data: project('b2') });
    server.colls.pages.delete(ID(3));
    const edited = (await cache.get(ID(2)))!;
    await cache.put({ ...edited, dirty: true, data: project('b-mine') }); // behind the store's back: not pushed yet
    await store.refresh();
    expect((await cache.get(ID(1)))!.data).toEqual(project('a2'));
    expect(hooks.onRemote).toHaveBeenCalledWith(expect.objectContaining({ id: ID(1) }));
    expect(await cache.get(ID(2))).toMatchObject({ conflict: true, data: project('b-mine') });
    expect(await cache.get(ID(3))).toBeUndefined();
    expect(hooks.onRemoved).toHaveBeenCalledWith(ID(3));
  });

  it('an edit made while a write was in flight is sent again', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: typeof fetch = async (input, init) => {
      if ((init?.method || 'GET') === 'PUT' && !server.colls.pages.size) await gate;
      return server.fetch(input as any, init);
    };
    store = new RemotePageStore(cache, new RemoteClient({ url: server.base, fetch: slow }), hooks, { retryDelay: 5 });
    await store.put(local(ID(1), { data: project('one') }));
    const running = store.run();
    await new Promise((r) => setTimeout(r, 5));
    const rec = (await cache.get(ID(1)))!;
    await store.put({ ...rec, data: project('two'), updatedAt: rec.updatedAt + 1 });
    release();
    await running;
    await store.run();
    expect(server.colls.pages.get(ID(1))!.data).toEqual(project('two'));
    expect((await cache.get(ID(1)))!.dirty).toBe(false);
  });

  it('records made offline are pushed by the next refresh', async () => {
    await cache.put(local(ID(1)));
    await store.refresh();
    await store.run();
    expect(server.colls.pages.has(ID(1))).toBe(true);
  });
});
