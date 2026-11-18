import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'grapesjs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  ArchiveError,
  archiveFiles,
  compose,
  contentHash,
  importOrder,
  packArchive,
  readArchive,
  readArchiveFiles,
  recordDirs,
  type ArchiveRecord,
} from '../src/archive/format';
import { MemoryPageStore } from '../src/store/MemoryPageStore';
import { click, createEditor, destroyEditor, sidebar, tick, type Setup } from './helpers/editor';
import { FakeServerV2 } from './helpers/fakeServerV2';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = (html: string, css = '') =>
  ({ assets: [], styles: css || [], pages: [{ frames: [{ component: { type: 'wrapper', components: html } }] }] }) as any;

const unzip = (b: Uint8Array): Record<string, string> =>
  Object.fromEntries(Object.entries(unzipSync(b)).map(([k, v]) => [k, strFromU8(v)]));

describe('archive format', () => {
  const recs: ArchiveRecord[] = [
    { id: 'site', kind: 'site', name: 'Acme', data: project(''), values: { custom_code: true }, css: 'body{margin:0}' },
    { id: ID(1), kind: 'layout', name: 'Main layout', data: project('<header>H</header><page-slot></page-slot>'), html: '<header>H</header><page-slot></page-slot>', css: 'header{color:red}' },
    { id: ID(2), kind: 'template', name: 'Product', data: project('<h1 data-field="title">T</h1>'), fields: [{ name: 'title', type: 'text' }], html: '<h1>T</h1>', css: '' },
    { id: ID(3), kind: 'page', name: 'Home', slug: '/', data: project('<p>home</p>'), layoutId: ID(1), position: 0, values: { 'seo.title': 'Welcome' }, html: '<p>home</p>', css: 'p{x:y}' },
    { id: ID(4), kind: 'page', name: 'Post', slug: '/blog/post', parentId: ID(5), data: project('<p>post</p>'), html: '<p>post</p>', css: '' },
    { id: ID(5), kind: 'page', name: 'Blog', slug: '/blog', data: project('<p>blog</p>') },
  ];

  it('lays records out by kind, pages by their address', () => {
    const dirs = recordDirs(recs);
    expect(dirs.get('site')).toBe('site');
    expect(dirs.get(ID(1))).toBe('layouts/main-layout');
    expect(dirs.get(ID(2))).toBe('templates/product');
    expect(dirs.get(ID(3))).toBe('pages/index');
    expect(dirs.get(ID(4))).toBe('pages/blog/post');
    expect(dirs.get(ID(5))).toBe('pages/blog');
    // Same names get distinct folders.
    const two = recordDirs([
      { id: ID(7), kind: 'layout', name: 'A' },
      { id: ID(8), kind: 'layout', name: 'a' },
    ]);
    expect(new Set(two.values()).size).toBe(2);
  });

  it('writes the projects, the markup, a preview and the manifest', () => {
    const files = archiveFiles(recs, { source: 'https://x' });
    const m = JSON.parse(files['manifest.json']);
    expect(m.format).toBe('grapesjs-pages-archive');
    expect(m.version).toBe(1);
    expect(m.source).toBe('https://x');
    expect(m.records.map((r: any) => r.id)).toEqual(recs.map((r) => r.id));
    expect(JSON.parse(files['templates/product/fields.json'])).toEqual([{ name: 'title', type: 'text' }]);
    expect(JSON.parse(files['site/settings.json'])).toEqual({ custom_code: true });
    expect(files['site/style.css']).toBe('body{margin:0}');
    expect(files['pages/index/body.html']).toBe('<p>home</p>');
    // The preview: the site's CSS, the layout's, its own; the page in the layout's slot.
    const doc = files['pages/index/index.html'];
    expect(doc).toContain('<title>Welcome</title>');
    expect(doc).toContain('href="../../site/style.css"');
    expect(doc).toContain('href="../../layouts/main-layout/style.css"');
    expect(doc).toContain('<header>H</header><p>home</p>');
    expect(files['pages/blog/post/index.html']).toContain('href="../../../site/style.css"');
    // Not rendered: the project only.
    expect(files['pages/blog/body.html']).toBeUndefined();
    expect(files['layouts/main-layout/index.html']).toBeUndefined();
  });

  it('reads back what it wrote (ZIP round trip)', () => {
    const back = readArchive(packArchive(recs));
    expect(back.edited).toEqual([]);
    expect(back.records.map((r) => [r.id, r.kind, r.name])).toEqual(recs.map((r) => [r.id, r.kind, r.name]));
    const home = back.records.find((r) => r.id === ID(3))!;
    expect(home.slug).toBe('/');
    expect(home.layoutId).toBe(ID(1));
    expect(home.values).toEqual({ 'seo.title': 'Welcome' });
    expect(home.data).toEqual(recs[3].data);
    expect(back.records.find((r) => r.id === ID(2))!.fields).toEqual([{ name: 'title', type: 'text' }]);
    expect(back.records.find((r) => r.id === 'site')!.values).toEqual({ custom_code: true });
  });

  it('takes HTML or CSS edited in another tool instead of the project', () => {
    const files = archiveFiles(recs);
    files['pages/index/body.html'] = '<p>edited elsewhere</p>';
    files['site/style.css'] = 'body{margin:1px}';
    const back = readArchiveFiles(files);
    expect(back.edited.sort()).toEqual([ID(3), 'site'].sort());
    const home = back.records.find((r) => r.id === ID(3))!;
    expect((home.data as any).pages[0].frames[0].component).toBe('<p>edited elsewhere</p>');
    expect((home.data as any).styles).toBe('p{x:y}');
    expect((back.records.find((r) => r.id === 'site')!.data as any).styles).toBe('body{margin:1px}');
    // Untouched records keep their project.
    expect(back.records.find((r) => r.id === ID(1))!.data).toEqual(recs[1].data);
  });

  it('builds a record from markup when there is no project', () => {
    const files = archiveFiles(recs);
    delete files['pages/index/project.json'];
    const home = readArchiveFiles(files).records.find((r) => r.id === ID(3))!;
    expect((home.data as any).pages[0].frames[0].component).toBe('<p>home</p>');
  });

  it('accepts a ZIP of the folder (one top folder)', () => {
    const files = archiveFiles(recs);
    const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [`my-site/${k}`, strToU8(v)])));
    expect(readArchive(zip).records).toHaveLength(recs.length);
  });

  it('refuses what is not an archive', () => {
    expect(() => readArchive(strToU8('not a zip'))).toThrow(ArchiveError);
    expect(() => readArchive(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/manifest/);
    const files = archiveFiles(recs);
    const m = JSON.parse(files['manifest.json']);
    expect(() => readArchiveFiles({ ...files, 'manifest.json': JSON.stringify({ ...m, version: 99 }) })).toThrow(/newer/);
    expect(() => readArchiveFiles({ ...files, 'manifest.json': JSON.stringify({ ...m, records: [m.records[1], m.records[1]] }) })).toThrow(/repeated/);
  });

  it('orders an import: site, layouts, templates, parents before children', () => {
    const order = importOrder(recs).map((r) => r.id);
    expect(order.slice(0, 3)).toEqual(['site', ID(1), ID(2)]);
    expect(order.indexOf(ID(5))).toBeLessThan(order.indexOf(ID(4)));
  });

  it('composes a page into its layout', () => {
    expect(compose('<main><page-slot></page-slot></main>', '<p>x</p>')).toBe('<main><p>x</p></main>');
    expect(compose('<main><div data-page-slot="">old</div></main>', '<p>x</p>')).toBe('<main><p>x</p></main>');
    expect(compose(undefined, '<p>x</p>')).toBe('<p>x</p>');
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });
});

let editor: Editor | undefined;
let editor2: Editor | undefined;
afterEach(async () => {
  await destroyEditor(editor2);
  await destroyEditor(editor);
  editor = editor2 = undefined;
});

const until = async (fn: () => boolean | Promise<boolean>, ms = 2000): Promise<void> => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await tick(5);
  }
};

describe('local mode', () => {
  it('exports the pages with their HTML and imports them into another browser', async () => {
    const s = await createEditor({ html: '<p id="a">first</p>', css: '#a{color:red}' });
    editor = s.editor;
    const second = await s.api.create({ name: 'Second', data: project('<p>second</p>') });
    await s.api.flush();
    const opened: string[] = [];
    s.editor.on('pages-manager:open', (r: any) => opened.push(r.id));
    const bytes = await s.api.exportArchive();
    expect(opened).toEqual([]);
    expect(s.editor.getHtml()).toContain('second');
    // Back on the page that was open; the passing loads sent no open events (no tabs).
    expect(s.api.getActiveId()).toBe(second.id);
    const files = unzip(bytes);
    const m = JSON.parse(files['manifest.json']);
    expect(m.records.map((r: any) => r.name)).toEqual(['Page 1', 'Second']);
    expect(files[`${m.records[0].dir}/body.html`]).toContain('first');
    expect(files[`${m.records[0].dir}/style.css`]).toContain('color:red');
    expect(files[`${m.records[1].dir}/body.html`]).toContain('second');

    // Into a second, empty editor; then once more: the same ids are updated.
    const t = await createEditor({ html: '<p>other</p>', css: '', plugin: { store: new MemoryPageStore(), dbName: 'other' } });
    editor2 = t.editor;
    const r1 = await t.api.importArchive(bytes);
    expect(r1).toMatchObject({ created: 2, updated: 0, errors: [] });
    expect((await t.api.list()).map((p) => p.name)).toEqual(['Page 1', 'Page 1', 'Second']);
    const r2 = await t.api.importArchive(bytes);
    expect(r2).toMatchObject({ created: 0, updated: 2 });
    const r3 = await t.api.importArchive(bytes, { mode: 'copy' });
    expect(r3).toMatchObject({ created: 2, updated: 0 });
    expect((await t.api.list())).toHaveLength(5);
  });

  it('brings back a page whose HTML and CSS were edited elsewhere', async () => {
    const s = await createEditor({ html: '<p id="a">first</p>', css: '#a{color:red}' });
    editor = s.editor;
    const files = unzip(await s.api.exportArchive());
    const m = JSON.parse(files['manifest.json']);
    const dir = m.records[0].dir;
    files[`${dir}/body.html`] = '<h2 class="x">Edited</h2>';
    files[`${dir}/style.css`] = '.x{color:blue}';
    const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
    const r = await s.api.importArchive(zip);
    expect(r).toMatchObject({ updated: 1, fromMarkup: 1 });
    await s.api.open(m.records[0].id, { force: true });
    await tick(20);
    expect(s.editor.getHtml()).toContain('<h2 class="x">Edited</h2>');
    expect(s.editor.getCss()).toContain('.x{color:blue;}');
  });

  it('exports without rendering when asked, leaving the canvas alone', async () => {
    const s = await createEditor();
    editor = s.editor;
    const open = vi.spyOn(s.api, 'open');
    const files = unzip(await s.api.exportArchive({ html: false }));
    expect(Object.keys(files).some((f) => f.endsWith('body.html'))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('has toolbar buttons and dialogs', async () => {
    const s = await createEditor();
    editor = s.editor;
    s.editor.runCommand('pages-manager:open');
    await tick(10);
    const titles = [...sidebar().querySelectorAll<HTMLButtonElement>('.gjsp-tools .gjsp-btn')].map((b) => b.title);
    expect(titles).toContain('Export the site (ZIP)');
    expect(titles).toContain('Import a site archive');
    s.editor.runCommand('pages-manager:import');
    expect(document.querySelector('.gjsp-archive input[type=file]')).toBeTruthy();
    // Local mode has no site record: no site checkbox.
    expect(document.querySelector('.gjsp-archive input[name=site]')).toBeNull();
    click(document.querySelector('.gjsp-archive [data-role=import]')!);
    await tick(5);
    expect(document.querySelector('.gjsp-archive .gjsp-err')?.textContent).toBe('Archive (.zip)');
    s.editor.Modal.close();
    const dl = vi.spyOn(s.api, 'downloadArchive');
    s.editor.runCommand('pages-manager:export');
    expect(dl).not.toHaveBeenCalled();
  });
});

describe('remote mode', () => {
  let server: FakeServerV2;
  beforeEach(() => {
    server = new FakeServerV2();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  const remote = async (srv: FakeServerV2, which: 1 | 2 = 1): Promise<Setup> => {
    const s = await createEditor({
      html: '<p>start</p>',
      css: '',
      plugin: { store: new MemoryPageStore(), remote: { url: srv.base, fetch: srv.fetch, cache: new MemoryPageStore(), refreshInterval: 0, retryDelay: 5 } },
    });
    if (which === 1) editor = s.editor;
    else editor2 = s.editor;
    return s;
  };

  const seed = () => {
    server.site.name = 'Acme';
    server.site.settings = { custom_code: true };
    server.site.data = project('', 'body{margin:0}');
    server.seed('layouts', ID(1), 'Main', { data: project('<header>H</header><page-slot></page-slot>') });
    server.seed('templates', ID(2), 'Product', { data: project('<h1 data-field="title">T</h1>'), fields: [{ name: 'title', type: 'text' }] });
    server.seed('pages', ID(3), 'Home', { slug: '/', data: project('<p>home</p>'), layout_id: ID(1), values: { 'seo.title': 'Welcome' } });
    server.seed('pages', ID(4), 'Blog', { slug: '/blog', data: project('<p>blog</p>') });
    server.seed('pages', ID(5), 'Post', { slug: '/blog/post', parent_id: ID(4), data: project('<p>post</p>') });
    // An entry of the template: content, not design.
    server.seed('pages', ID(6), 'Phone', { slug: '/phone', template_id: ID(2), page_kind: 'entry', values: { title: 'Phone X' } });
  };

  it('exports every kind with the template fields, no entries', async () => {
    seed();
    const s = await remote(server);
    const files = unzip(await s.api.exportArchive());
    const m = JSON.parse(files['manifest.json']);
    expect(m.source).toBe(server.base);
    expect(m.records.map((r: any) => r.kind).sort()).toEqual(['layout', 'page', 'page', 'page', 'site', 'template']);
    expect(m.records.find((r: any) => r.id === ID(6))).toBeUndefined();
    expect(JSON.parse(files['templates/product/fields.json'])).toEqual([{ name: 'title', type: 'text' }]);
    expect(JSON.parse(files['site/settings.json'])).toEqual({ custom_code: true });
    expect(files['pages/index/body.html']).toContain('home');
    expect(files['pages/index/index.html']).toContain('<header>H</header>');
    expect(files['layouts/main/body.html']).toContain('page-slot');
    expect(files['site/style.css']).toContain('margin:0');
    expect(m.records.find((r: any) => r.id === ID(5)).parentId).toBe(ID(4));
  });

  it('imports into another site with the same ids, then updates them', async () => {
    seed();
    const s = await remote(server);
    const bytes = await s.api.exportArchive({ html: false });

    const other = new FakeServerV2('https://other.test/api/editor');
    const t = await remote(other, 2);
    const r = await t.api.importArchive(bytes);
    expect(r.errors).toEqual([]);
    // The other site's own home page "Page 1" has the address /: the archive's home page updates it.
    expect(r.updated).toBe(2); // the site + the home page (matched by its address)
    expect(r.created).toBe(4);
    expect(other.colls.layouts.get(ID(1))?.name).toBe('Main');
    expect(other.colls.templates.get(ID(2))?.fields).toEqual([{ name: 'title', type: 'text' }]);
    expect(other.colls.pages.get(ID(5))?.parent_id).toBe(ID(4));
    const home = [...other.colls.pages.values()].find((p) => p.slug === '/')!;
    expect(home.layout_id).toBe(ID(1));
    expect(home.values).toEqual({ 'seo.title': 'Welcome' });
    expect(other.site.settings).toEqual({ custom_code: true });
    expect(other.site.name).toBe('Acme');
    // Layouts and templates before the pages that use them.
    const puts = other.find('PUT', /^\/(layouts|templates|pages)\//).map((c) => c.path.split('/')[1]);
    expect(puts.indexOf('layouts')).toBeLessThan(puts.lastIndexOf('pages'));

    const again = await t.api.importArchive(bytes);
    expect(again).toMatchObject({ created: 0, updated: 6, errors: [] });
  });

  it('adds the archive as copies with new ids, free addresses and remapped references', async () => {
    seed();
    const s = await remote(server);
    const bytes = await s.api.exportArchive({ html: false });
    const before = server.colls.pages.size;
    const r = await s.api.importArchive(bytes, { mode: 'copy' });
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({ created: 5, updated: 0, skipped: 1 }); // the site is left alone
    expect(server.colls.pages.size).toBe(before + 3);
    expect(server.colls.layouts.size).toBe(2);
    const post = server.colls.pages.get(r.ids[ID(5)])!;
    expect(post.slug).toBe('/blog/post-2');
    expect(post.parent_id).toBe(r.ids[ID(4)]);
    expect(post.parent_id).not.toBe(ID(4));
    expect(server.colls.pages.get(r.ids[ID(3)])!.slug).toBe('/home');
    expect(server.colls.pages.get(r.ids[ID(3)])!.layout_id).toBe(r.ids[ID(1)]);
    expect(server.colls.templates.get(r.ids[ID(2)])!.fields).toEqual([{ name: 'title', type: 'text' }]);
  });

  it('reports a record the server refuses and goes on', async () => {
    seed();
    const s = await remote(server);
    const files = unzip(await s.api.exportArchive({ html: false }));
    const m = JSON.parse(files['manifest.json']);
    m.records.find((x: any) => x.id === ID(4)).name = '   ';
    files['manifest.json'] = JSON.stringify(m);
    const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
    const other = new FakeServerV2('https://other.test/api/editor');
    const t = await remote(other, 2);
    const r = await t.api.importArchive(zip);
    // An empty name becomes the kind ("page"): accepted. A bad parent is not in this server.
    expect(r.errors).toEqual([]);
    other.failWith = 500;
    const failing = await t.api.importArchive(zip, { mode: 'copy' });
    expect(failing.created).toBe(0);
    expect(failing.errors).toHaveLength(5);
    expect(failing.errors[0].error).toBe('offline');
    other.failWith = null;
  });

  it('the import dialog offers the site and imports a chosen file', async () => {
    seed();
    const s = await remote(server);
    const bytes = await s.api.exportArchive({ html: false });
    s.editor.runCommand('pages-manager:import');
    const box = document.querySelector('.gjsp-archive')!;
    expect(box.querySelector('input[name=site]')).toBeTruthy();
    const input = box.querySelector<HTMLInputElement>('input[type=file]')!;
    const file = new File([bytes as BlobPart], 'site.zip', { type: 'application/zip' });
    Object.defineProperty(input, 'files', { value: [file] });
    click(box.querySelector('[data-role=import]')!);
    await until(() => /Imported/.test(box.querySelector('.gjsp-msg')?.textContent || ''), 4000);
    expect(box.querySelector('.gjsp-msg')!.textContent).toContain('0 new, 6 updated');
  });
});
