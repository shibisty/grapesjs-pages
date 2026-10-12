import type { Component, Editor } from 'grapesjs';
import { META, type PageStore } from '../store/types';
import type { ClipboardData, ClipboardItem } from '../types';
import { clone, escapeRegExp, uid } from '../utils';

type Json = Record<string, any>;

const idRe = (id: string): RegExp => new RegExp('#' + escapeRegExp(id) + '(?![\\w-])', 'g');

/**
 * Component JSON with an explicit `id` attribute on every node whose id is
 * needed: either it is already an attribute, or the copied CSS targets it
 * (`#id { … }`). Other nodes get fresh ids from GrapesJS on paste, so the
 * exported HTML is not littered with ids.
 */
export function serializeComponent(cmp: Component, css: string): Json {
  // toJSON() is shallow: children stay live Backbone collections. A deep
  // plain copy is required — walking the result must never touch models.
  const json = JSON.parse(JSON.stringify(cmp)) as Json;
  const walk = (m: Component, j: Json): void => {
    if (m.is('textnode')) return;
    const id = m.getId();
    const explicit = j.attributes && j.attributes.id;
    if (explicit || (id && idRe(id).test(css))) {
      j.attributes = { ...(j.attributes || {}), id: explicit || id };
    }
    const models = m.components().models;
    ((j.components as Json[]) || []).forEach((cj, i) => {
      if (models[i] && cj && typeof cj === 'object') walk(models[i], cj);
    });
  };
  walk(cmp, json);
  return json;
}

/**
 * Gives every id in the JSON a new unique value (in place) and rewrites the
 * `#id` selectors of the CSS accordingly, so pasting twice — or into the
 * page the components came from — never collides.
 */
export function remapIds(json: Json, css: string): string {
  const map: Record<string, string> = {};
  const walk = (j: Json): void => {
    if (j.attributes && j.attributes.id) {
      const nid = uid('c').replace(/-/g, '').slice(0, 10);
      map[j.attributes.id] = nid;
      j.attributes = { ...j.attributes, id: nid };
    }
    ((j.components as Json[]) || []).forEach((c) => c && typeof c === 'object' && walk(c));
  };
  walk(json);
  let out = css || '';
  Object.entries(map).forEach(([o, n]) => {
    out = out.replace(idRe(o), '#' + n);
  });
  return out;
}

/**
 * Selected components without their selected descendants (copying a parent
 * already copies its children).
 */
export function topLevel(components: Component[]): Component[] {
  return components.filter((c) => {
    for (let p = c.parent(); p; p = p.parent()) if (components.includes(p)) return false;
    return true;
  });
}

/**
 * Copy/paste of whole components *with their styles* between pages.
 * The clipboard is persisted in the store, so it survives switching pages
 * (= `loadProjectData`) and page reloads.
 */
export class ComponentClipboard {
  data: ClipboardData | null = null;

  constructor(
    private readonly editor: Editor,
    private readonly store: PageStore,
    private readonly getActiveId: () => string | null
  ) {}

  async restore(): Promise<void> {
    const saved = await this.store.getMeta<ClipboardData>(META.clipboard);
    this.data = saved && Array.isArray(saved.items) ? saved : null;
  }

  /** Copies the selection. Returns the number of copied components. */
  copy(): number {
    const sel = this.editor.getSelectedAll().filter((c) => c.parent() && c.get('copyable') !== false);
    const top = topLevel(sel);
    if (!top.length) return 0;
    const items: ClipboardItem[] = top.map((c) => {
      const css = this.editor.getCss({ component: c, avoidProtected: true } as any) || '';
      return { json: serializeComponent(c, css), css };
    });
    this.data = { from: this.getActiveId(), at: Date.now(), items };
    this.store.setMeta(META.clipboard, this.data).catch(() => {});
    return top.length;
  }

  /**
   * Pastes after the selected component (or into the wrapper). Falls back
   * to the end of the wrapper when the target does not accept children.
   */
  paste(): Component[] {
    const clip = this.data;
    if (!clip || !clip.items || !clip.items.length) return [];
    const wrapper = this.editor.getWrapper();
    if (!wrapper) return [];
    const sel = this.editor.getSelected();
    let target: Component = sel && sel.parent() ? sel.parent()! : sel || wrapper;
    let at: number | undefined = sel && sel.parent() ? sel.index() + 1 : undefined;
    if (target.get('droppable') === false) {
      target = wrapper;
      at = undefined;
    }
    const added: Component[] = [];
    clip.items.forEach(({ json, css }) => {
      const j = clone(json);
      const newCss = remapIds(j, css);
      // Rules that already exist on this page keep their styles.
      if (newCss.trim()) this.editor.Css.addCollection(newCss, { avoidUpdateStyle: true });
      const res = target.append(j as any, at !== undefined ? { at: at++ } : undefined);
      added.push(...(Array.isArray(res) ? res : [res]));
    });
    if (added.length) this.editor.select(added);
    return added;
  }
}
