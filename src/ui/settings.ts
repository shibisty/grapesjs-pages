import type { Component, Editor } from 'grapesjs';
import type { Translator } from '../i18n';
import { h } from './dom';

/** Component settings (Trait Manager) of grapesjs-pages. */
export const PAGE_TRAIT = 'gjsp-page';
export const INSTANCE_TRAIT = 'gjsp-instance';

export interface PageSettingsDeps {
  t: Translator;
  /** The record open in the canvas. */
  activeId(): string | null;
  /** The properties form of a record (header fields, other plugins' sections, Save). */
  form(id: string, onSaved: () => void): Promise<HTMLElement | null>;
  /** A linked component's name and how many pages use it; null: not linked. */
  instance(c: Component): { name: string } | null;
  edit(c: Component): void;
  detach(c: Component): void;
  css?(): void;
}

/**
 * The body (wrapper) shows the open page's properties — name, address,
 * parent, SEO tabs and the sections of other plugins — with Save; a linked
 * component shows what it is linked to, Edit and Detach. The dialogs stay.
 */
export function registerPageSettings(editor: Editor, d: PageSettingsDeps): () => void {
  const tm = (editor as any).TraitManager;
  tm.addType(PAGE_TRAIT, {
    noLabel: true,
    createInput() {
      d.css?.();
      const el = h('div', { class: 'gjsp-trait' }, h('p', { class: 'gjsp-hint' }, '…'));
      const id = d.activeId();
      if (!id) {
        el.replaceChildren();
        return el;
      }
      const load = (): void => {
        void d
          .form(id, () => {
            const ok = h('span', { class: 'gjsp-trait__ok' }, '✓');
            el.querySelector('[data-role="save"]')?.after(ok);
            setTimeout(() => ok.remove(), 1500);
          })
          .then((form) => {
            if (!form) return el.replaceChildren();
            el.replaceChildren(h('div', { class: 'gjsp-trait__head' }, h('span', { class: 'gjsp-trait__title' }, d.t('properties'))), form);
          })
          .catch(() => el.replaceChildren());
      };
      load();
      return el;
    },
    onEvent() {},
    onUpdate() {},
  });
  tm.addType(INSTANCE_TRAIT, {
    noLabel: true,
    createInput({ component }: { component: Component }) {
      d.css?.();
      const info = d.instance(component);
      if (!info) return h('div');
      return h(
        'div',
        { class: 'gjsp-trait' },
        h('div', { class: 'gjsp-trait__head' }, h('span', { class: 'gjsp-trait__title' }, `⧉ ${info.name}`)),
        h(
          'div',
          { class: 'gjsp-trait__btns' },
          h('button', { type: 'button', class: 'gjsp-primary', 'data-role': 'edit-component', onclick: () => d.edit(component) }, d.t('editComponent')),
          h('button', { type: 'button', class: 'gjsp-secondary', 'data-role': 'detach-component', onclick: () => d.detach(component) }, d.t('detachComponent'))
        )
      );
    },
    onEvent() {},
    onUpdate() {},
  });

  // The body gets the page trait while a record is open.
  const sync = (): void => {
    const w: any = editor.getWrapper?.();
    if (!w) return;
    const has = !!w.getTrait?.(PAGE_TRAIT);
    const want = !!d.activeId();
    if (want && !has) w.addTrait?.({ type: PAGE_TRAIT, name: PAGE_TRAIT, changeProp: true }, { at: 0 });
    else if (!want && has) w.removeTrait?.(PAGE_TRAIT);
  };
  const evs = 'load pages-manager:open pages-manager:change';
  editor.on(evs, sync);
  sync();
  return () => editor.off(evs, sync);
}
