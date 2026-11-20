import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('▦ / the command cover the editor with a frame per record; double click opens one; Esc goes back', async () => {
    const s = await createEditor();
    editor = s.editor;
    const [home] = await s.api.list();
    const other = await s.api.create({ name: 'Other' });
    await s.api.open(home.id);
    await settle(s.api);
    const rendering: string[] = [];
    editor.on(EVENTS.rendering, (req: any) => {
      rendering.push(req.record.id);
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
    expect(rendering).toEqual(expect.arrayContaining([home.id, other.id]));
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
    expect(opened[opened.length - 1]).toBe(other.id);
    expect(await s.store.getMeta('board')).toMatchObject({ view: expect.any(Object) });
  });

  it('a section can be hidden; moving a frame by its title keeps it there', async () => {
    const s = await createEditor();
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
