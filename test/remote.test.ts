import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'grapesjs';
import { EVENTS } from '../src/events';
import { SLOT_BLOCK_ID } from '../src/remote/slot';
import { IndexedDbPageStore } from '../src/store/IndexedDbPageStore';
import { MemoryPageStore } from '../src/store/MemoryPageStore';
import { pageTree } from '../src/ui/Sidebar';
import { parentChoices } from '../src/ui/remoteModals';
import type { PageRecord } from '../src/types';
import { click, createEditor, destroyEditor, sidebar, tick, type Setup } from './helpers/editor';
import { FakeServerV2 } from './helpers/fakeServerV2';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = (html: string) =>
  ({ assets: [], styles: [], pages: [{ frames: [{ component: { type: 'wrapper', components: html } }] }] }) as any;

let editor: Editor | undefined;
let server: FakeServerV2;
beforeEach(() => {
  server = new FakeServerV2();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  await destroyEditor(editor);
  editor = undefined;
  indexedDB.deleteDatabase('gjs-pages-manager');
});

const until = async (fn: () => boolean | Promise<boolean>, ms = 1500): Promise<void> => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await tick(5);
  }
};

async function setup(extra: Record<string, unknown> = {}): Promise<Setup> {
  const s = await createEditor({
    html: '<p>start</p>',
    css: '',
    plugin: {
      remote: { url: server.base, fetch: server.fetch, cache: new MemoryPageStore(), refreshInterval: 0, retryDelay: 5 },
      ...extra,
    },
  });
  editor = s.editor;
  s.editor.runCommand('pages-manager:open');
  await tick(10);
  return s;
}

const names = (section?: string) =>
  [...sidebar().querySelectorAll<HTMLElement>('.gjsp-list > li')]
    .reduce<{ cur: string; out: Record<string, string[]> }>(
      (acc, li) => {
        if (li.classList.contains('gjsp-section')) acc.cur = li.dataset.section!;
        else if (li.classList.contains('gjsp-item')) (acc.out[acc.cur] ||= []).push(li.querySelector('.gjsp-name')!.textContent!);
        return acc;
      },
      { cur: '', out: {} }
    ).out[section || 'page'] || [];

const row = (name: string) =>
  [...sidebar().querySelectorAll<HTMLElement>('.gjsp-item')].find((li) => li.querySelector('.gjsp-name')!.textContent === name)!;

const modal = () => document.querySelector<HTMLElement>('.gjs-mdl-container')!;

const saved = async (s: Setup) => {
  await s.api.flush();
  await (s.api.store as any).run();
};

describe('remote mode: start', () => {
  it('reads the server and shows pages as a tree, then layouts, templates and the site', async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/', data: project('<h1>Home</h1>') });
    server.seed('pages', ID(2), 'About', { slug: '/about', position: 2 });
    server.seed('pages', ID(3), 'Team', { slug: '/about/team', parent_id: ID(2) });
    server.seed('pages', ID(4), 'Blog', { slug: '/blog', position: 1 });
    server.seed('pages', ID(5), 'Grinder', { slug: '/products/grinder', template_id: ID(7), page_kind: 'entry' });
    server.seed('layouts', ID(6), 'Main');
    server.seed('templates', ID(7), 'Product');
    const s = await setup();
    expect(s.api.isRemote()).toBe(true);
    expect(names('page')).toEqual(['Home', 'Blog', 'About', 'Team']); // entries are not pages here
    expect(names('layout')).toEqual(['Main']);
    expect(names('template')).toEqual(['Product']);
    expect(names('site').length).toBe(1);
    expect(row('Team').style.paddingInlineStart).toBe('24px');
    expect(row('Home').querySelector('.gjsp-sub')!.textContent).toBe('/ · draft');
    // The first page opened, with the server's content.
    expect(s.api.getActiveId()).toBe(ID(1));
    expect(s.editor.getHtml()).toContain('<h1');
    expect(sidebar().querySelector('.gjsp-status')!.textContent).toBe('All changes saved');
    // Remote toolbar: publish and revisions, no server settings.
    const titles = [...sidebar().querySelectorAll('.gjsp-head .gjsp-btn')].map((b) => b.getAttribute('title'));
    expect(titles).toContain('Publish');
    expect(titles).toContain('Revisions');
    expect(titles).not.toContain('Server settings');
  });

  it('an empty site gets its first page from the editor content, on the server', async () => {
    const s = await setup();
    await saved(s);
    expect(server.colls.pages.size).toBe(1);
    const [p] = server.colls.pages.values();
    expect(JSON.stringify(p.data)).toContain('start');
    expect(p.slug).toBe('/'); // the home page
    expect(names('page')).toEqual(['Page 1']);
  });

  it('local mode rejects the remote API', async () => {
    const s = await createEditor();
    editor = s.editor;
    expect(s.api.isRemote()).toBe(false);
    await expect(s.api.publish()).rejects.toThrow(/remote mode only/);
  });
});

describe('remote mode: editing', () => {
  it('canvas edits are saved to the server with If-Match', async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/', data: project('<p id="x">one</p>') });
    const s = await setup();
    s.editor.getWrapper()!.append('<p>two</p>');
    await saved(s);
    const put = server.find('PUT', `/pages/${ID(1)}`).pop()!;
    expect(put.headers['If-Match']).toBe('"1"');
    expect(JSON.stringify(put.body.data)).toContain('two');
    expect(server.colls.pages.get(ID(1))!.version).toBe(2);
  });

  it('creates layouts and templates from their sections; a layout offers the slot block', async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/' });
    const s = await setup();
    expect(s.editor.Blocks.get(SLOT_BLOCK_ID)).toBeFalsy();
    click(sidebar().querySelector('[data-create="layout"]')!);
    await until(() => names('layout').length === 1);
    expect(names('layout')).toEqual(['Layout 1']);
    expect(s.editor.Blocks.get(SLOT_BLOCK_ID)).toBeTruthy();
    s.editor.getWrapper()!.append('<header>Shop</header><page-slot></page-slot><footer>©</footer>');
    await saved(s);
    expect(server.colls.layouts.size).toBe(1);

    // Publishing a layout sends the body (no <body>) with the slot.
    const rec = await s.api.publish();
    const call = server.find('POST', /\/layouts\/.+\/publish$/)[0];
    expect(call.body.html).toMatch(/^<header[^>]*>Shop<\/header><page-slot[^>]*><\/page-slot><footer/);
    expect(call.body.html).not.toContain('Page goes');
    expect(call.headers['If-Match']).toBe(`"${server.colls.layouts.get(rec.id)!.version - 1}"`);

    click(sidebar().querySelector('[data-create="template"]')!);
    await until(() => names('template').length === 1);
    expect(s.editor.Blocks.get(SLOT_BLOCK_ID)).toBeFalsy();
    await saved(s);
    expect(server.colls.templates.size).toBe(1);
  });

  it('the properties dialog writes slug, parent, layout and SEO', async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/' });
    server.seed('pages', ID(2), 'About', { slug: '/about' });
    server.seed('layouts', ID(6), 'Main');
    const s = await setup();
    s.editor.runCommand('pages-manager:properties', { id: ID(2) });
    await until(() => !!modal()?.querySelector('.gjsp-props'));
    const form = modal().querySelector<HTMLFormElement>('.gjsp-props')!;
    const field = <T extends Element>(n: string) => form.querySelector<T & { value: string }>(`[name="${n}"]`)!;
    // A page cannot be its own parent.
    expect([...field<HTMLSelectElement>('parent').options].map((o) => o.value)).toEqual(['', ID(1)]);
    field('name').value = 'About us';
    field('slug').value = 'Company/About Us';
    field<HTMLSelectElement>('parent').value = ID(1);
    field<HTMLSelectElement>('layout').value = ID(6);
    field('seo.title').value = 'About — Shop';
    form.querySelector<HTMLInputElement>('[name="in_menu"]')!.checked = true;
    click(form.querySelector('[data-role="save"]')!);
    await until(() => !s.editor.Modal.isOpen());
    await saved(s);
    const put = server.find('PUT', `/pages/${ID(2)}`).pop()!;
    expect(put.body).toMatchObject({
      name: 'About us',
      slug: '/company/about-us',
      parent_id: ID(1),
      layout_id: ID(6),
      values: { 'seo.title': 'About — Shop', in_menu: true },
    });
    expect(put.body.data).toBeUndefined(); // header only
    expect(put.body.values).not.toHaveProperty('seo.description'); // untouched keys are not sent…
    await until(() => names('page').join() === 'Home,About us');
    expect(row('About us').style.paddingInlineStart).toBe('24px');
  });
});

describe('remote mode: publishing and revisions', () => {
  it('publishes the open page: HTML without <body>, CSS, status shown', async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/', data: project('<h1 class="t">Hi</h1>') });
    const s = await setup();
    s.editor.Css.setRule('.t', { color: 'red' });
    const events: any[] = [];
    s.editor.on(EVENTS.publish, (e: any) => events.push(e));
    click(sidebar().querySelector('.gjsp-head .gjsp-btn[title="Publish"]')!);
    await until(() => events.length === 1);
    const call = server.find('POST', `/pages/${ID(1)}/publish`)[0];
    expect(call.body.html).toMatch(/^<h1 class="t"[^>]*>Hi<\/h1>$/);
    expect(call.body.css).toContain('.t{color:red;}');
    expect(call.body.css).not.toContain('box-sizing'); // the base rules belong to the site
    expect(events[0]).toMatchObject({ revision: 1, record: { status: 'published' } });
    await until(() => row('Home').querySelector('.gjsp-sub')!.textContent === '/ · published');
    expect(sidebar().querySelector('.gjsp-status')!.textContent).toBe('Published: Home');
    // Editing after publishing works on the new version.
    const live = server.colls.pages.get(ID(1))!.version;
    s.editor.getWrapper()!.append('<p>more</p>');
    await saved(s);
    expect(server.find('PUT', `/pages/${ID(1)}`).pop()!.headers['If-Match']).toBe(`"${live}"`);
  });

  it("adds the components' scripts at the end of the HTML", async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/', data: project('<div class="tick">0</div>') });
    const s = await setup();
    s.editor.Components.addType('ticker', {
      isComponent: (el: HTMLElement) => el.classList?.contains('tick'),
      model: { defaults: { script: function (this: HTMLElement) { this.textContent = '</script>1'; } } },
    });
    s.editor.setComponents('<div class="tick">0</div>');
    const events: any[] = [];
    s.editor.on(EVENTS.publish, (e: any) => events.push(e));
    click(sidebar().querySelector('.gjsp-head .gjsp-btn[title="Publish"]')!);
    await until(() => events.length === 1);
    const html: string = server.find('POST', `/pages/${ID(1)}/publish`)[0].body.html;
    expect(html).toMatch(/^<div id="[^"]+" class="tick">0<\/div><script>[\s\S]*<\\\/script>1[\s\S]*<\/script>$/);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('the markup option changes what a publish sends', async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/', data: project('<p>hi</p>') });
    const seen: any[] = [];
    const s = await setup({
      remote: {
        url: server.base, fetch: server.fetch, cache: new MemoryPageStore(), refreshInterval: 0, retryDelay: 5,
        markup: async (out: any) => {
          seen.push(out);
          await tick(1);
          return { html: out.html + '<script src="https://cdn.example/x.js"></script>', css: '@import url(https://fonts.example/a.css);' + out.css };
        },
      },
    });
    s.editor.setComponents('<p>hi</p>');
    await s.api.publish(ID(1));
    const body = server.find('POST', `/pages/${ID(1)}/publish`)[0].body;
    expect(body.html).toMatch(/<p[^>]*>hi<\/p><script src="https:\/\/cdn.example\/x.js"><\/script>$/);
    expect(body.css.startsWith('@import url(https://fonts.example/a.css);')).toBe(true);
    expect(seen[0]).toMatchObject({ kind: 'page', record: { id: ID(1) } });
  });

  it('an entry publishes its values without HTML; the site publishes its CSS', async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/' });
    server.seed('templates', ID(7), 'Product');
    server.seed('pages', ID(5), 'Grinder', { template_id: ID(7), page_kind: 'entry' });
    const s = await setup();
    await s.api.publish(ID(5));
    expect(server.find('POST', `/pages/${ID(5)}/publish`)[0].body).toEqual({});
    expect(s.api.getActiveId()).toBe(ID(1)); // the entry was not opened
    await s.api.open('site');
    s.editor.Css.setRule('body', { margin: '0' });
    await s.api.publish();
    const call = server.find('POST', '/site/publish')[0];
    expect(Object.keys(call.body)).toEqual(['css']);
    expect(call.body.css).toContain('body{margin:0;}');
  });

  it('publishing stops on a conflict', async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/', data: project('<p>a</p>') });
    const s = await setup();
    server.touch('pages', ID(1), { data: project('<p>theirs</p>') });
    s.editor.getWrapper()!.append('<p>mine</p>');
    await expect(s.api.publish()).rejects.toMatchObject({ status: 412 });
    expect(server.find('POST', /publish$/)).toEqual([]);
    await until(() => !!row('Home')?.classList.contains('has-conflict'));
    expect(row('Home').querySelector('.gjsp-sub')!.textContent).toContain('Conflict');
  });

  it('revisions: lists them and restores one into the draft', async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/', data: project('<p>v1</p>') });
    const s = await setup();
    await s.api.publish();
    s.editor.getWrapper()!.components('<p>v2</p>');
    await s.api.publish();
    const list = await s.api.revisions(ID(1));
    expect(list.map((r) => [r.revision, r.live])).toEqual([
      [2, true],
      [1, false],
    ]);
    s.editor.runCommand('pages-manager:revisions', { id: ID(1) });
    await until(() => modal()?.querySelectorAll('[data-revision]').length === 2);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    click(modal().querySelector('[data-revision="1"] [data-role="restore"]')!);
    await until(() => s.editor.getHtml().includes('v1'));
    expect(s.editor.getHtml()).not.toContain('v2');
    expect(server.find('POST', `/pages/${ID(1)}/revisions/1/restore`).length).toBe(1);
    expect(server.colls.pages.get(ID(1))!.status).toBe('published'); // the live page is unchanged
  });
});

describe('remote mode: conflicts and changes from elsewhere', () => {
  it('the conflict dialog: take the server version', async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/', data: project('<p>a</p>') });
    const s = await setup();
    server.touch('pages', ID(1), { data: project('<p>theirs</p>') });
    s.editor.getWrapper()!.append('<p>mine</p>');
    await saved(s);
    await until(() => !!row('Home')?.classList.contains('has-conflict'));
    click(row('Home').querySelector('.gjsp-act[title="Resolve"]')!);
    await until(() => !!modal()?.querySelector('.gjsp-conflict'));
    click(modal().querySelector('[data-choice="remote"]')!);
    await until(() => s.editor.getHtml().includes('theirs'));
    expect(s.editor.getHtml()).not.toContain('mine');
  });

  it('keep both: mine becomes a copy, the server version stays', async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/home', data: project('<p>a</p>') });
    const s = await setup();
    server.touch('pages', ID(1), { data: project('<p>theirs</p>') });
    s.editor.getWrapper()!.append('<p>mine</p>');
    await saved(s);
    await until(async () => !!(await s.api.store.get(ID(1)))?.conflict);
    await s.api.resolve(ID(1), 'both');
    await (s.api.store as any).run();
    const copy = [...server.colls.pages.values()].find((p) => p.id !== ID(1))!;
    expect(copy.name).toBe('Home (copy)');
    expect(copy.slug).toBe('/home/copy');
    expect(JSON.stringify(copy.data)).toContain('mine');
    expect(JSON.stringify(server.colls.pages.get(ID(1))!.data)).toContain('theirs');
  });

  it('refresh reloads the open page when it changed elsewhere and was not edited here', async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/', data: project('<p>a</p>') });
    const s = await setup();
    server.touch('pages', ID(1), { data: project('<p>from a colleague</p>') });
    await s.api.refresh();
    await until(() => s.editor.getHtml().includes('colleague'));
  });

  it('deleting a page deletes it on the server', async () => {
    server.seed('pages', ID(1), 'Home', { slug: '/' });
    server.seed('pages', ID(2), 'Old', { slug: '/old' });
    const s = await setup();
    await s.api.remove(ID(2), { confirm: false });
    await (s.api.store as any).run();
    expect(server.colls.pages.has(ID(2))).toBe(false);
    expect(names('page')).toEqual(['Home']);
  });
});

describe('remote mode: importing the v1 local pages', () => {
  it('offers the pages of the v1 database once and uploads them as new pages', async () => {
    const v1 = new IndexedDbPageStore('gjs-pages-manager');
    await v1.put({ id: 'old-1', name: 'Old page', data: project('<p>legacy</p>'), createdAt: 1, updatedAt: 1, dirty: false, deleted: false, remote: null });
    await v1.put({ id: 'old-2', name: 'Gone', data: project(''), createdAt: 1, updatedAt: 1, dirty: false, deleted: true, remote: null });
    v1.close?.();
    server.seed('pages', ID(1), 'Home', { slug: '/' });
    const s = await setup();
    await until(() => !!sidebar().querySelector('[data-role="import"]'));
    expect(sidebar().querySelector('[data-role="import"]')!.textContent).toBe('Import local pages (1)');
    click(sidebar().querySelector('[data-role="import"]')!);
    await until(() => names('page').includes('Old page'));
    await (s.api.store as any).run();
    const imported = [...server.colls.pages.values()].find((p) => p.name === 'Old page')!;
    expect(imported.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(imported.slug).toBe('/old-page');
    expect(JSON.stringify(imported.data)).toContain('legacy');
    await until(() => !sidebar().querySelector('[data-role="import"]'));
    expect(sidebar().querySelector('.gjsp-status')!.textContent).toBe('Imported pages: 1');
    expect(await s.api.importLocal()).toBe(0); // marked as imported into this server
  });
});

describe('helpers', () => {
  const p = (id: number, parent: number | null, position = 0, name = `P${id}`): PageRecord =>
    ({ id: ID(id), name, parentId: parent ? ID(parent) : null, position, kind: 'page' }) as PageRecord;

  it('pageTree: parents first, siblings by position then name, cycles at the top', () => {
    const tree = pageTree([p(3, 1, 0, 'b'), p(1, null), p(2, 1, 0, 'a'), p(4, 2), p(5, 6), p(6, 5), p(7, 99)]);
    expect(tree.map((t) => [t.rec.name, t.depth])).toEqual([
      ['P1', 0],
      ['a', 1],
      ['P4', 2],
      ['b', 1],
      ['P7', 0], // unknown parent: a top-level page
      ['P5', 0],
      ['P6', 0],
    ]);
  });

  it('parentChoices leaves out the page and its descendants', () => {
    const all = [p(1, null), p(2, 1), p(3, 2), p(4, null)];
    expect(parentChoices(all[1], all).map((r) => r.id)).toEqual([ID(1), ID(4)]);
  });
});
