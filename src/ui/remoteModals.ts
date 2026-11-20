import type { Editor } from 'grapesjs';
import { isEditorAlive } from '../core/PagesManager';
import type { Translator } from '../i18n';
import type { RemoteEditor } from '../remote/RemoteEditor';
import { EVENTS } from '../events';
import type { PageRecord, RecordFormRequest, RecordFormSection, RecordPatch, Revision } from '../types';
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
  const pages = all.filter((r) => !r.deleted && (r.kind || 'page') === 'page' && !r.templateId && !r.dataOf);
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

/** What the properties dialog needs: where records are read and how a header is written. */
export interface PropertiesDeps {
  store: { get(id: string): Promise<PageRecord | undefined>; all(): Promise<PageRecord[]> };
  update(id: string, patch: RecordPatch): Promise<PageRecord | undefined>;
  /** Remote mode: layouts exist. */
  remote: boolean;
  /** Tabs of the record's own (SEO, Open Graph, Schema.org for a page; the site's SEO for the site). */
  ownSections?(rec: PageRecord): RecordFormSection[];
}

/** Sections other plugins add to the "new page" / "properties" dialogs. */
export function formSections(editor: Editor, req: Omit<RecordFormRequest, 'sections'>): RecordFormSection[] {
  const sections: RecordFormSection[] = [];
  try {
    editor.trigger(EVENTS.recordForm, { ...req, sections });
  } catch (e) {
    report(e);
  }
  return sections.filter((s) => s && s.el instanceof HTMLElement && s.id);
}

/** Merged values of the sections; a message when one of them refuses. */
async function runSections(sections: RecordFormSection[]): Promise<{ values: Record<string, unknown>; error: string | null }> {
  const values: Record<string, unknown> = {};
  for (const s of sections) {
    const err = s.validate?.();
    if (err) return { values, error: err };
    Object.assign(values, s.values?.() || {});
  }
  return { values, error: null };
}

/** Main fields + the sections that are tabs of their own. */
function tabbed(t: Translator, main: HTMLElement[], sections: RecordFormSection[]): HTMLElement[] {
  const inline = sections.filter((s) => !s.tab);
  const tabs = sections.filter((s) => s.tab);
  const general = h('div', { class: 'gjsp-tab-pane', 'data-pane': 'general' }, ...main, ...inline.map((s) => h('div', { class: 'gjsp-section-form', 'data-section': s.id }, s.el)));
  if (!tabs.length) return [general];
  const panes = [general, ...tabs.map((s) => h('div', { class: 'gjsp-tab-pane', 'data-pane': s.id, hidden: true }, s.el))];
  const show = (id: string): void => {
    panes.forEach((p) => (p.hidden = p.dataset.pane !== id));
    bar.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === id));
  };
  const tabBtn = (id: string, label: string) =>
    h('button', { type: 'button', class: 'gjsp-tab' + (id === 'general' ? ' is-active' : ''), 'data-tab': id, onclick: () => show(id) }, label);
  const bar = h('div', { class: 'gjsp-tabs', role: 'tablist' }, tabBtn('general', t('general')), ...tabs.map((s) => tabBtn(s.id, s.label)));
  return [bar, ...panes];
}

/**
 * A record's header: name for every kind; a page also gets its address,
 * parent, (remote) layout, SEO title and description and "show in the
 * menu". Other plugins add sections (`pages-manager:record-form`), e.g. the
 * page's data as a tab of its own.
 */
export async function openPropertiesModal(editor: Editor, deps: PropertiesDeps, t: Translator, id: string): Promise<HTMLElement | null> {
  const rec = await deps.store.get(id);
  if (!rec || rec.deleted) return null;
  const all = await deps.store.all();
  const isPage = (rec.kind || 'page') === 'page';
  const input = (name: string, value: string, type = 'text') => h('input', { class: 'gjsp-input', type, name, value });
  const name = input('name', rec.name);
  const fields: HTMLElement[] = [h('label', {}, t('promptName'), name)];
  let slug: HTMLInputElement | null = null;
  let parent: HTMLSelectElement | null = null;
  let layout: HTMLSelectElement | null = null;
  let inMenu: HTMLInputElement | null = null;
  if (isPage) {
    const v = rec.values || {};
    slug = input('slug', rec.slug || '');
    slug.placeholder = '/about';
    parent = h('select', { class: 'gjsp-select', name: 'parent' }, ...options(t, parentChoices(rec, all), rec.parentId));
    inMenu = h('input', { type: 'checkbox', name: 'in_menu', checked: v.in_menu === true });
    fields.push(h('label', {}, t('slug'), slug), h('label', {}, t('parent'), parent));
    if (deps.remote) {
      const layouts = all.filter((r) => !r.deleted && r.kind === 'layout');
      layout = h('select', { class: 'gjsp-select', name: 'layout' }, ...options(t, layouts, rec.layoutId));
      fields.push(h('label', {}, t('layout'), layout));
    }
    fields.push(h('label', { class: 'gjsp-check' }, inMenu, ' ', t('inMenu')));
  }
  const sections = [...(deps.ownSections?.({ ...rec }) || []), ...formSections(editor, { mode: 'edit', record: { ...rec } })];
  const msg = errBox();
  const save = async (): Promise<void> => {
    try {
      const extra = await runSections(sections);
      if (extra.error) return showErr(msg, new Error(extra.error));
      const next = await deps.update(id, {
        name: name.value,
        ...(isPage
          ? {
              slug: slug!.value || (deps.remote ? undefined : ''),
              parentId: parent!.value || null,
              ...(layout ? { layoutId: layout.value || null } : {}),
              values: {
                in_menu: inMenu!.checked ? true : null,
                ...extra.values,
              },
            }
          : Object.keys(extra.values).length
            ? { values: extra.values }
            : {}),
      });
      for (const s of sections) await s.save?.(next || rec);
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
    ...tabbed(t, fields, sections),
    msg,
    h('button', { class: 'gjsp-primary', type: 'submit', 'data-role': 'save' }, t('save')),
    closeBtn(editor, t)
  );
  // Wrapped: GrapesJS' modal appends through cash-dom, which takes a <form>
  // for a list of its controls and would insert them one by one.
  editor.Modal.open({ title: `${t('properties')}: ${rec.name}`, content: h('div', {}, content) });
  return content;
}

/**
 * The "new page" dialog: name, parent and the sections of other plugins
 * (e.g. grapesjs-storage's template). Resolves to the new record, or null
 * when closed.
 */
export function openCreatePageModal(
  editor: Editor,
  t: Translator,
  o: {
    all: PageRecord[];
    name: string;
    parentId?: string | null;
    sections: RecordFormSection[];
    create(init: { name: string; parentId: string | null; values: Record<string, unknown> }): Promise<PageRecord>;
  }
): Promise<PageRecord | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: PageRecord | null): void => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const name = h('input', { class: 'gjsp-input', type: 'text', name: 'name', value: o.name });
    const pages = o.all.filter((r) => !r.deleted && (r.kind || 'page') === 'page' && !r.templateId && !r.dataOf);
    const parent = h('select', { class: 'gjsp-select', name: 'parent' }, ...options(t, pages, o.parentId ?? null));
    const msg = errBox();
    const submit = async (): Promise<void> => {
      try {
        const extra = await runSections(o.sections);
        if (extra.error) return showErr(msg, new Error(extra.error));
        const rec = await o.create({ name: name.value.trim() || o.name, parentId: parent.value || null, values: extra.values });
        for (const s of o.sections) await s.save?.(rec);
        finish(rec);
        editor.Modal.close();
      } catch (e) {
        showErr(msg, e);
      }
    };
    const content = h(
      'form',
      {
        class: 'gjsp-modal gjsp-create',
        onsubmit: (e: Event) => {
          e.preventDefault();
          void submit();
        },
      },
      h('label', {}, t('promptName'), name),
      pages.length ? h('label', {}, t('parent'), parent) : null,
      ...o.sections.map((s) => h('div', { class: 'gjsp-section-form', 'data-section': s.id }, s.el)),
      msg,
      h('button', { class: 'gjsp-primary', type: 'submit', 'data-role': 'create' }, t('createComponent')),
      closeBtn(editor, t)
    );
    editor.Modal.open({ title: t('newPage'), content: h('div', {}, content) });
    (editor.Modal as any).onceClose?.(() => finish(null));
    setTimeout(() => {
      name.focus();
      name.select();
    });
  });
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

/**
 * A dialog of form sections alone (the site's SEO in local mode, where the
 * site has no record): tabs, Save, Close.
 */
export function openSectionsModal(editor: Editor, t: Translator, title: string, sections: RecordFormSection[], save: (values: Record<string, unknown>) => Promise<void>): HTMLElement {
  const msg = errBox();
  const submit = async (): Promise<void> => {
    try {
      const extra = await runSections(sections);
      if (extra.error) return showErr(msg, new Error(extra.error));
      await save(extra.values);
      editor.Modal.close();
    } catch (e) {
      showErr(msg, e);
    }
  };
  const [first, ...rest] = sections;
  const content = h(
    'form',
    {
      class: 'gjsp-modal gjsp-props gjsp-sections',
      onsubmit: (e: Event) => {
        e.preventDefault();
        void submit();
      },
    },
    ...(first ? tabbed(t, [first.el], rest) : []),
    msg,
    h('button', { class: 'gjsp-primary', type: 'submit', 'data-role': 'save' }, t('save')),
    closeBtn(editor, t)
  );
  // The first section is the "general" pane: its tab is named after it.
  const firstTab = content.querySelector<HTMLButtonElement>('.gjsp-tab[data-tab="general"]');
  if (firstTab && first) firstTab.textContent = first.label;
  editor.Modal.open({ title, content: h('div', {}, content) });
  return content;
}
