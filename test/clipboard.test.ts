import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from 'grapesjs';
import { remapIds, serializeComponent, topLevel } from '../src/clipboard/ComponentClipboard';
import { EVENTS } from '../src/events';
import { createEditor, destroyEditor, html, settle } from './helpers/editor';

let editor: Editor | undefined;
afterEach(async () => {
  await destroyEditor(editor);
  editor = undefined;
});

const find = (ed: Editor, sel: string) => ed.getWrapper()!.find(sel)[0];

describe('remapIds', () => {
  it('gives every id a new value and rewrites only exact #id selectors', () => {
    const json: any = { attributes: { id: 'a' }, components: [{ attributes: { id: 'a-b' } }, { tagName: 'span' }] };
    const css = '#a{color:red}#a-b{color:blue}#ab{x:1}#a:hover{y:2}';
    const out = remapIds(json, css);
    const na = json.attributes.id;
    const nab = json.components[0].attributes.id;
    expect(na).not.toBe('a');
    expect(nab).not.toBe('a-b');
    expect(out).toBe(`#${na}{color:red}#${nab}{color:blue}#ab{x:1}#${na}:hover{y:2}`);
  });

  it('escapes regexp characters in ids', () => {
    const json: any = { attributes: { id: 'x.y' } };
    const out = remapIds(json, '#x.y{a:b}#xzy{c:d}');
    expect(out).toBe(`#${json.attributes.id}{a:b}#xzy{c:d}`);
  });
});

describe('serializeComponent / topLevel', () => {
  it('keeps ids only where CSS or an explicit attribute needs them', async () => {
    ({ editor } = await createEditor({
      html: '<section><h1 id="title">T</h1><p class="lead">P</p></section>',
      css: '#title{color:red}.lead{color:blue}',
    }));
    const sec = find(editor, 'section');
    const css = editor.getCss({ component: sec } as any)!;
    const json: any = serializeComponent(sec, css);
    expect(json.components[0].attributes.id).toBe('title');
    expect(json.components[1].attributes?.id).toBeUndefined();
  });

  it('drops selected descendants of selected parents', async () => {
    ({ editor } = await createEditor());
    const sec = find(editor, '#sec');
    const h1 = find(editor, '#title');
    expect(topLevel([sec, h1])).toEqual([sec]);
  });
});

describe('copy / paste between pages', () => {
  it('pastes the component with its #id and class styles on another page', async () => {
    const s = await createEditor();
    editor = s.editor;
    let copied = 0;
    editor.on(EVENTS.copy, (p: { count: number }) => (copied = p.count));
    editor.select(find(editor, '#sec'));
    expect(s.api.copy()).toBe(true);
    expect(copied).toBe(1);

    await s.api.create({ name: 'B' });
    expect(html(editor)).not.toContain('Hello');
    expect(s.api.paste()).toBe(true);
    expect(html(editor)).toContain('Hello');
    const h1 = editor.getWrapper()!.find('h1')[0];
    const newId = h1.getId();
    expect(newId).not.toBe('title');
    const css = editor.getCss()!;
    expect(css).toContain(`#${newId}{color:red;}`);
    expect(css).toContain('.lead{font-size:20px;}');
    expect(editor.getSelected()?.get('tagName')).toBe('section');
  });

  it('the clipboard survives a reload (stored in meta)', async () => {
    const a = await createEditor();
    a.editor.select(find(a.editor, '#p1'));
    a.api.copy();
    await destroyEditor(a.editor);
    const b = await createEditor({ plugin: { store: a.store }, html: '<div></div>' });
    editor = b.editor;
    await b.api.create();
    expect(b.api.paste()).toBe(true);
    expect(html(editor)).toContain('One');
  });

  it('pasting twice on the same page creates distinct ids', async () => {
    const s = await createEditor();
    editor = s.editor;
    editor.select(find(editor, '#title'));
    s.api.copy();
    s.api.paste();
    s.api.paste();
    const ids = editor.getWrapper()!.find("h1").map((c: any) => c.getId());
    expect(new Set(ids).size).toBe(3);
  });

  it('pastes right after the selected component', async () => {
    const s = await createEditor({ html: '<div id="a">A</div><div id="b">B</div>', css: '' });
    editor = s.editor;
    editor.select(find(editor, '#b'));
    s.api.copy();
    editor.select(find(editor, '#a'));
    s.api.paste();
    const texts = editor.getWrapper()!.components().map((c: any) => c.toHTML());
    expect(texts[1]).toContain('B');
    expect(texts).toHaveLength(3);
  });

  it('falls back to the wrapper when the target is not droppable', async () => {
    const s = await createEditor({ html: '<div id="x">x</div>', css: '' });
    editor = s.editor;
    editor.select(find(editor, '#x'));
    s.api.copy();
    editor.getWrapper()!.set('droppable', false);
    editor.select(find(editor, '#x'));
    // target = wrapper (parent of #x) which is not droppable → still the wrapper
    expect(s.api.paste()).toBe(true);
  });

  it('copy without a selection does nothing', async () => {
    const s = await createEditor();
    editor = s.editor;
    editor.select(null as any);
    expect(s.api.copy()).toBe(false);
  });

  it('a pasted component is autosaved', async () => {
    const s = await createEditor();
    editor = s.editor;
    editor.select(find(editor, '#title'));
    s.api.copy();
    const b = await s.api.create();
    s.api.paste();
    await settle(s.api);
    expect(JSON.stringify((await s.store.get(b.id))!.data)).toContain('Hello');
  });
});
