import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Component, Editor } from 'grapesjs';
import { BLOCK_CATEGORY, BLOCK_PREFIX, instanceOf } from '../src/components/ComponentsFeature';
import {
  buildInstance,
  componentProject,
  detachJson,
  expandProject,
  INSTANCE_ATTR,
  INSTANCE_TYPE,
  type Master,
  RULE_INSTANCE,
  RULE_TAG,
} from '../src/components/expand';
import { COMMANDS, EVENTS } from '../src/events';
import { MemoryPageStore } from '../src/store/MemoryPageStore';
import type { ProjectData } from '../src/types';
import { click, createEditor, destroyEditor, html, settle, sidebar, tick, type Setup } from './helpers/editor';
import { FakeServer } from './helpers/fakeServer';
import { FakeServerV2 } from './helpers/fakeServerV2';

type Json = Record<string, any>;

const page = (components: Json[], styles: Json[] = []): ProjectData => componentProject(components, styles);
const wrapperKids = (d: ProjectData): Json[] => (d as any).pages[0].frames[0].component.components;
const footer: Master = {
  id: 'f1',
  name: 'Footer',
  components: [{ tagName: 'footer', attributes: { id: 'ft' }, classes: ['site-footer'], components: [{ type: 'text', components: 'Copyright' }] }],
  styles: [
    { selectors: ['#ft'], style: { color: 'red' } },
    { selectors: ['site-footer'], style: { padding: '10px' } },
    { selectors: ['#ft'], style: { color: 'blue' }, mediaText: '(max-width:500px)', atRuleType: 'media' },
    { selectors: [], selectorsAdd: 'body', style: { margin: '0' } },
    { selectors: ['#elsewhere'], style: { color: 'green' } },
  ],
};
const lib = (...m: Master[]) => new Map(m.map((x) => [x.id, x]));
const inst = (target: string, id = 'k1'): Json => ({ type: INSTANCE_TYPE, attributes: { [INSTANCE_ATTR]: target, id } });

describe('expand (pure)', () => {
  it('builds locked content with ids scoped to the instance', () => {
    const b = buildInstance(footer, 'k1', lib(footer));
    const ft = b.components[0];
    expect(ft.attributes.id).toBe('ft-k1');
    expect(ft.locked).toBe(true);
    expect(ft.selectable).toBe(false);
    expect(ft.components[0].removable).toBe(false);
    // the master is not mutated
    expect(footer.components[0].attributes.id).toBe('ft');
  });

  it('copies id rules per instance, class rules once, drops rules about other things', () => {
    const b = buildInstance(footer, 'k1', lib(footer));
    expect(b.scoped.map((r) => [r.selectors, r.mediaText || ''])).toEqual([
      [['#ft-k1'], ''],
      [['#ft-k1'], '(max-width:500px)'],
    ]);
    expect(b.scoped.every((r) => r[RULE_TAG] === 'f1' && r[RULE_INSTANCE] === 'k1')).toBe(true);
    expect(b.shared).toEqual([{ selectors: ['site-footer'], style: { padding: '10px' }, [RULE_TAG]: 'f1' }]);
  });

  it('expands every instance of a page and regenerates the component rules', () => {
    const data = page([inst('f1', 'a'), { tagName: 'p' }, inst('f1', 'b')], [
      { selectors: ['site-footer'], style: { padding: '99px' } }, // replaced by the component's rule
      { selectors: ['#ft-a'], style: { color: 'old' }, [RULE_TAG]: 'f1', [RULE_INSTANCE]: 'a' }, // stale
      { selectors: ['own'], style: { x: '1' } },
    ]);
    const r = expandProject(data, lib(footer));
    const kids = wrapperKids(r.data);
    expect(kids[0].components[0].attributes.id).toBe('ft-a');
    expect(kids[2].components[0].attributes.id).toBe('ft-b');
    expect(kids[0].name).toBe('Footer');
    const styles = (r.data as any).styles as Json[];
    expect(styles.filter((s) => s.selectors[0] === 'site-footer')).toEqual([{ selectors: ['site-footer'], style: { padding: '10px' }, [RULE_TAG]: 'f1' }]);
    expect(styles.find((s) => s.selectors[0] === 'own')).toBeTruthy();
    expect(styles.filter((s) => s.selectors[0] === '#ft-a' && !s.mediaText)).toEqual([
      { selectors: ['#ft-a'], style: { color: 'red' }, [RULE_TAG]: 'f1', [RULE_INSTANCE]: 'a' },
    ]);
    expect(r.used).toEqual(['f1']);
    expect(r.changed).toBe(true);
  });

  it('is idempotent (the same page twice gives the same data)', () => {
    const once = expandProject(page([inst('f1')]), lib(footer)).data;
    const twice = expandProject(once, lib(footer));
    expect(twice.changed).toBe(false);
    expect(JSON.stringify(twice.data)).toBe(JSON.stringify(once));
  });

  it('turns an instance of a deleted component into a plain copy', () => {
    const data = expandProject(page([inst('f1')]), lib(footer)).data;
    const r = expandProject(data, lib());
    const k = wrapperKids(r.data)[0];
    expect(k.type).toBeUndefined();
    expect(k.attributes[INSTANCE_ATTR]).toBeUndefined();
    expect(k.components[0].locked).toBeUndefined();
    expect(k.components[0].tagName).toBe('footer');
  });

  it('expands nested components and stops cycles', () => {
    const a: Master = { id: 'A', name: 'A', components: [{ tagName: 'div', components: [inst('B', 'nb')] }], styles: [] };
    const b: Master = { id: 'B', name: 'B', components: [{ tagName: 'span', components: [inst('A', 'na')] }], styles: [] };
    const r = expandProject(page([inst('A', 'top')]), lib(a, b));
    const outer = wrapperKids(r.data)[0];
    const nestedB = outer.components[0].components[0];
    expect(nestedB.type).toBe(INSTANCE_TYPE);
    expect(nestedB.attributes.id).toBe('nb-top');
    const nestedA = nestedB.components[0].components[0];
    expect(nestedA.components).toEqual([]); // A inside A: cut
  });

  it('inside the component being edited an instance of itself is empty', () => {
    const r = expandProject(page([inst('f1')]), lib(footer), 'f1');
    expect(wrapperKids(r.data)[0].components).toEqual([]);
  });

  it('detachJson keeps nested instances linked', () => {
    const j = detachJson({ ...inst('A'), locked: true, components: [{ tagName: 'b', locked: true, components: [{ ...inst('B', 'x'), locked: true }] }] });
    expect(j.type).toBeUndefined();
    expect(j.components[0].locked).toBeUndefined();
    expect(j.components[0].components[0].type).toBe(INSTANCE_TYPE);
    expect(j.components[0].components[0].locked).toBeUndefined();
  });
});

/* ---------------------------------------------------------------------- */

let editor: Editor | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await destroyEditor(editor);
  editor = undefined;
});

const find = (ed: Editor, sel: string): Component => ed.getWrapper()!.find(sel)[0];
const instances = (ed: Editor): Component[] => ed.getWrapper()!.find(`[${INSTANCE_ATTR}]`);
const blocks = (ed: Editor) => (ed.Blocks.getAll() as any).models.filter((b: any) => String(b.id).startsWith(BLOCK_PREFIX));

async function withFooter(o: Parameters<typeof createEditor>[0] = {}): Promise<Setup & { id: string; homeId: string }> {
  const s = await createEditor({
    html: '<main id="main"><h1>Home</h1></main><footer id="ft" class="site-footer"><p>Copyright</p></footer>',
    css: '#ft{color:red}.site-footer{padding:10px}',
    ...o,
  });
  editor = s.editor;
  const homeId = s.api.getActiveId()!;
  const rec = await s.api.components.save(find(s.editor, '#ft'), 'Footer');
  return { ...s, id: rec!.id, homeId };
}

describe('save as component', () => {
  it('creates a component record and puts a linked instance in place', async () => {
    const s = await withFooter();
    const rec = (await s.store.get(s.id))!;
    expect(rec.kind).toBe('component');
    expect(rec.name).toBe('Footer');
    expect(s.api.getActiveId()).toBe(s.homeId); // the page stays open
    const [i] = instances(s.editor);
    expect(i.get('type')).toBe(INSTANCE_TYPE);
    expect(i.getAttributes()[INSTANCE_ATTR]).toBe(s.id);
    expect(i.get('name')).toBe('Footer');
    expect(s.editor.getSelected()).toBe(i);
    // same position, same content
    expect(s.editor.getWrapper()!.components().at(1)).toBe(i);
    expect(html(s.editor)).toContain('Copyright');
    // content is read-only
    const inner = i.components().at(0);
    expect(inner.get('locked')).toBe(true);
    expect(inner.get('removable')).toBe(false);
  });

  it('the styles go with the component and still apply', async () => {
    const s = await withFooter();
    const [i] = instances(s.editor);
    const key = i.getId();
    const css = s.editor.getCss()!;
    expect(css).toContain(`#ft-${key}{color:red;}`);
    expect(css).toContain('.site-footer{padding:10px;}');
    expect(css).not.toMatch(/#ft\{/); // the page's own rule moved into the component
    const rec = (await s.store.get(s.id))!;
    expect(JSON.stringify((rec.data as any).styles)).toContain('#ft');
  });

  it('adds a block in the "Components" category', async () => {
    const s = await withFooter();
    const [b] = blocks(s.editor);
    expect(b.id).toBe(BLOCK_PREFIX + s.id);
    expect(b.get('label')).toBe('Footer');
    const cat = b.get('category');
    expect((cat.get ? cat.get('id') : cat.id) ?? cat).toBe(BLOCK_CATEGORY);
  });

  it('asks for a name and does nothing on cancel', async () => {
    const s = await createEditor({ html: '<div id="x">x</div>', css: '' });
    editor = s.editor;
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    expect(await s.api.components.save(find(s.editor, '#x'))).toBeNull();
    expect(s.api.components.list()).toEqual([]);
    vi.spyOn(window, 'prompt').mockReturnValue('Box');
    expect((await s.api.components.save(find(s.editor, '#x')))!.name).toBe('Box');
  });

  it('refuses the wrapper and the content of an instance', async () => {
    const s = await withFooter();
    expect(await s.api.components.save(s.editor.getWrapper(), 'X')).toBeNull();
    const inner = instances(s.editor)[0].components().at(0);
    expect(await s.api.components.save(inner, 'X')).toBeNull();
  });
});

describe('linked instances', () => {
  it('insert puts an instance on another page; the block content does the same', async () => {
    const s = await withFooter();
    await s.api.create({ name: 'About' });
    const a = s.api.components.insert(s.id)!;
    expect(a.components().length).toBe(1);
    expect(html(s.editor)).toContain('Copyright');
    // what a drop of the block adds
    const block = blocks(s.editor)[0];
    s.editor.getWrapper()!.append(block.get('content'));
    expect(instances(s.editor)).toHaveLength(2);
    const ids = instances(s.editor).map((i) => i.components().at(0).getId());
    expect(new Set(ids).size).toBe(2); // ids are unique per instance
    // one shared class rule, two scoped id rules
    const css = s.editor.getCss()!;
    expect(css.match(/\.site-footer\{/g)).toHaveLength(1);
    ids.forEach((id) => expect(css).toContain(`#${id}{color:red;}`));
  });

  it('editing the component updates it on every page', async () => {
    const s = await withFooter();
    const about = await s.api.create({ name: 'About' });
    s.api.components.insert(s.id);
    await settle(s.api);

    await s.api.components.edit(s.id);
    expect(s.api.getActiveId()).toBe(s.id);
    const p = s.editor.getWrapper()!.find('p')[0];
    p.components('New footer text');
    await settle(s.api);

    await s.api.open(s.homeId);
    expect(html(s.editor)).toContain('New footer text');
    expect(html(s.editor)).not.toContain('Copyright');
    await s.api.open(about.id);
    expect(html(s.editor)).toContain('New footer text');
  });

  it('reopening a page does not count as an edit', async () => {
    const s = await withFooter();
    await settle(s.api);
    const before = (await s.store.get(s.homeId))!.updatedAt;
    const other = await s.api.create({ name: 'B' });
    await s.api.open(s.homeId);
    await settle(s.api);
    await s.api.open(other.id);
    await s.api.open(s.homeId);
    await settle(s.api);
    expect((await s.store.get(s.homeId))!.updatedAt).toBe(before);
    const key = instances(s.editor)[0].getId();
    expect(instances(s.editor)[0].components().at(0).getId()).toBe(`ft-${key}`);
  });

  it('the exported HTML keeps the marker (a server can substitute the published component)', async () => {
    const s = await withFooter();
    expect(html(s.editor)).toMatch(new RegExp(`<div[^>]*${INSTANCE_ATTR}="${s.id}"`));
  });

  it('an instance survives a reload of the editor', async () => {
    const s = await withFooter();
    await settle(s.api);
    const store = s.store as MemoryPageStore;
    await destroyEditor(s.editor);
    const b = await createEditor({ plugin: { store }, html: '<p>ignored</p>' });
    editor = b.editor;
    expect(instances(b.editor)).toHaveLength(1);
    expect(blocks(b.editor)).toHaveLength(1);
    expect(instances(b.editor)[0].components().at(0).get('locked')).toBe(true);
  });

  it('detach turns an instance into a plain, editable copy that no longer follows the component', async () => {
    const s = await withFooter();
    const copy = s.api.components.detach(instances(s.editor)[0])!;
    expect(instances(s.editor)).toHaveLength(0);
    expect(copy.get('type')).not.toBe(INSTANCE_TYPE);
    const inner = copy.components().at(0);
    expect(inner.get('locked')).toBeFalsy();
    expect(inner.get('removable')).not.toBe(false);
    // its styles stay as ordinary rules
    const rule = ((s.editor.Css as any).getAll().models as any[]).find((r) => r.selectorsToString() === `#${inner.getId()}`);
    expect(rule.get(RULE_TAG)).toBeUndefined();
    await settle(s.api);
    // the component changes, the detached copy does not
    await s.api.components.edit(s.id);
    s.editor.getWrapper()!.find('p')[0].components('Changed');
    await settle(s.api);
    await s.api.open(s.homeId);
    expect(html(s.editor)).toContain('Copyright');
    expect(html(s.editor)).not.toContain('Changed');
    expect(s.editor.getCss()).toContain('color:red');
  });

  it('deleting a component leaves plain copies where it was used', async () => {
    const s = await withFooter();
    await settle(s.api);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await s.api.remove(s.id);
    expect(confirm.mock.calls[0][0]).toContain('Footer');
    expect(confirm.mock.calls[0][0]).toContain('plain copy');
    await tick(5);
    expect(blocks(s.editor)).toHaveLength(0);
    const other = await s.api.create({ name: 'B' });
    await s.api.open(s.homeId);
    expect(instances(s.editor)).toHaveLength(0);
    expect(html(s.editor)).toContain('Copyright');
    void other;
  });

  it('removing the open component opens a page, not another component', async () => {
    const s = await withFooter();
    await s.api.components.edit(s.id);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await s.api.remove(s.id);
    expect(s.api.getActiveId()).toBe(s.homeId);
  });

  it('undo takes back an inserted instance', async () => {
    const s = await withFooter();
    await settle(s.api);
    await s.api.create({ name: 'B' });
    s.api.components.insert(s.id);
    await settle(s.api);
    await s.api.undo();
    expect(instances(s.editor)).toHaveLength(0);
  });
});

describe('editing a component', () => {
  it('shows a bar with a way back and hides its own block', async () => {
    const s = await withFooter();
    s.editor.select(instances(s.editor)[0]);
    s.editor.runCommand(COMMANDS.editComponent);
    await tick(20);
    expect(s.api.getActiveId()).toBe(s.id);
    expect(blocks(s.editor)).toHaveLength(0);
    const bar = document.querySelector<HTMLElement>('.gjsp-component-bar')!;
    expect(bar.textContent).toContain('Footer');
    await tick(10);
    const back = bar.querySelector<HTMLButtonElement>('.gjsp-component-back')!;
    expect(back.textContent).toContain('Page 1');
    click(back);
    await tick(20);
    await s.api.whenReady();
    expect(s.api.getActiveId()).toBe(s.homeId);
    expect(document.querySelector('.gjsp-component-bar')).toBeNull();
    expect(blocks(s.editor)).toHaveLength(1);
  });

  it('a double click on an instance opens its component', async () => {
    const s = await withFooter();
    const view = (instances(s.editor)[0] as any).view;
    view.el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick(30);
    expect(s.api.getActiveId()).toBe(s.id);
  });

  it('an instance gets an "edit component" toolbar button', async () => {
    const s = await withFooter();
    await tick(5);
    const tb = instances(s.editor)[0].get('toolbar') as any[];
    expect(tb[0].command).toBe(COMMANDS.editComponent);
  });

  it('a new component from the sidebar opens empty', async () => {
    const s = await createEditor();
    editor = s.editor;
    s.editor.runCommand('pages-manager:open');
    await tick();
    const add = sidebar().querySelector<HTMLButtonElement>('[data-create="component"]')!;
    click(add);
    await tick(30);
    const rec = (await s.store.get(s.api.getActiveId()!))!;
    expect(rec.kind).toBe('component');
    expect(rec.name).toBe('Component 1');
    expect(html(s.editor)).not.toContain('Hello');
  });
});

describe('sidebar & context menu', () => {
  it('lists components in their own section, pages stay first', async () => {
    const s = await withFooter();
    s.editor.runCommand('pages-manager:open');
    await tick(10);
    const lis = [...sidebar().querySelectorAll<HTMLElement>('.gjsp-list > li')];
    expect(lis.map((li) => (li.classList.contains('gjsp-section') ? `[${li.dataset.section}]` : li.querySelector('.gjsp-name')!.textContent))).toEqual([
      'Page 1',
      '[component]',
      'Footer',
    ]);
  });

  it('answers grapesjs-context-menu with its items', async () => {
    const s = await withFooter();
    const ask = (component: Component) => {
      const items: any[] = [];
      s.editor.trigger('context-menu:items', { items, ctx: { component } });
      return items;
    };
    const onInstance = ask(instances(s.editor)[0]);
    expect(onInstance.map((i) => i.id)).toEqual(['gjsp-edit-component', 'gjsp-detach-component']);
    // a click inside an instance means the instance
    expect(ask(instances(s.editor)[0].components().at(0)).map((i) => i.id)).toEqual(['gjsp-edit-component', 'gjsp-detach-component']);
    const onPlain = ask(find(s.editor, '#main'));
    expect(onPlain.map((i) => i.id)).toEqual(['gjsp-save-component']);
    expect(ask(s.editor.getWrapper()!)).toEqual([]);
    onInstance[1].run();
    expect(instances(s.editor)).toHaveLength(0);
  });

  it('emits the components event', async () => {
    const s = await createEditor({ html: '<div id="x">x</div>', css: '' });
    editor = s.editor;
    let got: any[] = [];
    s.editor.on(EVENTS.components, (l: any[]) => (got = l));
    await s.api.components.save(find(s.editor, '#x'), 'X');
    expect(got.map((m) => m.name)).toEqual(['X']);
  });

  it('instanceOf finds the instance around a component', async () => {
    const s = await withFooter();
    const i = instances(s.editor)[0];
    expect(instanceOf(i.components().at(0))).toBe(i);
    expect(instanceOf(find(s.editor, '#main'))).toBeNull();
  });
});

describe('sync', () => {
  let server: FakeServer;
  beforeEach(() => {
    server = new FakeServer();
    vi.stubGlobal('fetch', server.fetch);
  });

  it('v1 sync sends kind: component and a pull keeps it', async () => {
    const s = await withFooter({ plugin: { serverUrl: server.base } });
    await settle(s.api);
    await s.api.syncService.apply(await s.api.syncService.plan());
    const put = server.calls.find((c) => c.method === 'PUT' && c.path === `/pages/${s.id}`)!;
    expect(put.body.kind).toBe('component');
    const pagePut = server.calls.find((c) => c.method === 'PUT' && c.path === `/pages/${s.homeId}`)!;
    expect(pagePut.body.kind).toBeUndefined();
    // the server changes it (and forgets the kind): still a component here
    server.touch(s.id, 'Footer v2');
    await s.api.syncService.apply(await s.api.syncService.plan());
    const rec = (await s.store.get(s.id))!;
    expect(rec.name).toBe('Footer v2');
    expect(rec.kind).toBe('component');
  });
});

describe('remote mode (contract v2)', () => {
  let v2: FakeServerV2;
  beforeEach(() => {
    v2 = new FakeServerV2();
  });
  const remote = (s?: FakeServerV2) => ({
    html: '<main><h1>Home</h1></main><div id="cta" class="cta">Buy</div>',
    css: '#cta{color:red}',
    plugin: { remote: { url: v2.base, fetch: (s || v2).fetch, cache: new MemoryPageStore(), refreshInterval: 0, retryDelay: 5 } },
  });

  it('components live in /components and come back from the server', async () => {
    const s = await createEditor(remote());
    editor = s.editor;
    const rec = (await s.api.components.save(find(s.editor, '#cta'), 'CTA'))!;
    await (s.api.store as any).pushNow(rec.id);
    const remoteId = '7d6b6c1e-0000-4000-8000-000000000001';
    expect(v2.colls.components.get(rec.id)?.name).toBe('CTA');
    expect(v2.calls.some((c) => c.method === 'PUT' && c.path === `/components/${rec.id}`)).toBe(true);
    // a component made elsewhere shows up as a block
    v2.seed('components', remoteId, 'Banner', {
      data: componentProject([{ tagName: 'aside', components: [{ type: 'textnode', content: 'Sale' }] }], []),
    } as any);
    await s.api.refresh();
    await tick(10);
    expect(blocks(s.editor).map((b: any) => b.get('label')).sort()).toEqual(['Banner', 'CTA']);
    s.api.components.insert(remoteId);
    expect(html(s.editor)).toContain('Sale');
  });

  it('a server without /components still works; components stay local', async () => {
    v2.noComponents = true;
    const s = await createEditor(remote());
    editor = s.editor;
    const rec = (await s.api.components.save(find(s.editor, '#cta'), 'CTA'))!;
    await s.api.refresh();
    await tick(20);
    expect(await s.api.store.get(rec.id)).toBeTruthy();
    expect(v2.calls.some((c) => c.path.startsWith('/components/'))).toBe(false);
    expect(instances(s.editor)).toHaveLength(1);
  });
});
