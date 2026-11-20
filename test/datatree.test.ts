import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from 'grapesjs';
import { breadcrumbsHtml, BREADCRUMBS_TYPE } from '../src/components/breadcrumbs';
import { EVENTS } from '../src/events';
import { click, createEditor, destroyEditor, html, names, rows, settle, sidebar, tick } from './helpers/editor';

let editor: Editor | undefined;
afterEach(async () => {
  await destroyEditor(editor);
  editor = undefined;
});

describe('local mode: a tree of pages', () => {
  it('parent and position through update(); drag and drop moves pages; children are indented', async () => {
    const s = await createEditor();
    editor = s.editor;
    const [home] = await s.api.list();
    const a = await s.api.create({ name: 'A' });
    const b = await s.api.create({ name: 'B' });
    await s.api.update(a.id, { parentId: home.id, slug: 'Über uns' });
    await settle(s.api);
    editor.runCommand('pages-manager:open');
    await tick();
    expect(names()).toEqual(['Page 1', 'A', 'B']);
    expect((await s.store.get(a.id))).toMatchObject({ parentId: home.id, slug: '/uber-uns', dirty: true });
    expect(rows()[1].style.paddingInlineStart).toBe('24px');
    expect(await s.api.move(b.id, a.id, 'inside')).toBe(1);
    await tick();
    expect((await s.store.get(b.id))!.parentId).toBe(a.id);
    expect((await s.api.pathOf(b.id)).map((r) => r.name)).toEqual(['Page 1', 'A', 'B']);
  });
});

describe('data records', () => {
  it('open with their page’s design; design edits go to the page; removing the page removes them', async () => {
    const s = await createEditor();
    editor = s.editor;
    const [page] = await s.api.list();
    const d = await s.api.create({ name: 'Item 1', parentId: page.id, dataOf: page.id });
    await settle(s.api);
    expect((await s.store.get(d.id))!.data).toBeNull();
    expect(html(editor)).toContain('Hello'); // the page's design
    expect((await s.api.designOf(d.id))!.id).toBe(page.id);
    // an edit while the data record is open is saved to the page
    editor.getWrapper()!.append('<p id="added">Added</p>');
    await settle(s.api);
    expect(JSON.stringify((await s.store.get(page.id))!.data)).toContain('Added');
    expect((await s.store.get(d.id))!.data).toBeNull();
    editor.runCommand('pages-manager:open');
    await tick();
    expect(sidebar().querySelector(`.gjsp-item[data-id="${d.id}"]`)!.classList.contains('is-data')).toBe(true);
    // gone with its page
    await s.api.remove(page.id, { confirm: false });
    await settle(s.api);
    expect((await s.api.list()).some((r) => r.id === d.id)).toBe(false);
  });
});

describe('dialogs of other plugins', () => {
  const withSections = (ed: Editor) =>
    ed.on(EVENTS.recordForm, (req: any) => {
      const input = document.createElement('input');
      input.name = 'extra';
      input.value = req.mode === 'edit' ? String(req.record?.values?.extra ?? '') : 'x1';
      req.sections.push({
        id: 'extra',
        label: 'Extra',
        tab: req.mode === 'edit',
        el: input,
        values: () => ({ extra: input.value }),
        validate: () => (input.value === 'bad' ? 'Bad value' : null),
        save: (rec: any) => ((ed as any).__saved = rec.id),
      });
    });

  it('+ asks name, parent and the sections; the sections give values and save after', async () => {
    const s = await createEditor({ extraPlugins: [withSections] });
    editor = s.editor;
    const [home] = await s.api.list();
    editor.runCommand('pages-manager:open');
    click(sidebar().querySelector('.gjsp-tools button[title="New page"]')!);
    await tick(5);
    const form = document.querySelector<HTMLFormElement>('.gjsp-create')!;
    expect(form).toBeTruthy();
    form.querySelector<HTMLInputElement>('input[name="name"]')!.value = 'News';
    form.querySelector<HTMLSelectElement>('select[name="parent"]')!.value = home.id;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(s.api);
    const rec = (await s.api.list()).find((r) => r.name === 'News')!;
    expect(rec).toMatchObject({ parentId: home.id, values: { extra: 'x1' } });
    expect((editor as any).__saved).toBe(rec.id);
    expect(s.api.getActiveId()).toBe(rec.id);
  });

  it('properties: plugin sections are tabs; a refusing section stops the save', async () => {
    const s = await createEditor({ extraPlugins: [withSections] });
    editor = s.editor;
    const [home] = await s.api.list();
    editor.runCommand('pages-manager:properties', { id: home.id });
    await tick(5);
    const form = document.querySelector<HTMLFormElement>('.gjsp-props')!;
    const tabs = [...form.querySelectorAll<HTMLButtonElement>('.gjsp-tab')].map((b) => b.textContent);
    expect(tabs).toEqual(['General', 'Extra']);
    click(form.querySelector('.gjsp-tab[data-tab="extra"]')!);
    expect(form.querySelector<HTMLElement>('[data-pane="general"]')!.hidden).toBe(true);
    const extra = form.querySelector<HTMLInputElement>('input[name="extra"]')!;
    extra.value = 'bad';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick(5);
    expect(form.querySelector('.gjsp-err')!.textContent).toBe('Bad value');
    extra.value = 'good';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(s.api);
    expect((await s.store.get(home.id))!.values).toMatchObject({ extra: 'good' });
  });

  it('without sections + makes the page right away', async () => {
    const s = await createEditor();
    editor = s.editor;
    editor.runCommand('pages-manager:open');
    click(sidebar().querySelector('.gjsp-tools button[title="New page"]')!);
    await settle(s.api);
    expect(document.querySelector('.gjsp-create')).toBeNull();
    expect(names()).toEqual(['Page 1', 'Page 2']);
  });
});

describe('breadcrumbs', () => {
  it('the trail of the open page: ancestors link, the last one is the page', async () => {
    expect(breadcrumbsHtml([])).toBe('');
    expect(breadcrumbsHtml([{ name: 'Home', slug: '/' } as any, { name: 'A & B' } as any])).toBe(
      '<ol><li><a href="/">Home</a></li><li><span aria-current="page">A &amp; B</span></li></ol>'
    );
    const s = await createEditor();
    editor = s.editor;
    const [home] = await s.api.list();
    await s.api.update(home.id, { slug: '/' });
    const child = await s.api.create({ name: 'News', parentId: home.id });
    await settle(s.api);
    const bc = editor.getWrapper()!.append({ type: BREADCRUMBS_TYPE })[0] as any;
    await tick(20);
    expect(editor.getHtml()).toContain('<ol><li><a href="/">Page 1</a></li><li><span aria-current="page">News</span></li></ol>');
    expect(bc.getEl().innerHTML).toContain('aria-current="page">News<');
    expect(JSON.stringify(editor.getProjectData())).not.toContain('aria-current'); // not stored
    await s.api.open(home.id);
    await tick(20);
    expect(child.id).toBeTruthy();
    expect((editor.BlockManager as any).get('page-breadcrumbs')).toBeTruthy();
  });
});

describe('remote wire', () => {
  it('data_of travels both ways', async () => {
    const { fromWire, toWire } = await import('../src/remote/RemoteClient');
    const rec = fromWire({ id: 'd', name: 'D', version: 1, data_of: 'p', parent_id: 'p' } as any, 'page');
    expect(rec).toMatchObject({ dataOf: 'p', parentId: 'p' });
    expect(toWire(rec, false)).toMatchObject({ data_of: 'p', parent_id: 'p' });
    expect(toWire({ ...rec, dataOf: null }, false)).not.toHaveProperty('data_of');
  });
});
