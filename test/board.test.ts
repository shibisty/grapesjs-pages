import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'grapesjs';
import { autoLayout, fitView, visibleFrames, zoomAt, bounds } from '../src/board/layout';
import { EVENTS } from '../src/events';
import { createEditor, destroyEditor, settle } from './helpers/editor';

let editor: Editor | undefined;
afterEach(async () => {
  await destroyEditor(editor);
  editor = undefined;
});

describe('board layout', () => {
  it('sections one under another, frames in rows; measured heights and moved frames', () => {
    const items = [
      { id: 'a', name: 'A', section: 'page' as const },
      { id: 'b', name: 'B', section: 'page' as const },
      { id: 'c', name: 'C', section: 'page' as const },
      { id: 't', name: 'T', section: 'template' as const },
    ];
    const { frames, sections } = autoLayout(items, { width: 100, height: 50, gap: 10, perRow: 2, title: 20, heights: { a: 80 }, placed: { c: { x: 500, y: 7 } } });
    expect(sections.map((s) => [s.section, s.y])).toEqual([
      ['page', 0],
      ['template', 120],
    ]);
    const at = (id: string) => frames.find((f) => f.id === id)!;
    expect(at('a')).toMatchObject({ x: 0, y: 20, w: 100, h: 80 });
    expect(at('b')).toMatchObject({ x: 110, y: 20, h: 50 });
    expect(at('c')).toMatchObject({ x: 500, y: 7 }); // the user moved it
    expect(at('t')).toMatchObject({ x: 0, y: 140 });
  });

  it('what is in view, fit, zoom at a point', () => {
    const frames = [
      { id: 'a', section: 'page' as const, x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', section: 'page' as const, x: 5000, y: 0, w: 100, h: 100 },
    ];
    const size = { w: 400, h: 300 };
    expect(visibleFrames(frames, { x: 0, y: 0, zoom: 1 }, size, 0).map((f) => f.id)).toEqual(['a']);
    const fit = fitView(bounds(frames), size, 0, 1);
    expect(visibleFrames(frames, fit, size, 0).map((f) => f.id)).toEqual(['a', 'b']);
    const z = zoomAt({ x: 0, y: 0, zoom: 1 }, 2, 100, 100);
    expect(z).toEqual({ zoom: 2, x: 50, y: 50 }); // the point under the pointer stays
  });
});

describe('the board', () => {
  it('▦ / the command cover the editor with a frame per record; double click opens one; Esc goes back (boardLive: false)', async () => {
    const s = await createEditor({ plugin: { boardLive: false } });
    editor = s.editor;
    const [home] = await s.api.list();
    const other = await s.api.create({ name: 'Other' });
    await s.api.open(home.id);
    await settle(s.api);
    const rendering: string[] = [];
    const flags: Record<string, string> = {};
    editor.on(EVENTS.rendering, (req: any) => {
      rendering.push(req.record.id);
      flags[req.record.id] = `${!!req.placeholders}|${!!req.inPlace}`;
      req.waitFor(new Promise((r) => setTimeout(r, 5)));
    });
    const opened: string[] = [];
    editor.on(EVENTS.open, (rec: any) => opened.push(rec.id));
    editor.runCommand('pages-manager:board');
    const board = () => editor!.getContainer()!.querySelector<HTMLElement>('.gjsp-board');
    await vi.waitFor(() => expect(board()!.querySelectorAll('.gjsp-board__frame').length).toBe(2), { timeout: 5000, interval: 20 });
    const frame = (id: string) => board()!.querySelector<HTMLElement>(`.gjsp-board__frame[data-id="${id}"]`)!;
    expect(frame(home.id).classList.contains('is-current')).toBe(true);
    expect(frame(other.id).querySelector('.gjsp-board__name')!.textContent).toBe('Other');
    // the frames in view are rendered (the plugins load their data first)
    await vi.waitFor(() => expect(frame(other.id).querySelector('iframe')).toBeTruthy(), { timeout: 5000, interval: 20 });
    // templates: placeholders; the page in the canvas is taken in place
    expect(flags).toEqual({ [home.id]: 'true|true', [other.id]: 'true|false' });
    const doc = frame(home.id).querySelector('iframe')!.getAttribute('srcdoc')!;
    expect(doc).toContain('Hello');
    expect(doc).toContain('#title{color:red;}');
    expect(opened).toEqual([]); // rendering opened them silently
    // Esc: back to the page the editor was on
    board()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(board()).toBeNull();
    await vi.waitFor(() => expect(s.api.getActiveId()).toBe(home.id), { timeout: 5000, interval: 20 });
    // again: the view is kept; double click opens a page in the editor
    editor.runCommand('pages-manager:board');
    await vi.waitFor(() => expect(frame(other.id)).toBeTruthy(), { timeout: 5000, interval: 20 });
    frame(other.id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(board()).toBeNull();
    await vi.waitFor(() => expect(s.api.getActiveId()).toBe(other.id), { timeout: 5000, interval: 20 });
    // open() takes the id at once and emits after the page has loaded
    await vi.waitFor(() => expect(opened[opened.length - 1]).toBe(other.id), { timeout: 5000, interval: 20 });
    expect(await s.store.getMeta('board')).toMatchObject({ view: expect.any(Object) });
  });

  it('a section can be hidden; moving a frame by its title keeps it there', async () => {
    const s = await createEditor({ plugin: { boardLive: false } });
    editor = s.editor;
    const [home] = await s.api.list();
    await settle(s.api);
    editor.runCommand('pages-manager:board');
    const root = () => editor!.getContainer()!.querySelector<HTMLElement>('.gjsp-board')!;
    await vi.waitFor(() => expect(root().querySelector(`.gjsp-board__frame[data-id="${home.id}"]`)).toBeTruthy(), { timeout: 5000, interval: 20 });
    const label = root().querySelector<HTMLElement>(`.gjsp-board__frame[data-id="${home.id}"] .gjsp-board__label`)!;
    const vp = root().querySelector<HTMLElement>('.gjsp-board__vp')!;
    const pe = (type: string, x: number, y: number, target: EventTarget) =>
      target.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }), { pointerId: 1 }));
    pe('pointerdown', 10, 10, label);
    pe('pointermove', 110, 60, vp);
    pe('pointerup', 110, 60, vp);
    await vi.waitFor(async () => expect(((await s.store.getMeta('board')) as any)?.placed?.[home.id]).toBeTruthy(), { timeout: 5000, interval: 20 });
    const chip = root().querySelector<HTMLButtonElement>('.gjsp-board__chip[data-section="page"]')!;
    chip.click();
    await vi.waitFor(() => expect(root().querySelectorAll('.gjsp-board__frame').length).toBe(0), { timeout: 5000, interval: 20 });
    editor.runCommand('pages-manager:board'); // toggles
    expect(editor.getContainer()!.querySelector('.gjsp-board')).toBeNull();
  });
});

describe('the live board', () => {
  // GrapesJS sizes an auto-height frame with a ResizeObserver; jsdom has none.
  const RO = (globalThis as any).ResizeObserver;
  beforeAll(() => {
    if (!RO) (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  });
  afterAll(() => {
    if (!RO) delete (globalThis as any).ResizeObserver;
  });

  it('the canvas is the board: a click on a frame edits that page there; devices above every frame; Esc keeps the page', async () => {
    const s = await createEditor();
    editor = s.editor;
    const [home] = await s.api.list();
    const other = await s.api.create({ name: 'Other' });
    await s.api.open(home.id);
    await settle(s.api);
    const cv = editor.Canvas.getElement() as HTMLElement;
    editor.runCommand('pages-manager:board');
    const root = () => cv.querySelector<HTMLElement>('.gjsp-board--live');
    const frame = (id: string) => root()!.querySelector<HTMLElement>(`.gjsp-board__frame[data-id="${id}"]`)!;
    await vi.waitFor(() => expect(root()!.querySelectorAll('.gjsp-board__frame').length).toBe(2), { timeout: 5000, interval: 20 });
    expect(cv.classList.contains('gjsp-board-live')).toBe(true);
    expect(frame(home.id).classList.contains('is-live')).toBe(true);
    // the panels stay: the board is inside the canvas only
    expect(editor.getContainer()!.querySelector('.gjsp-board:not(.gjsp-board--live)')).toBeNull();
    // the canvas frame takes the board's width; GrapesJS's zoom follows the board
    const fm: any = (editor as any).getModel().getCurrentFrameModel();
    expect(fm.get('width')).toBe('1280px');
    expect(fm.get('height')).toBe('auto');
    expect(editor.Canvas.getZoom()).toBeLessThan(100);
    // click another frame: it is opened in the canvas, the board stays
    const opened: string[] = [];
    editor.on(EVENTS.open, (rec: any) => opened.push(rec.id));
    const body = frame(other.id).querySelector('.gjsp-board__body')!;
    body.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 5, clientY: 5 }), { pointerId: 1 }));
    await vi.waitFor(() => expect(opened).toContain(other.id), { timeout: 5000, interval: 20 });
    expect(s.api.getActiveId()).toBe(other.id);
    expect(root()).toBeTruthy();
    await vi.waitFor(() => expect(frame(other.id).classList.contains('is-live')).toBe(true), { timeout: 5000, interval: 20 });
    // devices above the frame: the mobile one switches the editor's device too
    const devs = [...frame(other.id).querySelectorAll<HTMLButtonElement>('[data-device]')];
    expect(devs.length).toBeGreaterThan(1);
    const mobile = devs[devs.length - 1];
    mobile.click();
    expect(mobile.classList.contains('is-on')).toBe(true);
    await vi.waitFor(() => expect(String((editor as any).getDevice())).toBe(mobile.dataset.device), { timeout: 5000, interval: 20 });
    const w = parseInt(String((editor as any).getModel().getCurrentFrameModel().get('width')), 10);
    expect(w).toBeLessThan(1280);
    await vi.waitFor(() => expect(parseInt(frame(other.id).style.width, 10)).toBe(w), { timeout: 5000, interval: 20 });
    // Esc: the board goes, the page edited stays, the canvas is as it was
    root()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root()).toBeNull();
    await vi.waitFor(() => expect(cv.classList.contains('gjsp-board-live')).toBe(false), { timeout: 5000, interval: 20 });
    expect(s.api.getActiveId()).toBe(other.id);
    expect(editor.Canvas.getZoom()).toBe(100);
    expect((await s.store.getMeta<any>('board'))?.devices?.[other.id]).toBe(mobile.dataset.device);
    await new Promise((r) => setTimeout(r, 350)); // GrapesJS's own timer after setZoom
  });

  it('with the sidebar-tools workspace the board is a tab: shown — the board; another canvas tab — the page', async () => {
    const docs = new Map<string, any>();
    let shown = '';
    let host: Editor | undefined;
    const ws = {
      open(doc: any, o: any = {}) {
        docs.set(doc.id, { ...doc, kind: doc.kind || 'element' });
        if (o.activate !== false) this.activate(doc.id, { notify: o.notify });
      },
      activate(id: string, o: any = {}) {
        shown = id;
        if (o.notify !== false) docs.get(id)?.onActivate?.();
        host?.trigger('sidebar-tools:workspace', { type: 'activate', id });
      },
      update() {},
      close(id: string) {
        docs.get(id)?.onClosed?.();
        return docs.delete(id);
      },
      has: (id: string) => docs.has(id),
      list: () => [...docs.values()].map((d) => ({ id: d.id, kind: d.kind, active: d.id === shown })),
      remembered: () => [],
    };
    const s = await createEditor({
      extraPlugins: [
        (ed) => {
          host = ed;
          (ed as any).SidebarTools = { workspace: ws, onReady: (cb: any) => cb(ws) };
          ed.trigger('sidebar-tools:ready', { workspace: ws });
        },
      ],
    });
    editor = s.editor;
    const [home] = await s.api.list();
    const other = await s.api.create({ name: 'Other' });
    await s.api.open(home.id);
    await settle(s.api);
    expect(shown).toBe(`page:${home.id}`);
    const cv = editor.Canvas.getElement() as HTMLElement;
    editor.runCommand('pages-manager:board');
    expect(shown).toBe('pages:board');
    expect(cv.querySelector('.gjsp-board--live')).toBeTruthy();
    // a page edited on the board gets its tab, the board stays shown
    await vi.waitFor(() => expect(cv.querySelector(`.gjsp-board__frame[data-id="${other.id}"]`)).toBeTruthy(), { timeout: 5000, interval: 20 });
    cv.querySelector(`.gjsp-board__frame[data-id="${other.id}"] .gjsp-board__body`)!.dispatchEvent(
      Object.assign(new MouseEvent('pointerdown', { bubbles: true, button: 0 }), { pointerId: 1 })
    );
    await vi.waitFor(() => expect(docs.has(`page:${other.id}`)).toBe(true), { timeout: 5000, interval: 20 });
    expect(shown).toBe('pages:board');
    // another canvas tab shown: the board goes, the canvas is a canvas again
    ws.activate(`page:${home.id}`);
    expect(cv.querySelector('.gjsp-board--live')).toBeNull();
    await vi.waitFor(() => expect(cv.classList.contains('gjsp-board-live')).toBe(false), { timeout: 5000, interval: 20 });
    // the board tab again, then ✕ of the board: back to the tab of the page edited
    ws.activate('pages:board');
    expect(cv.querySelector('.gjsp-board--live')).toBeTruthy();
    cv.querySelector<HTMLButtonElement>('.gjsp-board__btn[data-role="close"]')!.click();
    expect(cv.querySelector('.gjsp-board--live')).toBeNull();
    await vi.waitFor(() => expect(shown).toBe(`page:${s.api.getActiveId()}`), { timeout: 5000, interval: 20 });
    expect(docs.has('pages:board')).toBe(true); // the tab stays
    await new Promise((r) => setTimeout(r, 350)); // GrapesJS's own timer after setZoom
  });
});
