import { afterEach, describe, expect, it, vi } from 'vitest';
import grapesjs, { type Editor } from 'grapesjs';
import pagesPlugin, { COMMANDS, getPagesManager, PANEL_BUTTON_ID } from '../src/index';
import { MemoryPageStore } from '../src/store/MemoryPageStore';
import { click, createEditor, destroyEditor, html, names, rows, settle, sidebar, tick } from './helpers/editor';

let editor: Editor | undefined;
afterEach(async () => {
  await destroyEditor(editor);
  editor = undefined;
});

describe('UI mounting', () => {
  it('adds a button to the views panel and mounts the sidebar in the views container', async () => {
    const s = await createEditor();
    editor = s.editor;
    const views = editor.Panels.getPanel('views')!;
    expect(views.get('buttons')!.get(PANEL_BUTTON_ID)).toBeTruthy();
    const root = sidebar();
    expect(root.parentElement!.classList.contains('gjs-pn-views-container')).toBe(true);
    expect(root.classList.contains('gjsp-inline')).toBe(true);
    expect(root.hidden).toBe(true);
    expect(document.getElementById('gjsp-style')).toBeTruthy();
  });

  it('the open command shows the sidebar and deactivates the other views', async () => {
    const s = await createEditor();
    editor = s.editor;
    const btns = editor.Panels.getPanel('views')!.get('buttons')!;
    btns.get('open-sm')!.set('active', true);
    editor.runCommand(COMMANDS.open);
    expect(sidebar().hidden).toBe(false);
    expect(btns.get('open-sm')!.get('active')).toBe(false);
    // activating another view hides ours again
    btns.get(PANEL_BUTTON_ID)!.set('active', true);
    btns.get('open-layers')!.set('active', true);
    expect(btns.get(PANEL_BUTTON_ID)!.get('active')).toBe(false);
    expect(sidebar().hidden).toBe(true);
  });

  it('toggle command and the close button', async () => {
    const s = await createEditor();
    editor = s.editor;
    editor.runCommand(COMMANDS.toggle);
    expect(sidebar().hidden).toBe(false);
    editor.runCommand(COMMANDS.toggle);
    expect(sidebar().hidden).toBe(true);
    editor.runCommand(COMMANDS.toggle);
    click(sidebar().querySelector('.gjsp-head .gjsp-btn:last-child')!);
    expect(sidebar().hidden).toBe(true);
  });

  it('without any panels: floating sidebar + own toggle button', async () => {
    const s = await createEditor({ config: { panels: { defaults: [] } } });
    editor = s.editor;
    const root = sidebar();
    expect(root.classList.contains('gjsp-floating')).toBe(true);
    const toggle = document.querySelector<HTMLButtonElement>('.gjsp-toggle')!;
    expect(toggle).toBeTruthy();
    click(toggle);
    expect(root.hidden).toBe(false);
  });

  it('mounts into sidebarContainer when given', async () => {
    const host = document.createElement('div');
    host.className = 'my-right';
    document.body.append(host);
    const s = await createEditor({ plugin: { sidebarContainer: '.my-right' } });
    editor = s.editor;
    expect(sidebar().parentElement).toBe(host);
  });

  it('does not inject CSS with injectCss: false', async () => {
    const s = await createEditor({ plugin: { injectCss: false } });
    editor = s.editor;
    expect(document.getElementById('gjsp-style')).toBeNull();
  });
});

describe('page list', () => {
  it('lists pages, highlights the active one and opens on click', async () => {
    const s = await createEditor();
    editor = s.editor;
    const first = s.api.getActiveId()!;
    await s.api.create({ name: 'About' });
    await tick();
    expect(names()).toEqual(['Page 1', 'About']);
    expect(rows()[1].classList.contains('is-active')).toBe(true);
    click(rows()[0]);
    await settle(s.api);
    expect(s.api.getActiveId()).toBe(first);
    await tick();
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
  });

  it('Enter on a focused row opens the page', async () => {
    const s = await createEditor();
    editor = s.editor;
    const first = s.api.getActiveId()!;
    await s.api.create({ name: 'B' });
    await tick();
    rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle(s.api);
    expect(s.api.getActiveId()).toBe(first);
  });

  it('"+" creates a page', async () => {
    const s = await createEditor();
    editor = s.editor;
    click(sidebar().querySelectorAll('.gjsp-head .gjsp-btn')[2]);
    await settle(s.api);
    await tick();
    expect(names()).toEqual(['Page 1', 'Page 2']);
  });

  it('rename asks with prompt, delete asks with confirm', async () => {
    const s = await createEditor();
    editor = s.editor;
    await s.api.create({ name: 'B' });
    await tick();
    vi.spyOn(window, 'prompt').mockReturnValue('Contacts');
    click(rows()[1].querySelectorAll('.gjsp-act')[0]);
    await settle(s.api);
    await tick();
    expect(names()).toEqual(['Page 1', 'Contacts']);
    expect(window.prompt).toHaveBeenCalledWith('Page name', 'B');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    click(rows()[1].querySelectorAll('.gjsp-act')[2]);
    await settle(s.api);
    expect(confirm).toHaveBeenCalledWith('Delete page “Contacts”?');
    expect(names()).toHaveLength(2);
    confirm.mockReturnValue(true);
    click(rows()[1].querySelectorAll('.gjsp-act')[2]);
    await settle(s.api);
    await tick();
    expect(names()).toEqual(['Page 1']);
  });

  it('duplicate button', async () => {
    const s = await createEditor();
    editor = s.editor;
    click(rows()[0].querySelectorAll('.gjsp-act')[1]);
    await settle(s.api);
    await tick();
    expect(names()).toEqual(['Page 1', 'Page 1 (copy)']);
  });

  it('a row click on an action button does not also open the page', async () => {
    const s = await createEditor();
    editor = s.editor;
    const first = s.api.getActiveId()!;
    const b = await s.api.create({ name: 'B' });
    await tick();
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    click(rows()[0].querySelectorAll('.gjsp-act')[0]);
    await settle(s.api);
    expect(s.api.getActiveId()).toBe(b.id);
    expect(first).not.toBe(b.id);
  });

  it('undo/redo buttons follow the history', async () => {
    const s = await createEditor();
    editor = s.editor;
    const [undo, redo] = [...sidebar().querySelectorAll<HTMLButtonElement>('.gjsp-head .gjsp-btn')];
    expect(undo.disabled).toBe(true);
    editor.getWrapper()!.append('<p>x</p>');
    await settle(s.api);
    expect(undo.disabled).toBe(false);
    click(undo);
    await settle(s.api);
    expect(redo.disabled).toBe(false);
    expect(html(editor)).not.toContain('<p>x</p>');
  });

  it('status shows the server and per-page sync state', async () => {
    const s = await createEditor();
    editor = s.editor;
    const status = sidebar().querySelector('.gjsp-status')!;
    expect(status.textContent).toBe('No server configured');
    expect(sidebar().classList.contains('has-server')).toBe(false);
    await s.api.setSettings({ url: 'https://srv.test/api' });
    await tick();
    expect(status.textContent).toBe('Server: https://srv.test/api');
    expect(sidebar().classList.contains('has-server')).toBe(true);
    expect(rows()[0].querySelector('.gjsp-sub')!.textContent).toContain('local only');
  });

  it('copy/paste flash a message in the status line', async () => {
    const s = await createEditor();
    editor = s.editor;
    editor.select(editor.getWrapper()!.find('#title')[0]);
    s.api.copy();
    expect(sidebar().querySelector('.gjsp-status')!.textContent).toBe('Components copied: 1');
  });

  it('labels option overrides texts', async () => {
    const s = await createEditor({ plugin: { labels: { pages: 'Site map', defaultName: 'Screen' } } });
    editor = s.editor;
    expect(sidebar().querySelector('.gjsp-title')!.textContent).toBe('Site map');
    expect(names()).toEqual(['Screen 1']);
  });
});

describe('keymaps & commands', () => {
  it('registers the keymaps (and replaces core copy/paste)', async () => {
    const s = await createEditor();
    editor = s.editor;
    const km = editor.Keymaps;
    expect(km.get('core:copy')).toBeUndefined();
    expect(km.get('core:paste')).toBeUndefined();
    expect(km.get(COMMANDS.copy)!.keys).toBe('ctrl+c, ⌘+c');
    expect(km.get('core:undo')!.keys).toBe('ctrl+z, ⌘+z');
  });

  it('keeps core copy/paste with takeOverCopyPaste: false', async () => {
    const s = await createEditor({ plugin: { takeOverCopyPaste: false } });
    editor = s.editor;
    expect(editor.Keymaps.get('core:copy')).toBeTruthy();
    expect(editor.Keymaps.get(COMMANDS.copy)).toBeUndefined();
  });

  it('copy/paste commands', async () => {
    const s = await createEditor();
    editor = s.editor;
    editor.select(editor.getWrapper()!.find('#title')[0]);
    editor.runCommand(COMMANDS.copy);
    await s.api.create();
    editor.runCommand(COMMANDS.paste);
    expect(html(editor)).toContain('Hello');
  });
});

describe('lifecycle', () => {
  it('works when applied to an already running editor', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    editor = grapesjs.init({ container, storageManager: false, telemetry: false, components: '<p>late</p>' } as any);
    await new Promise<void>((r) => editor!.onReady(() => r()));
    pagesPlugin(editor, { store: new MemoryPageStore(), settleMs: 0 });
    await getPagesManager(editor)!.whenReady();
    expect((await getPagesManager(editor)!.list())[0].name).toBe('Page 1');
  });

  it('applying twice keeps a single sidebar', async () => {
    const store = new MemoryPageStore();
    const s = await createEditor({ plugin: { store } });
    editor = s.editor;
    pagesPlugin(editor, { store, settleMs: 0 });
    await getPagesManager(editor)!.whenReady();
    await tick();
    expect(document.querySelectorAll('.gjsp')).toHaveLength(1);
  });

  it('destroy leaves no running autosave / errors', async () => {
    const s = await createEditor();
    const errors = vi.spyOn(console, 'error');
    s.editor.getWrapper()!.append('<p>x</p>');
    await destroyEditor(s.editor);
    await tick(30);
    window.dispatchEvent(new Event('beforeunload'));
    await tick(10);
    expect(errors).not.toHaveBeenCalled();
  });

  it('the editor content of the first run is not lost when the store is empty', async () => {
    const s = await createEditor({ html: '<p>initial content</p>' });
    editor = s.editor;
    expect(JSON.stringify((await s.api.list())[0].data)).toContain('initial content');
  });
});

describe('keyboard (real keymaster events)', () => {
  const press = (key: string, code: number, mods: KeyboardEventInit = {}) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode: code, which: code, bubbles: true, cancelable: true, ...mods } as any));
    document.dispatchEvent(new KeyboardEvent('keyup', { key, keyCode: code, which: code, bubbles: true, cancelable: true, ...mods } as any));
  };

  it('Ctrl+C / Ctrl+V paste exactly once (core paste is not active)', async () => {
    const s = await createEditor({ html: '<div id="a">A</div>', css: '' });
    editor = s.editor;
    editor.select(editor.getWrapper()!.find('#a')[0]);
    press('Control', 17, { ctrlKey: true });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', keyCode: 67, ctrlKey: true, bubbles: true } as any));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', keyCode: 86, ctrlKey: true, bubbles: true } as any));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', keyCode: 17, bubbles: true } as any));
    expect(editor.getWrapper()!.components().length).toBe(2);
  });
});

describe('view switching', () => {
  it('opening from code highlights the button and is closed by another view', async () => {
    const s = await createEditor();
    editor = s.editor;
    const btns = editor.Panels.getPanel('views')!.get('buttons')!;
    editor.runCommand(COMMANDS.open);
    expect(btns.get(PANEL_BUTTON_ID)!.get('active')).toBe(true);
    expect(sidebar().hidden).toBe(false);
    // what preset-webpage does on component select
    btns.get('open-sm')!.set('active', true);
    expect(sidebar().hidden).toBe(true);
    expect(btns.get(PANEL_BUTTON_ID)!.get('active')).toBe(false);
  });
});
