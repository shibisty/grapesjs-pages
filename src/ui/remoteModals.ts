import type { Editor } from 'grapesjs';
import { isEditorAlive } from '../core/PagesManager';
import type { Translator } from '../i18n';
import type { RemoteEditor } from '../remote/RemoteEditor';
import type { PageRecord, Revision } from '../types';
import { fmt, report } from '../utils';
import { h } from './dom';

const closeBtn = (editor: Editor, t: Translator): HTMLButtonElement =>
  h('button', { class: 'gjsp-secondary', type: 'button', onclick: () => editor.Modal.close() }, t('close'));

const errBox = (): HTMLDivElement => h('div', { class: 'gjsp-msg', 'aria-live': 'polite' });

const showErr = (box: HTMLElement, e: unknown): void => {
  box.className = 'gjsp-msg gjsp-err';
  box.textContent = (e as Error)?.message || String(e);
};

/** Pages that may be the parent of `rec`: not itself, not one of its descendants. */
export function parentChoices(rec: PageRecord, all: PageRecord[]): PageRecord[] {
  const pages = all.filter((r) => !r.deleted && (r.kind || 'page') === 'page' && !r.templateId);
  const below = new Set<string>([rec.id]);
  let grew = true;
  while (grew) {
    grew = false;
    pages.forEach((p) => {
      if (p.parentId && below.has(p.parentId) && !below.has(p.id)) {
        below.add(p.id);
        grew = true;
      }
    });
  }
  return pages.filter((p) => !below.has(p.id));
}

const options = (t: Translator, items: PageRecord[], current: string | null | undefined): HTMLOptionElement[] => [
  h('option', { value: '', selected: !current }, t('none')),
  ...items.map((r) => h('option', { value: r.id, selected: r.id === current }, r.slug ? `${r.name} — ${r.slug}` : r.name)),
];

/**
 * A record's header: name for every kind; a page also gets its address,
 * parent, layout, SEO title and description and "show in the menu".
 */
export async function openPropertiesModal(editor: Editor, remote: RemoteEditor, t: Translator, id: string): Promise<HTMLElement | null> {
  const rec = await remote.store.get(id);
  if (!rec || rec.deleted) return null;
  const all = await remote.store.all();
  const isPage = (rec.kind || 'page') === 'page';
  const input = (name: string, value: string, type = 'text') => h('input', { class: 'gjsp-input', type, name, value });
  const name = input('name', rec.name);
  const fields: HTMLElement[] = [h('label', {}, t('promptName'), name)];
  let slug: HTMLInputElement | null = null;
  let parent: HTMLSelectElement | null = null;
  let layout: HTMLSelectElement | null = null;
  let seoTitle: HTMLInputElement | null = null;
  let seoDescription: HTMLTextAreaElement | null = null;
  let inMenu: HTMLInputElement | null = null;
  if (isPage) {
    const v = rec.values || {};
    slug = input('slug', rec.slug || '');
    slug.placeholder = '/about';
    parent = h('select', { class: 'gjsp-select', name: 'parent' }, ...options(t, parentChoices(rec, all), rec.parentId));
    const layouts = all.filter((r) => !r.deleted && r.kind === 'layout');
    layout = h('select', { class: 'gjsp-select', name: 'layout' }, ...options(t, layouts, rec.layoutId));
    seoTitle = input('seo.title', String(v['seo.title'] ?? ''));
    seoDescription = h('textarea', { class: 'gjsp-input', name: 'seo.description', rows: '3' }, String(v['seo.description'] ?? ''));
    inMenu = h('input', { type: 'checkbox', name: 'in_menu', checked: v.in_menu === true });
    fields.push(
      h('label', {}, t('slug'), slug),
      h('label', {}, t('parent'), parent),
      h('label', {}, t('layout'), layout),
      h('label', {}, t('seoTitle'), seoTitle),
      h('label', {}, t('seoDescription'), seoDescription),
      h('label', { class: 'gjsp-check' }, inMenu, ' ', t('inMenu'))
    );
  }
  const msg = errBox();
  const save = async (): Promise<void> => {
    try {
      await remote.update(id, {
        name: name.value,
        ...(isPage
          ? {
              slug: slug!.value || undefined,
              parentId: parent!.value || null,
              layoutId: layout!.value || null,
              values: { 'seo.title': seoTitle!.value.trim(), 'seo.description': seoDescription!.value.trim(), in_menu: inMenu!.checked ? true : null },
            }
          : {}),
      });
      editor.Modal.close();
    } catch (e) {
      showErr(msg, e);
    }
  };
  const content = h(
    'form',
    {
      class: 'gjsp-modal gjsp-props',
      onsubmit: (e: Event) => {
        e.preventDefault();
        void save();
      },
    },
    ...fields,
    msg,
    h('button', { class: 'gjsp-primary', type: 'submit', 'data-role': 'save' }, t('save')),
    closeBtn(editor, t)
  );
  // Wrapped: GrapesJS' modal appends through cash-dom, which takes a <form>
  // for a list of its controls and would insert them one by one.
  editor.Modal.open({ title: `${t('properties')}: ${rec.name}`, content: h('div', {}, content) });
  return content;
}

/** The record's published revisions, newest first, each with Restore. */
export async function openRevisionsModal(editor: Editor, remote: RemoteEditor, t: Translator, id: string): Promise<HTMLElement | null> {
  const rec = await remote.store.get(id);
  if (!rec) return null;
  const body = h('div', { class: 'gjsp-modal gjsp-revisions' }, h('p', {}, '…'));
  editor.Modal.open({ title: `${t('revisions')}: ${rec.name}`, content: body });
  const msg = errBox();
  let list: Revision[];
  try {
    list = await remote.revisions(id);
  } catch (e) {
    showErr(msg, e);
    body.replaceChildren(msg, closeBtn(editor, t));
    return body;
  }
  if (!list.length) {
    body.replaceChildren(h('p', {}, t('noRevisions')), closeBtn(editor, t));
    return body;
  }
  const canRestore = (rec.kind || 'page') !== 'site';
  const when = (s: string): string => {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
  };
  const rows = list.map((r) =>
    h(
      'tr',
      { 'data-revision': String(r.revision) },
      h('td', {}, `#${r.revision}`, r.live ? h('small', {}, t('live')) : null),
      h('td', {}, when(r.createdAt), h('small', {}, r.createdBy)),
      h(
        'td',
        { style: 'text-align:end' },
        canRestore
          ? h(
              'button',
              {
                class: 'gjsp-secondary',
                type: 'button',
                'data-role': 'restore',
                onclick: async () => {
                  if (!window.confirm(fmt(t('confirmRestore'), r.revision))) return;
                  try {
                    await remote.restore(id, r.revision);
                    if (isEditorAlive(editor)) editor.Modal.close();
                  } catch (e) {
                    showErr(msg, e);
                  }
                },
              },
              t('restore')
            )
          : null
      )
    )
  );
  body.replaceChildren(h('table', {}, ...rows), msg, closeBtn(editor, t));
  return body;
}

/** A conflict: keep mine, take the server's, or keep both. */
export async function openConflictModal(editor: Editor, remote: RemoteEditor, t: Translator, id: string): Promise<HTMLElement | null> {
  const rec = await remote.store.get(id);
  if (!rec) return null;
  const msg = errBox();
  const choose = (choice: 'local' | 'remote' | 'both') => async (): Promise<void> => {
    try {
      await remote.resolve(id, choice);
      editor.Modal.close();
    } catch (e) {
      showErr(msg, e);
      report(e);
    }
  };
  const btn = (choice: 'local' | 'remote' | 'both', label: string, cls = 'gjsp-secondary') =>
    h('button', { class: cls, type: 'button', 'data-choice': choice, onclick: () => void choose(choice)() }, label);
  const content = h(
    'div',
    { class: 'gjsp-modal gjsp-conflict' },
    h('p', {}, t('conflictHint')),
    h('div', { class: 'gjsp-choices' }, btn('local', t('choiceLocal'), 'gjsp-primary'), btn('remote', t('choiceRemote')), btn('both', t('choiceBoth'))),
    msg,
    closeBtn(editor, t)
  );
  editor.Modal.open({ title: `${t('conflict')}: ${rec.name}`, content });
  return content;
}
