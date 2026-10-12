import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from 'grapesjs';
import { EVENTS } from '../src/events';
import { createEditor, destroyEditor, html, settle, tick } from './helpers/editor';

let editor: Editor | undefined;
afterEach(async () => {
  await destroyEditor(editor);
  editor = undefined;
});

describe('start', () => {
  it('saves the initial editor content as "Page 1" on an empty store', async () => {
    const s = await createEditor();
    editor = s.editor;
    const list = await s.api.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Page 1');
    expect(s.api.getActiveId()).toBe(list[0].id);
    expect(JSON.stringify(list[0].data)).toContain('Hello');
    expect(await s.store.getMeta('active')).toBe(list[0].id);
  });

  it('reopens the last active page from the store', async () => {
    const a = await createEditor();
    const second = await a.api.create({ name: 'Second' });
    a.editor.getWrapper()!.append('<p>second page text</p>');
    await settle(a.api);
    await destroyEditor(a.editor);

    const b = await createEditor({ plugin: { store: a.store }, html: '<p>ignored</p>' });
    editor = b.editor;
    expect(b.api.getActiveId()).toBe(second.id);
    expect(html(b.editor)).toContain('second page text');
    expect(html(b.editor)).not.toContain('ignored');
  });

  it('fires ready once the active page is loaded', async () => {
    const s = await createEditor({ noWait: true });
    editor = s.editor;
    let fired = 0;
    s.editor.on(EVENTS.ready, () => fired++);
    await s.api.whenReady();
    await tick();
    expect(fired).toBe(1);
  });
});

describe('CRUD', () => {
  it('create opens a blank page with the next free name', async () => {
    const s = await createEditor();
    editor = s.editor;
    const rec = await s.api.create();
    expect(rec.name).toBe('Page 2');
    expect(s.api.getActiveId()).toBe(rec.id);
    expect(html(s.editor)).not.toContain('Hello');
    await s.api.rename(rec.id, 'Page 3');
    expect((await s.api.create()).name).toBe('Page 4');
  });

  it('create uses the `blank` option', async () => {
    const s = await createEditor({
      plugin: {
        blank: () =>
          ({ pages: [{ frames: [{ component: { type: 'wrapper', components: '<p>template</p>' } }] }] }) as any,
      },
    });
    editor = s.editor;
    await s.api.create();
    expect(html(s.editor)).toContain('template');
  });

  it('switching pages swaps the canvas content and keeps unsaved edits', async () => {
    const s = await createEditor();
    editor = s.editor;
    const first = s.api.getActiveId()!;
    const second = await s.api.create({ name: 'B' });
    s.editor.getWrapper()!.append('<p>on B</p>');
    // no settle: open() must flush the pending autosave itself
    await s.api.open(first);
    expect(html(s.editor)).toContain('Hello');
    expect(html(s.editor)).not.toContain('on B');
    await s.api.open(second.id);
    expect(html(s.editor)).toContain('on B');
  });

  it('autosave writes edits to the store and marks the page dirty', async () => {
    const s = await createEditor();
    editor = s.editor;
    const id = s.api.getActiveId()!;
    const rec0 = await s.store.get(id);
    await s.store.put({ ...rec0!, dirty: false });
    s.editor.getWrapper()!.append('<p>autosaved</p>');
    await settle(s.api);
    const rec = await s.store.get(id);
    expect(JSON.stringify(rec!.data)).toContain('autosaved');
    expect(rec!.dirty).toBe(true);
  });

  it('rename trims, ignores empty and unchanged names', async () => {
    const s = await createEditor();
    editor = s.editor;
    const id = s.api.getActiveId()!;
    await s.api.rename(id, '  Home  ');
    expect((await s.store.get(id))!.name).toBe('Home');
    await s.api.rename(id, '   ');
    expect((await s.store.get(id))!.name).toBe('Home');
  });

  it('duplicate copies the content under "<name> (copy)"', async () => {
    const s = await createEditor();
    editor = s.editor;
    const dup = await s.api.duplicate(s.api.getActiveId()!);
    expect(dup!.name).toBe('Page 1 (copy)');
    expect(s.api.getActiveId()).toBe(dup!.id);
    expect(html(s.editor)).toContain('Hello');
  });

  it('remove deletes a never-synced page and opens the first remaining one', async () => {
    const s = await createEditor();
    editor = s.editor;
    const first = s.api.getActiveId()!;
    const b = await s.api.create({ name: 'B' });
    await s.api.remove(b.id, { confirm: false });
    expect(await s.store.get(b.id)).toBeUndefined();
    expect(s.api.getActiveId()).toBe(first);
    expect(html(s.editor)).toContain('Hello');
  });

  it('remove of a synced page leaves a tombstone hidden from the list', async () => {
    const s = await createEditor();
    editor = s.editor;
    const b = await s.api.create({ name: 'B' });
    const rec = await s.store.get(b.id);
    await s.store.put({ ...rec!, remote: { version: 3 } });
    await s.api.remove(b.id, { confirm: false });
    const tomb = await s.store.get(b.id);
    expect(tomb!.deleted).toBe(true);
    expect((await s.api.list()).map((r) => r.id)).not.toContain(b.id);
  });

  it('removing the last page creates a new blank one', async () => {
    const s = await createEditor();
    editor = s.editor;
    const only = s.api.getActiveId()!;
    await s.api.remove(only, { confirm: false });
    const list = await s.api.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).not.toBe(only);
    expect(s.api.getActiveId()).toBe(list[0].id);
  });

  it('remove drops a pending edit of the removed active page', async () => {
    const s = await createEditor();
    editor = s.editor;
    const b = await s.api.create({ name: 'B' });
    s.editor.getWrapper()!.append('<p>pending</p>');
    await s.api.remove(b.id, { confirm: false });
    await settle(s.api);
    const all = await s.store.all();
    expect(JSON.stringify(all)).not.toContain('pending');
  });
});

describe('undo / redo', () => {
  it('walks the snapshot history of the active page', async () => {
    const s = await createEditor();
    editor = s.editor;
    expect(s.api.canUndo()).toBe(false);
    s.editor.getWrapper()!.append('<p>one</p>');
    await settle(s.api);
    s.editor.getWrapper()!.append('<p>two</p>');
    await settle(s.api);
    expect(s.api.canUndo()).toBe(true);

    expect(await s.api.undo()).toBe(true);
    expect(html(s.editor)).toContain('one');
    expect(html(s.editor)).not.toContain('two');
    expect(await s.api.undo()).toBe(true);
    expect(html(s.editor)).not.toContain('one');
    expect(await s.api.undo()).toBe(false);

    expect(await s.api.redo()).toBe(true);
    expect(html(s.editor)).toContain('one');
    expect(s.api.canRedo()).toBe(true);
    // the store follows the undo
    const rec = await s.store.get(s.api.getActiveId()!);
    expect(JSON.stringify(rec!.data)).toContain('one');
    expect(JSON.stringify(rec!.data)).not.toContain('two');
  });

  it('a new edit after undo drops the redo branch', async () => {
    const s = await createEditor();
    editor = s.editor;
    s.editor.getWrapper()!.append('<p>one</p>');
    await settle(s.api);
    await s.api.undo();
    s.editor.getWrapper()!.append('<p>other</p>');
    await settle(s.api);
    expect(s.api.canRedo()).toBe(false);
  });

  it('keeps a separate history per page', async () => {
    const s = await createEditor();
    editor = s.editor;
    const first = s.api.getActiveId()!;
    s.editor.getWrapper()!.append('<p>A1</p>');
    await settle(s.api);
    const b = await s.api.create({ name: 'B' });
    expect(s.api.canUndo()).toBe(false);
    s.editor.getWrapper()!.append('<p>B1</p>');
    await settle(s.api);
    await s.api.open(first);
    expect(s.api.canUndo()).toBe(true);
    await s.api.undo();
    expect(html(s.editor)).not.toContain('A1');
    await s.api.open(b.id);
    expect(html(s.editor)).toContain('B1');
  });

  it('loading a page is not recorded as an edit', async () => {
    const s = await createEditor({ plugin: { settleMs: 30 } });
    editor = s.editor;
    const first = s.api.getActiveId()!;
    await s.api.create({ name: 'B' });
    await s.api.open(first);
    await settle(s.api);
    expect(s.api.canUndo()).toBe(false);
  });

  it('respects historyLimit', async () => {
    const s = await createEditor({ plugin: { historyLimit: 2 } });
    editor = s.editor;
    for (const t of ['a', 'b', 'c']) {
      s.editor.getWrapper()!.append(`<p>${t}</p>`);
      await settle(s.api);
    }
    expect(await s.api.undo()).toBe(true);
    expect(await s.api.undo()).toBe(false);
  });

  it('core:undo / core:redo commands use the page history', async () => {
    const s = await createEditor();
    editor = s.editor;
    s.editor.getWrapper()!.append('<p>cmd</p>');
    await settle(s.api);
    s.editor.runCommand('core:undo');
    await tick(20);
    await s.api.flush();
    expect(html(s.editor)).not.toContain('cmd');
  });
});
