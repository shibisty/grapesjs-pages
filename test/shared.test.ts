import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'grapesjs';
import { strFromU8, unzipSync } from 'fflate';
import { EVENTS } from '../src/events';
import { SHARED_META } from '../src/core/SharedData';
import { MemoryPageStore } from '../src/store/MemoryPageStore';
import type { ProjectData } from '../src/types';
import { createEditor, destroyEditor, tick, type Setup } from './helpers/editor';
import { FakeServerV2 } from './helpers/fakeServerV2';

/**
 * A stand-in for another plugin (grapesjs-blueprints) that keeps its data
 * in the GrapesJS project under one key, through a storable.
 */
function demoPlugin(state: { value: unknown; loads: number }, register = true) {
  return (ed: Editor) => {
    const em = ed.getModel() as any;
    const storables: any[] = em.storables || em.get('storables');
    storables.unshift({
      name: 'Demo',
      storageKey: 'demo',
      store: () => (state.value === undefined ? {} : { demo: state.value }),
      load: (d: any) => {
        state.loads++;
        state.value = d?.demo;
      },
      clear: () => (state.value = undefined),
    });
    if (register) (ed as any).PagesManager?.shared.register('demo');
  };
}

const project = (html: string, extra: Record<string, unknown> = {}): ProjectData =>
  ({ assets: [], styles: [], pages: [{ frames: [{ component: { type: 'wrapper', components: html } }] }], ...extra }) as any;

/** The demo plugin changes its data: GrapesJS reports an update, pages saves. */
async function edit(s: Setup, state: { value: unknown }, value: unknown): Promise<void> {
  state.value = value;
  s.editor.trigger('update');
  await s.api.flush();
}

let editor: Editor | undefined;
let editor2: Editor | undefined;
afterEach(async () => {
  await destroyEditor(editor2);
  await destroyEditor(editor);
  editor = editor2 = undefined;
});

describe('shared project keys (local mode)', () => {
  it('keeps the key once: out of every record, into every record that is opened', async () => {
    const state = { value: undefined as unknown, loads: 0 };
    const s = await createEditor({ extraPlugins: [demoPlugin(state)] });
    editor = s.editor;
    const first = s.api.getActiveId()!;
    await edit(s, state, { scripts: ['global'] });
    expect((await s.store.get(first))!.data).not.toHaveProperty('demo');
    expect(await s.store.getMeta(SHARED_META)).toEqual({ demo: { scripts: ['global'] } });

    // A new page gets it, and its record does not store it either.
    const second = await s.api.create({ name: 'Second' });
    expect(state.value).toEqual({ scripts: ['global'] });
    await edit(s, state, { scripts: ['global', 'more'] });
    expect((await s.store.get(second.id))!.data).not.toHaveProperty('demo');

    // Back on the first page: the plugin is given the value changed on the second.
    const loads = state.loads;
    await s.api.open(first);
    expect(state.loads).toBeGreaterThan(loads);
    expect(state.value).toEqual({ scripts: ['global', 'more'] });
    expect(s.api.shared.get('demo')).toEqual({ scripts: ['global', 'more'] });
    expect(s.api.shared.keys()).toEqual(['demo']);
  });

  it('migrates per-page copies: the first record opened that has one gives the value', async () => {
    const store = new MemoryPageStore();
    const now = Date.now();
    await store.put({ id: 'a', name: 'A', data: project('<p>a</p>', { demo: 'from A' }), createdAt: now, updatedAt: now, dirty: false, deleted: false, remote: null });
    await store.put({ id: 'b', name: 'B', data: project('<p>b</p>', { demo: 'from B' }), createdAt: now + 1, updatedAt: now, dirty: false, deleted: false, remote: null });
    await store.setMeta('active', 'a');
    const state = { value: undefined as unknown, loads: 0 };
    const s = await createEditor({ plugin: { store }, extraPlugins: [demoPlugin(state)] });
    editor = s.editor;
    expect(state.value).toBe('from A');
    await s.api.open('b');
    expect(state.value).toBe('from A'); // B's old copy is ignored now
    expect(await store.getMeta(SHARED_META)).toEqual({ demo: 'from A' });
  });

  it('registering after the start adopts the open record’s value', async () => {
    const state = { value: 'early' as unknown, loads: 0 };
    const s = await createEditor({ extraPlugins: [demoPlugin(state, false)] });
    editor = s.editor;
    // Before registering, the key is stored in the page like any project data.
    await edit(s, state, 'per page');
    expect((await s.store.get(s.api.getActiveId()!))!.data).toHaveProperty('demo', 'per page');
    await s.api.shared.register('demo');
    expect(s.api.shared.get('demo')).toBe('per page');
    const other = await s.api.create({ name: 'Other' });
    expect(state.value).toBe('per page');
    expect((await s.store.get(other.id))!.data).not.toHaveProperty('demo');
  });

  it('undo on a page does not undo the shared value; set() reaches the open record', async () => {
    const state = { value: 'v1' as unknown, loads: 0 };
    const s = await createEditor({ extraPlugins: [demoPlugin(state)] });
    editor = s.editor;
    s.editor.getWrapper()!.append('<p id="x">x</p>');
    await s.api.flush();
    await edit(s, state, 'v2');
    expect(s.api.canUndo()).toBe(true);
    await s.api.undo();
    expect(s.editor.getHtml()).not.toContain('id="x"');
    expect(state.value).toBe('v2');

    const events: unknown[] = [];
    s.editor.on(EVENTS.shared, (p: unknown) => events.push(p));
    await s.api.shared.set('demo', 'from code');
    expect(state.value).toBe('from code');
    expect(events).toEqual([{ key: 'demo', value: 'from code' }]);
    // Giving the value to the plugin is not an edit of the page.
    await s.api.flush();
    expect(s.api.canRedo()).toBe(true);
  });
});

describe('record hooks', () => {
  it('a load hook adds to the project, the save hook takes it out: the record keeps only its own content', async () => {
    const s = await createEditor({ html: '<p class="own">own</p>', css: '.own{color:red}' });
    editor = s.editor;
    const rule = { selectors: ['site-wide'], style: { color: 'blue' }, siteWide: 1 };
    const offLoad = s.api.hooks.onLoad((d) => ({ ...d, styles: [...((d as any).styles || []), rule] }) as any);
    const offSave = s.api.hooks.onSave((d) => ({ ...d, styles: ((d as any).styles || []).filter((r: any) => !r.siteWide) }) as any);
    const id = s.api.getActiveId()!;
    const hasRule = () => !!s.editor.Css.getRule('.site-wide');
    await s.api.open(id, { force: true });
    expect(hasRule()).toBe(true);
    s.editor.getWrapper()!.append('<p>more</p>');
    await s.api.flush();
    const stored = JSON.stringify((await s.store.get(id))!.data);
    expect(stored).toContain('own');
    expect(stored).toContain('more');
    expect(stored).not.toContain('site-wide');
    // Undo goes through the hooks too.
    await s.api.undo();
    expect(hasRule()).toBe(true);
    // Removing: the load hook first, reload (the save hook still strips), then the save hook.
    offLoad();
    await s.api.open(id, { force: true });
    offSave();
    expect(hasRule()).toBe(false);
    expect(JSON.stringify((await s.store.get(id))!.data)).not.toContain('site-wide');
  });

  it('a hook that throws is reported and the record still opens', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const s = await createEditor({ html: '<p>ok</p>', css: '' });
    editor = s.editor;
    s.api.hooks.onLoad(() => {
      throw new Error('broken plugin');
    });
    const p = await s.api.create({ name: 'Two', data: project('<p>two</p>') });
    expect(s.api.getActiveId()).toBe(p.id);
    expect(s.editor.getHtml()).toContain('two');
    expect(err).toHaveBeenCalled();
  });
});

describe('publish hooks and the archive', () => {
  it('local archive: body.html passes the hooks, shared.json carries the shared keys and comes back', async () => {
    const state = { value: { scripts: ['g'] } as unknown, loads: 0 };
    const s = await createEditor({ html: '<p>home</p>', css: '', extraPlugins: [demoPlugin(state)] });
    editor = s.editor;
    await edit(s, state, { scripts: ['g'] });
    s.api.hooks.onPublish((out) => ({ ...out, html: out.html + '<script>/*hook 1*/</script>' }));
    const off = s.api.hooks.onPublish((out) => ({ ...out, html: out.html + '<script>/*hook 2*/</script>' }));
    s.api.hooks.onPublish(() => {
      throw new Error('one broken hook');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const files = Object.fromEntries(Object.entries(unzipSync(await s.api.exportArchive())).map(([k, v]) => [k, strFromU8(v)]));
    const m = JSON.parse(files['manifest.json']);
    const body = files[`${m.records[0].dir}/body.html`];
    expect(body).toContain('/*hook 1*/</script><script>/*hook 2*/');
    expect(JSON.parse(files['shared.json'])).toEqual({ demo: { scripts: ['g'] } });
    off();

    // Into another browser: the shared value arrives with the pages.
    const state2 = { value: undefined as unknown, loads: 0 };
    const t = await createEditor({ html: '<p>x</p>', css: '', plugin: { store: new MemoryPageStore(), dbName: 'two' }, extraPlugins: [demoPlugin(state2)] });
    editor2 = t.editor;
    const bytes = await s.api.exportArchive({ html: false });
    await t.api.importArchive(bytes);
    expect(t.api.shared.get('demo')).toEqual({ scripts: ['g'] });
    expect(state2.value).toEqual({ scripts: ['g'] });
    // Copy mode keeps a value that is already here.
    await t.api.shared.set('demo', 'mine');
    await t.api.importArchive(bytes, { mode: 'copy' });
    expect(t.api.shared.get('demo')).toBe('mine');
  });
});

describe('shared project keys (remote mode)', () => {
  let server: FakeServerV2;
  beforeEach(() => {
    server = new FakeServerV2();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  const remote = async (state: { value: unknown; loads: number }): Promise<Setup> =>
    createEditor({
      html: '<p>start</p>',
      css: '',
      plugin: { store: new MemoryPageStore(), remote: { url: server.base, fetch: server.fetch, cache: new MemoryPageStore(), refreshInterval: 0, retryDelay: 5 } },
      extraPlugins: [demoPlugin(state)],
    });

  it('lives in the site record’s project and goes to the server with it', async () => {
    server.site.name = 'Acme';
    server.site.data = project('', { demo: 'from the server' });
    const state = { value: undefined as unknown, loads: 0 };
    const s = await remote(state);
    editor = s.editor;
    await tick(20);
    expect(state.value).toBe('from the server');
    await edit(s, state, 'changed here');
    const site = (await s.api.store.get('site'))!;
    expect((site.data as any).demo).toBe('changed here');
    const page = (await s.api.list()).find((r) => r.kind === 'page')!;
    expect((page.data as any)?.demo).toBeUndefined();
    await new Promise((r) => setTimeout(r, 60));
    expect((server.site.data as any).demo).toBe('changed here');
  });

  it('the site’s value wins over the initial editor content of a first start', async () => {
    server.site.data = project('', { demo: 'site value' });
    const state = { value: 'initial content' as unknown, loads: 0 };
    const s = await remote(state);
    editor = s.editor;
    await tick(20);
    expect(state.value).toBe('site value');
    expect((await s.api.store.get('site'))!.data).toHaveProperty('demo', 'site value');
  });

  it('a publish runs the remote.markup option, then the hooks', async () => {
    server.site.data = project('');
    server.seed('pages', '00000000-0000-4000-8000-000000000001', 'Home', { slug: '/', data: project('<p>home</p>') });
    const state = { value: undefined as unknown, loads: 0 };
    const s = await createEditor({
      html: '<p>start</p>',
      css: '',
      plugin: {
        store: new MemoryPageStore(),
        remote: {
          url: server.base,
          fetch: server.fetch,
          cache: new MemoryPageStore(),
          refreshInterval: 0,
          retryDelay: 5,
          markup: (out) => ({ ...out, html: out.html + '<!--option-->' }),
        },
      },
      extraPlugins: [demoPlugin(state)],
    });
    editor = s.editor;
    s.api.hooks.onPublish((out) => ({ ...out, html: out.html + '<!--hook-->', css: out.css + '.h{}' }));
    const home = (await s.api.list()).find((r) => r.name === 'Home')!;
    await s.api.open(home.id);
    await s.api.publish(home.id);
    const call = server.find('POST', /publish/).pop()!;
    expect(call.body.html).toMatch(/<!--option--><!--hook-->$/);
    expect(call.body.css).toContain('.h{}');
  });
});
