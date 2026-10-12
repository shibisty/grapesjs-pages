import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'grapesjs';
import { EVENTS } from '../src/events';
import { createEditor, destroyEditor, html, settle, type Setup } from './helpers/editor';
import { FakeServer } from './helpers/fakeServer';

let editor: Editor | undefined;
let server: FakeServer;

beforeEach(() => {
  server = new FakeServer();
  vi.stubGlobal('fetch', server.fetch);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await destroyEditor(editor);
  editor = undefined;
});

const data = (text: string) =>
  ({ assets: [], styles: [], pages: [{ frames: [{ component: { type: 'wrapper', components: `<p>${text}</p>` } }] }] }) as any;

async function setup(): Promise<Setup> {
  const s = await createEditor({ plugin: { serverUrl: server.base + '/' } });
  editor = s.editor;
  return s;
}

/** Runs plan + apply through the plugin internals (no dialog). */
async function syncAll(s: Setup, choose?: Record<string, 'local' | 'remote' | 'both'>) {
  const plan = await s.api.syncService.plan();
  plan.forEach((p) => p.kind === 'conflict' && (p.choice = choose?.[p.id] || 'local'));
  return { plan, res: await s.api.syncService.apply(plan) };
}

describe('SyncService', () => {
  it('uses the serverUrl option (normalized) until settings are saved', async () => {
    const s = await setup();
    expect(s.api.getSettings()).toEqual({ url: server.base, token: '' });
    await s.api.setSettings({ url: 'https://other.test/x/', token: ' t ' });
    expect(s.api.getSettings()).toEqual({ url: 'https://other.test/x', token: 't' });
    expect(await s.store.getMeta('settings')).toEqual({ url: 'https://other.test/x', token: 't' });
  });

  it('first sync uploads every local page and marks them clean', async () => {
    const s = await setup();
    await s.api.create({ name: 'B' });
    const { plan, res } = await syncAll(s);
    expect(plan.map((p: any) => p.kind)).toEqual(['push', 'push']);
    expect(res.ok).toBe(2);
    expect(res.errors).toEqual([]);
    expect(server.pages.size).toBe(2);
    for (const r of await s.api.list()) {
      expect(r.dirty).toBe(false);
      expect(r.remote).toMatchObject({ version: 1 });
    }
    expect(await s.store.getMeta('lastSync')).toBeTypeOf('number');
  });

  it('second push sends If-Match with the known version', async () => {
    const s = await setup();
    await syncAll(s);
    s.editor.getWrapper()!.append('<p>edit</p>');
    await settle(s.api);
    server.calls = [];
    const { plan } = await syncAll(s);
    expect(plan[0].kind).toBe('push');
    const put = server.calls.find((c) => c.method === 'PUT')!;
    expect(put.headers['If-Match']).toBe('"1"');
    expect([...server.pages.values()][0].version).toBe(2);
  });

  it('pulls a server change into the active page and reloads the canvas', async () => {
    const s = await setup();
    await syncAll(s);
    const id = s.api.getActiveId()!;
    server.pages.get(id)!.data = data('from server');
    server.touch(id, 'Server name');
    const { plan } = await syncAll(s);
    expect(plan[0].kind).toBe('pull');
    expect(html(s.editor)).toContain('from server');
    const rec = (await s.store.get(id))!;
    expect(rec.name).toBe('Server name');
    expect(rec.dirty).toBe(false);
    expect(rec.remote!.version).toBe(2);
  });

  it('downloads pages that exist only on the server', async () => {
    const s = await setup();
    server.seed('remote-1', 'Remote', data('remote page'), 4);
    await syncAll(s);
    const rec = (await s.store.get('remote-1'))!;
    expect(rec.name).toBe('Remote');
    expect(rec.remote!.version).toBe(4);
    await s.api.open('remote-1');
    expect(html(s.editor)).toContain('remote page');
  });

  it('conflict "local" overwrites the server without If-Match', async () => {
    const s = await setup();
    await syncAll(s);
    const id = s.api.getActiveId()!;
    server.touch(id);
    s.editor.getWrapper()!.append('<p>mine</p>');
    await settle(s.api);
    server.calls = [];
    const { plan, res } = await syncAll(s, { [id]: 'local' });
    expect(plan[0].kind).toBe('conflict');
    expect(res.errors).toEqual([]);
    expect(server.calls.find((c) => c.method === 'PUT')!.headers['If-Match']).toBeUndefined();
    expect(JSON.stringify(server.pages.get(id)!.data)).toContain('mine');
  });

  it('conflict "remote" takes the server version', async () => {
    const s = await setup();
    await syncAll(s);
    const id = s.api.getActiveId()!;
    server.pages.get(id)!.data = data('theirs');
    server.touch(id);
    s.editor.getWrapper()!.append('<p>mine</p>');
    await settle(s.api);
    await syncAll(s, { [id]: 'remote' });
    expect(html(s.editor)).toContain('theirs');
    expect(html(s.editor)).not.toContain('mine');
  });

  it('conflict "both" keeps the server version as a "(server)" copy', async () => {
    const s = await setup();
    await syncAll(s);
    const id = s.api.getActiveId()!;
    server.pages.get(id)!.data = data('theirs');
    server.touch(id);
    s.editor.getWrapper()!.append('<p>mine</p>');
    await settle(s.api);
    await syncAll(s, { [id]: 'both' });
    const list = await s.api.list();
    expect(list.map((r) => r.name)).toEqual(['Page 1', 'Page 1 (server)']);
    expect(JSON.stringify(list[1].data)).toContain('theirs');
    expect(JSON.stringify(server.pages.get(id)!.data)).toContain('mine');
  });

  it('a version mismatch on push is reported, not thrown', async () => {
    const s = await setup();
    await syncAll(s);
    const id = s.api.getActiveId()!;
    s.editor.getWrapper()!.append('<p>edit</p>');
    await settle(s.api);
    const sync = s.api.syncService;
    const plan = await sync.plan();
    server.touch(id); // changed between plan and apply
    const res = await sync.apply(plan);
    expect(res.ok).toBe(0);
    expect(res.errors[0].error.message).toBe('The server version has changed (412)');
  });

  it('deletes tombstones on the server and purges them locally', async () => {
    const s = await setup();
    const b = await s.api.create({ name: 'B' });
    await syncAll(s);
    await s.api.remove(b.id, { confirm: false });
    expect((await s.store.get(b.id))!.deleted).toBe(true);
    const { plan } = await syncAll(s);
    expect(plan.find((p) => p.id === b.id)!.kind).toBe('del');
    expect(server.pages.has(b.id)).toBe(false);
    expect(await s.store.get(b.id)).toBeUndefined();
  });

  it('a tombstone whose page is already gone on the server is purged', async () => {
    const s = await setup();
    const b = await s.api.create({ name: 'B' });
    await syncAll(s);
    await s.api.remove(b.id, { confirm: false });
    server.pages.delete(b.id);
    const { plan } = await syncAll(s);
    expect(plan.find((p) => p.id === b.id)!.kind).toBe('purge');
    expect(await s.store.get(b.id)).toBeUndefined();
  });

  it('skips disabled items and emits the sync event', async () => {
    const s = await setup();
    let payload: any;
    s.editor.on(EVENTS.sync, (p: unknown) => (payload = p));
    const sync = s.api.syncService;
    const plan = await sync.plan();
    plan[0].enabled = false;
    const res = await sync.apply(plan);
    expect(res.ok).toBe(0);
    expect(server.pages.size).toBe(0);
    expect(payload).toBe(res);
  });

  it('plan() saves pending edits first', async () => {
    const s = await setup();
    await syncAll(s);
    s.editor.getWrapper()!.append('<p>unsaved</p>');
    const { plan } = await syncAll(s);
    expect(plan[0].kind).toBe('push');
    expect(JSON.stringify([...server.pages.values()][0].data)).toContain('unsaved');
  });
});
