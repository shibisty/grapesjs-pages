import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'grapesjs';
import { BLOCK_PREFIX } from '../src/components/ComponentsFeature';
import { EVENTS } from '../src/events';
import type { PageRecord, RecordAction } from '../src/types';
import { createEditor, destroyEditor, rows, sidebar, tick, type Setup } from './helpers/editor';

type Json = Record<string, any>;
const kids = (d: any): Json[] => d.pages[0].frames[0].component.components || [];

let s: Setup | null = null;
afterEach(async () => {
  if (s) await destroyEditor(s.editor);
  s = null;
  document.body.innerHTML = '';
});

const source = {
  id: 'bp',
  label: 'Blueprints',
  list: () => [
    { id: 'card', name: 'Card' },
    { id: 'hero', name: 'Hero' },
  ],
  build: (id: string): Json => ({ tagName: 'section', attributes: { 'data-from': id }, components: [{ type: 'text', components: id }] }),
};

describe('component sources', () => {
  it('creates a component from a source item, opened, as a block', async () => {
    s = await createEditor();
    const home = s.api.getActiveId()!;
    const off = s.api.components.addSource(source);
    expect(s.api.components.sources().map((x) => x.id)).toEqual(['bp']);
    const rec = await s.api.components.create('My card', { source: 'bp', item: 'card' });
    expect(rec.kind).toBe('component');
    expect(rec.name).toBe('My card');
    expect(s.api.getActiveId()).toBe(rec.id);
    const html = s.editor.getHtml();
    expect(html).toContain('data-from="card"');
    expect(s.api.components.list().map((m) => m.name)).toEqual(['My card']);
    const hasBlock = (): boolean => (s!.editor.Blocks.getAll() as any).models.some((b: any) => b.id === `${BLOCK_PREFIX}${rec.id}`);
    expect(hasBlock()).toBe(false); // open: it can't contain itself
    await s.api.open(home);
    expect(hasBlock()).toBe(true);
    off();
    expect(s.api.components.sources()).toEqual([]);
  });

  it('creates an empty component without opening it; unknown source throws', async () => {
    s = await createEditor();
    const home = s.api.getActiveId();
    const rec = await s.api.components.create('', null, { open: false });
    expect(rec.name).toMatch(/Component 1/);
    expect(s.api.getActiveId()).toBe(home);
    const data = await s.store.get(rec.id);
    expect(kids(data!.data)).toEqual([]);
    await expect(s.api.components.create('x', { source: 'nope', item: 'a' })).rejects.toThrow(/nope/);
  });

  it('replaces a source registered again under the same id', async () => {
    s = await createEditor();
    s.api.components.addSource(source);
    s.api.components.addSource({ ...source, label: 'Other' });
    expect(s.api.components.sources().map((x) => x.label)).toEqual(['Other']);
  });

  it('asks what a new component starts from when sources have items', async () => {
    s = await createEditor();
    s.api.components.addSource(source);
    s.editor.runCommand('pages-manager:open');
    await tick();
    sidebar().querySelector<HTMLButtonElement>('[data-create="component"]')!.click();
    await tick(5);
    const modal = document.querySelector('.gjsp-component-from')!;
    expect(modal).toBeTruthy();
    const sel = modal.querySelector<HTMLSelectElement>('select[name="from"]')!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Empty', 'Card', 'Hero']);
    sel.value = sel.options[2].value;
    sel.dispatchEvent(new Event('change'));
    expect(modal.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe('Hero');
    modal.querySelector<HTMLButtonElement>('[data-role="create"]')!.click();
    for (let i = 0; i < 20 && !s.api.components.list().length; i++) await tick(10);
    expect(s.api.components.list().map((m) => m.name)).toEqual(['Hero']);
    expect(s.editor.getHtml()).toContain('data-from="hero"');
  });
});

describe('record actions', () => {
  it('adds buttons other plugins push for a record', async () => {
    const run = vi.fn();
    const plugin = (ed: Editor): void => {
      ed.on(EVENTS.recordActions, ({ record, actions }: { record: PageRecord; actions: RecordAction[] }) => {
        if ((record.kind || 'page') === 'page') actions.push({ id: 'scripts', label: 'Scripts & styles', icon: '{}', run });
        actions.push({ id: 'broken', label: '', run }); // no label: ignored
      });
    };
    s = await createEditor({ extraPlugins: [plugin] });
    s.editor.runCommand('pages-manager:open');
    await s.api.create({ name: 'Second' });
    await tick(20);
    const row = rows().find((r) => r.dataset.id === s!.api.getActiveId())!;
    const b = row.querySelector<HTMLButtonElement>('[data-action="scripts"]')!;
    expect(b).toBeTruthy();
    expect(b.title).toBe('Scripts & styles');
    expect(row.querySelector('[data-action="broken"]')).toBeNull();
    b.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].id).toBe(row.dataset.id);
    // the click doesn't open the page (stops propagation like the other actions)
  });

  it('a throwing listener does not break the sidebar', async () => {
    const plugin = (ed: Editor): void => {
      ed.on(EVENTS.recordActions, () => {
        throw new Error('boom');
      });
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    s = await createEditor({ extraPlugins: [plugin] });
    s.editor.runCommand('pages-manager:open');
    await s.api.create({ name: 'Second' });
    await tick(20);
    expect(rows().length).toBeGreaterThanOrEqual(2);
    err.mockRestore();
  });
});
