import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'grapesjs';
import { MemoryPageStore } from '../src/store/MemoryPageStore';
import type { PageRecord } from '../src/types';
import { COLLAPSED_META } from '../src/ui/Sidebar';
import { fold, keyboardMove, matches, moveInTree, pageTree, searchTree, subtree } from '../src/ui/tree';
import { click, createEditor, destroyEditor, sidebar, tick, type Setup } from './helpers/editor';
import { FakeServerV2 } from './helpers/fakeServerV2';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const p = (n: number, parent: number | null, position = 0, name = `P${n}`, slug = `/p${n}`): PageRecord =>
  ({ id: ID(n), name, slug, parentId: parent ? ID(parent) : null, position, kind: 'page' }) as PageRecord;

/*
 * 1 Home
 * ├ 2 About
 * │ └ 4 Team
 * └ 3 Blog
 * 5 Contacts
 */
const site = () => [p(1, null, 0, 'Home', '/'), p(2, 1, 0, 'About'), p(3, 1, 1, 'Blog'), p(4, 2, 0, 'Team'), p(5, null, 1, 'Contacts')];
const names = (rows: { rec: PageRecord; depth: number }[]) => rows.map((r) => `${'-'.repeat(r.depth)}${r.rec.name}`);

describe('tree functions', () => {
  it('pageTree: depth, parent flags, collapsed subtrees left out', () => {
    expect(names(pageTree(site()))).toEqual(['Home', '-About', '--Team', '-Blog', 'Contacts']);
    expect(pageTree(site()).map((r) => r.parent)).toEqual([true, true, false, false, false]);
    expect(names(pageTree(site(), new Set([ID(1)])))).toEqual(['Home', 'Contacts']);
    expect(names(pageTree(site(), new Set([ID(2)])))).toEqual(['Home', '-About', '-Blog', 'Contacts']);
  });

  it('subtree', () => {
    expect([...subtree(site(), ID(1))].sort()).toEqual([ID(1), ID(2), ID(3), ID(4)]);
    expect([...subtree(site(), ID(4))]).toEqual([ID(4)]);
  });

  it('moveInTree: before, after, inside; renumbers the new siblings', () => {
    // Contacts before About: a child of Home, first.
    expect(moveInTree(site(), ID(5), ID(2), 'before')).toEqual([
      { id: ID(5), parentId: ID(1), position: 0 },
      { id: ID(2), parentId: ID(1), position: 1 },
      { id: ID(3), parentId: ID(1), position: 2 },
    ]);
    // Blog after Contacts: top level, last.
    expect(moveInTree(site(), ID(3), ID(5), 'after')).toEqual([{ id: ID(3), parentId: null, position: 2 }]);
    // Team inside Blog.
    expect(moveInTree(site(), ID(4), ID(3), 'inside')).toEqual([{ id: ID(4), parentId: ID(3), position: 0 }]);
    // Only what changes: Blog before About swaps two positions.
    expect(moveInTree(site(), ID(3), ID(2), 'before')).toEqual([
      { id: ID(3), parentId: ID(1), position: 0 },
      { id: ID(2), parentId: ID(1), position: 1 },
    ]);
  });

  it('moveInTree refuses moves into its own subtree, onto itself, of unknown pages', () => {
    expect(moveInTree(site(), ID(1), ID(4), 'inside')).toEqual([]);
    expect(moveInTree(site(), ID(2), ID(4), 'after')).toEqual([]);
    expect(moveInTree(site(), ID(2), ID(2), 'before')).toEqual([]);
    expect(moveInTree(site(), ID(9), ID(2), 'before')).toEqual([]);
    // Already there: nothing to change.
    expect(moveInTree(site(), ID(3), ID(2), 'after')).toEqual([]);
  });

  it('keyboardMove', () => {
    expect(keyboardMove(site(), ID(3), 'up')).toEqual({ targetId: ID(2), where: 'before' });
    expect(keyboardMove(site(), ID(2), 'up')).toBeNull();
    expect(keyboardMove(site(), ID(2), 'down')).toEqual({ targetId: ID(3), where: 'after' });
    expect(keyboardMove(site(), ID(3), 'in')).toEqual({ targetId: ID(2), where: 'inside' });
    expect(keyboardMove(site(), ID(2), 'in')).toBeNull();
    expect(keyboardMove(site(), ID(4), 'out')).toEqual({ targetId: ID(2), where: 'after' });
    expect(keyboardMove(site(), ID(1), 'out')).toBeNull();
  });

  it('search: name or slug, any case and accents, with ancestors', () => {
    expect(fold('Café ÉTÉ')).toBe('cafe ete');
    expect(matches(p(1, null, 0, 'Crème brûlée'), 'creme')).toBe(true);
    expect(matches(p(1, null, 0, 'X', '/about/team'), 'TEAM')).toBe(true);
    expect(searchTree(site(), '  ')).toBeNull();
    expect([...searchTree(site(), 'team')!].sort()).toEqual([ID(1), ID(2), ID(4)]);
    expect([...searchTree(site(), 'nothing')!]).toEqual([]);
  });
});

/* ---------------------------- in the sidebar ---------------------------- */

let editor: Editor | undefined;
let server: FakeServerV2;
beforeEach(() => {
  server = new FakeServerV2();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  await destroyEditor(editor);
  editor = undefined;
});

const until = async (fn: () => boolean | Promise<boolean>, ms = 1500): Promise<void> => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await tick(5);
  }
};

async function remoteSite(): Promise<Setup> {
  server.seed('pages', ID(1), 'Home', { slug: '/' });
  server.seed('pages', ID(2), 'About', { slug: '/about', parent_id: ID(1) });
  server.seed('pages', ID(3), 'Blog', { slug: '/blog', parent_id: ID(1), position: 1 });
  server.seed('pages', ID(4), 'Team', { slug: '/about/team', parent_id: ID(2) });
  server.seed('pages', ID(5), 'Contacts', { slug: '/contacts', position: 1 });
  server.seed('layouts', ID(6), 'Main');
  const s = await createEditor({
    html: '<p>x</p>',
    css: '',
    plugin: { remote: { url: server.base, fetch: server.fetch, cache: new MemoryPageStore(), refreshInterval: 0, retryDelay: 5 } },
  });
  editor = s.editor;
  s.editor.runCommand('pages-manager:open');
  await tick(10);
  return s;
}

const pageNames = () =>
  [...sidebar().querySelectorAll<HTMLElement>('[data-section="page"] ~ .gjsp-item')]
    .filter((li) => {
      // Rows up to the next section.
      let el: Element | null = li.previousElementSibling;
      while (el && !el.classList.contains('gjsp-section')) el = el.previousElementSibling;
      return (el as HTMLElement)?.dataset.section === 'page';
    })
    .map((li) => {
      const depth = Math.round((parseInt(li.style.paddingInlineStart || '10', 10) - 10) / 14);
      return '-'.repeat(depth) + li.querySelector('.gjsp-name')!.textContent;
    });

const row = (name: string) =>
  [...sidebar().querySelectorAll<HTMLElement>('.gjsp-item')].find((li) => li.querySelector('.gjsp-name')!.textContent === name)!;
const search = () => sidebar().querySelector<HTMLInputElement>('.gjsp-search')!;
const type = async (text: string) => {
  search().value = text;
  search().dispatchEvent(new Event('input'));
  await tick(5);
};
const fire = (el: Element, type: string, extra: Record<string, unknown> = {}) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, extra);
  el.dispatchEvent(e);
  return e;
};

describe('the tree in the sidebar (remote mode)', () => {
  it('collapses and expands; the state is kept', async () => {
    const s = await remoteSite();
    expect(pageNames()).toEqual(['Home', '-About', '--Team', '-Blog', 'Contacts']);
    click(row('About').querySelector('.gjsp-twisty')!);
    await tick(5);
    expect(pageNames()).toEqual(['Home', '-About', '-Blog', 'Contacts']);
    expect(row('About').querySelector('.gjsp-twisty')!.textContent).toBe('▸');
    expect(await s.api.store.getMeta(COLLAPSED_META)).toEqual([ID(2)]);
    expect(row('Blog').querySelector<HTMLButtonElement>('.gjsp-twisty')!.disabled).toBe(true); // no children
    // Arrow keys on the row too.
    fire(row('About'), 'keydown', { key: 'ArrowRight' });
    await tick(5);
    expect(pageNames()).toContain('--Team');
    fire(row('Home'), 'keydown', { key: 'ArrowLeft' });
    await tick(5);
    expect(pageNames()).toEqual(['Home', 'Contacts']);
  });

  it('drag and drop moves a page inside another and saves parent and positions', async () => {
    const s = await remoteSite();
    fire(row('Contacts'), 'dragstart');
    const over = fire(row('Blog'), 'dragover', { clientY: 0 });
    expect(over.defaultPrevented).toBe(true); // jsdom rows have no height: the middle zone
    expect(row('Blog').classList.contains('drop-inside')).toBe(true);
    fire(row('Blog'), 'drop', { clientY: 0 });
    await until(() => pageNames().join() === 'Home,-About,--Team,-Blog,--Contacts');
    await (s.api.store as any).run();
    expect(server.colls.pages.get(ID(5))).toMatchObject({ parent_id: ID(3), position: 0 });
    expect(server.find('PUT', `/pages/${ID(5)}`).pop()!.body).toMatchObject({ parent_id: ID(3), position: 0 });
    expect(server.find('PUT', `/pages/${ID(5)}`).pop()!.body.data).toBeUndefined();
  });

  it('a page cannot be dropped into its own subtree', async () => {
    await remoteSite();
    fire(row('Home'), 'dragstart');
    expect(fire(row('Team'), 'dragover').defaultPrevented).toBe(false);
    expect(row('Team').className).not.toMatch(/drop-/);
    fire(row('Team'), 'drop');
    await tick(20);
    expect(pageNames()).toEqual(['Home', '-About', '--Team', '-Blog', 'Contacts']);
    expect(server.find('PUT', '/pages/')).toEqual([]);
  });

  it('Alt+arrows: reorder, indent, outdent', async () => {
    const s = await remoteSite();
    fire(row('Blog'), 'keydown', { key: 'ArrowUp', altKey: true });
    await until(() => pageNames().join() === 'Home,-Blog,-About,--Team,Contacts');
    fire(row('About'), 'keydown', { key: 'ArrowRight', altKey: true }); // into Blog
    await until(() => pageNames().join() === 'Home,-Blog,--About,---Team,Contacts');
    fire(row('Team'), 'keydown', { key: 'ArrowLeft', altKey: true }); // after About
    await until(() => pageNames().join() === 'Home,-Blog,--About,--Team,Contacts');
    await (s.api.store as any).run();
    expect(server.colls.pages.get(ID(2))!.parent_id).toBe(ID(3));
    expect(server.colls.pages.get(ID(4))).toMatchObject({ parent_id: ID(3), position: 1 });
    expect(await s.api.move(ID(1), ID(4), 'inside')).toBe(0);
  });

  it('search keeps the matches in place with their ancestors; Escape clears; Enter opens', async () => {
    const s = await remoteSite();
    click(row('About').querySelector('.gjsp-twisty')!); // collapsed: a search still finds Team
    await tick(5);
    await type('team');
    expect(pageNames()).toEqual(['Home', '-About', '--Team']);
    expect(row('Team').classList.contains('is-match')).toBe(true);
    expect(row('About').classList.contains('is-context')).toBe(true);
    expect(row('Main')).toBeUndefined(); // the layout does not match
    await type('/contacts');
    expect(pageNames()).toEqual(['Contacts']);
    await type('main');
    expect(pageNames()).toEqual([]);
    expect(row('Main')).toBeTruthy();
    await type('zzz');
    expect(sidebar().querySelector('.gjsp-empty')!.textContent).toBe('Nothing found');
    await type('blog');
    fire(search(), 'keydown', { key: 'Enter' });
    await until(() => s.api.getActiveId() === ID(3));
    fire(search(), 'keydown', { key: 'Escape' });
    await tick(5);
    expect(search().value).toBe('');
    expect(pageNames()).toEqual(['Home', '-About', '-Blog', 'Contacts']);
  });
});

describe('search in local mode', () => {
  it('filters the flat list', async () => {
    const s = await createEditor();
    editor = s.editor;
    await s.api.create({ name: 'Pricing' });
    await s.api.create({ name: 'Privacy' });
    await tick(10);
    await type('pri');
    expect([...sidebar().querySelectorAll('.gjsp-item .gjsp-name')].map((e) => e.textContent)).toEqual(['Pricing', 'Privacy']);
    await type('xyz');
    expect(sidebar().querySelector('.gjsp-empty')).toBeTruthy();
    expect(sidebar().querySelector('.gjsp-item [draggable]')).toBeNull();
  });
});
