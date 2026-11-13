import type { Editor } from 'grapesjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOC_PREFIX, type WorkspaceLike } from '../src/integration/workspace';
import grapesjs from 'grapesjs';
import pagesPlugin, { getPagesManager } from '../src/index';
import { MemoryPageStore } from '../src/store/MemoryPageStore';
import { createEditor, destroyEditor, SAMPLE_HTML, tick } from './helpers/editor';

let editor: Editor | undefined;
afterEach(async () => {
  await destroyEditor(editor);
  editor = undefined;
});

type Doc = Parameters<WorkspaceLike['open']>[0] & { dirty?: boolean };

/** A minimal stand-in for grapesjs-sidebar-tools' workspace. */
function fakeWorkspace(remembered: string[] = []) {
  const docs = new Map<string, Doc>();
  let active: string | null = null;
  const ws: WorkspaceLike & { docs: Map<string, Doc>; active(): string | null } = {
    docs,
    active: () => active,
    open: vi.fn((doc, o = {}) => {
      docs.set(doc.id, { ...docs.get(doc.id), ...doc });
      remembered = remembered.filter((id) => id !== doc.id);
      if (o.activate !== false) {
        active = doc.id;
        if (o.notify !== false) docs.get(doc.id)!.onActivate?.();
      }
    }),
    update: vi.fn((id, patch) => {
      const d = docs.get(id);
      if (d) Object.assign(d, patch);
    }),
    close: vi.fn((id) => {
      if (active === id) active = null;
      return docs.delete(id);
    }),
    has: (id) => docs.has(id),
    list: () => Array.from(docs.keys()).map((id) => ({ id })),
    remembered: (prefix) => remembered.filter((id) => id.startsWith(prefix)),
  };
  return ws;
}

async function setup(remembered: string[] = [], plugin = {}) {
  const s = await createEditor({ plugin });
  editor = s.editor;
  const ws = fakeWorkspace(remembered);
  // sidebar-tools announces its workspace once the editor loaded
  editor.trigger('sidebar-tools:ready', { workspace: ws });
  await tick(10);
  return { ...s, ws };
}

const titles = (ws: ReturnType<typeof fakeWorkspace>) => Array.from(ws.docs.values()).map((d) => d.title);

describe('workspace tabs (grapesjs-sidebar-tools)', () => {
  it('gives the open page a canvas tab without reloading it', async () => {
    const { api, ws } = await setup();
    const id = api.getActiveId()!;
    expect(id).toBeTruthy();
    expect(ws.active()).toBe(DOC_PREFIX + id);
    const doc = ws.docs.get(DOC_PREFIX + id)!;
    expect(doc.kind).toBe('canvas');
    expect(ws.open).toHaveBeenLastCalledWith(expect.objectContaining({ id: DOC_PREFIX + id }), { activate: true, notify: false });
  });

  it('one tab per opened page; a tab opens its page', async () => {
    const { api, ws } = await setup();
    const first = api.getActiveId()!;
    const second = await api.create({ name: 'Second' });
    await api.open(second.id);
    await tick(10);
    expect(ws.docs.size).toBe(2);
    expect(ws.active()).toBe(DOC_PREFIX + second.id);
    expect(titles(ws)).toContain('Second');

    ws.docs.get(DOC_PREFIX + first)!.onActivate!();
    await tick(20);
    expect(api.getActiveId()).toBe(first);
    // the open page already has its tab: no new one
    expect(ws.docs.size).toBe(2);
  });

  it('follows renames and closes tabs of deleted pages', async () => {
    const { api, ws } = await setup();
    const first = api.getActiveId()!;
    const second = await api.create({ name: 'Second' });
    await api.open(second.id);
    await api.rename(second.id, 'Renamed');
    await tick(20);
    expect(ws.docs.get(DOC_PREFIX + second.id)!.title).toBe('Renamed');

    await api.open(first);
    await api.remove(second.id, { confirm: false });
    await tick(20);
    expect(ws.has(DOC_PREFIX + second.id)).toBe(false);
    expect(ws.close).toHaveBeenCalledWith(DOC_PREFIX + second.id, { force: true, notify: false });
  });

  it('restores the tabs of the last session in the background', async () => {
    const s = await createEditor();
    editor = s.editor;
    const first = s.api.getActiveId()!;
    const other = await s.api.create({ name: 'Other' });
    await s.api.open(first);
    const ws = fakeWorkspace([DOC_PREFIX + other.id, `${DOC_PREFIX}gone`, 'blueprint:x']);
    editor.trigger('sidebar-tools:ready', { workspace: ws });
    await tick(20);
    expect(ws.has(DOC_PREFIX + other.id)).toBe(true);
    expect(ws.has(`${DOC_PREFIX}gone`)).toBe(false);
    expect(ws.active()).toBe(DOC_PREFIX + s.api.getActiveId());
    expect(ws.open).toHaveBeenCalledWith(expect.objectContaining({ id: DOC_PREFIX + other.id }), { activate: false, notify: false });
  });

  it('uses editor.SidebarTools.onReady when sidebar-tools came first', async () => {
    const ws = fakeWorkspace();
    const container = document.createElement('div');
    document.body.append(container);
    editor = grapesjs.init({
      container,
      height: '600px',
      storageManager: false,
      telemetry: false,
      components: SAMPLE_HTML,
      plugins: [
        (ed: any) => {
          const ready: Array<(w: WorkspaceLike) => void> = [];
          ed.SidebarTools = { workspace: null, onReady: (cb: (w: WorkspaceLike) => void) => ready.push(cb) };
          ed.on('load', () => ready.forEach((cb) => cb(ws)));
        },
        (ed: Editor) => pagesPlugin(ed, { settleMs: 0, store: new MemoryPageStore() }),
      ],
    } as Parameters<typeof grapesjs.init>[0]);
    const api = getPagesManager(editor)!;
    await api.whenReady();
    await tick(20);
    expect(ws.active()).toBe(DOC_PREFIX + api.getActiveId());
  });

  it('workspaceTabs: false keeps pages out of the workspace', async () => {
    const { ws } = await setup([], { workspaceTabs: false });
    expect(ws.open).not.toHaveBeenCalled();
  });
});
