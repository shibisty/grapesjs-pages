import type { Editor } from 'grapesjs';
import { isEditorAlive } from '../core/PagesManager';
import type { Translator } from '../i18n';
import type { SyncPlanItem } from '../sync/plan';
import type { SyncService } from '../sync/SyncService';
import { fmt } from '../utils';
import { h } from './dom';

const closeBtn = (editor: Editor, t: Translator): HTMLButtonElement =>
  h('button', { class: 'gjsp-secondary', type: 'button', onclick: () => editor.Modal.close() }, t('close'));

/** Server URL + token, with a "Test" button that lists pages without saving. */
export function openSettingsModal(editor: Editor, sync: SyncService, t: Translator): HTMLElement {
  const url = h('input', {
    class: 'gjsp-input',
    type: 'url',
    name: 'url',
    placeholder: 'https://example.com/api/v1',
    value: sync.settings.url,
  });
  const token = h('input', {
    class: 'gjsp-input',
    type: 'password',
    name: 'token',
    placeholder: 'token',
    autocomplete: 'off',
    value: sync.settings.token,
  });
  const msg = h('div', { class: 'gjsp-msg', 'aria-live': 'polite' });
  const read = () => ({ url: url.value, token: token.value });
  const test = async (): Promise<void> => {
    msg.className = 'gjsp-msg';
    msg.textContent = '…';
    try {
      msg.textContent = fmt(t('connOk'), await sync.test(read()));
    } catch (e) {
      msg.className = 'gjsp-msg gjsp-err';
      msg.textContent = fmt(t('connFail'), (e as Error).message);
    }
  };
  const save = async (): Promise<void> => {
    await sync.setSettings(read());
    editor.Modal.close();
  };
  const content = h(
    'div',
    { class: 'gjsp-modal gjsp-settings' },
    h('label', {}, t('serverUrl'), url),
    h('label', {}, t('token'), token),
    msg,
    h('button', { class: 'gjsp-primary', type: 'button', 'data-role': 'save', onclick: () => void save() }, t('save')),
    h('button', { class: 'gjsp-secondary', type: 'button', 'data-role': 'test', onclick: () => void test() }, t('test'))
  );
  editor.Modal.open({ title: t('settings'), content });
  return content;
}

/** Fills `body` with the plan table and the Apply button. */
export function renderPlan(editor: Editor, sync: SyncService, t: Translator, body: HTMLElement, plan: SyncPlanItem[]): void {
  const items = plan.filter((p) => p.kind !== 'same');
  if (!items.length) {
    body.replaceChildren(h('p', {}, t('allSynced')), closeBtn(editor, t));
    return;
  }
  items.forEach((p) => {
    p.enabled = true;
    if (p.kind === 'conflict') p.choice = 'local';
  });
  const actionLabel = (p: SyncPlanItem): string =>
    ({ push: t('push'), pull: t('pull'), del: t('del'), purge: t('purge') })[p.kind as 'push'] || '';

  const rows = items.map((p) => {
    const action =
      p.kind === 'conflict'
        ? h(
            'select',
            { onchange: (e: Event) => (p.choice = (e.target as HTMLSelectElement).value as SyncPlanItem['choice']) },
            h('option', { value: 'local' }, t('choiceLocal')),
            h('option', { value: 'remote' }, t('choiceRemote')),
            h('option', { value: 'both' }, t('choiceBoth'))
          )
        : h('span', {}, actionLabel(p));
    return h(
      'tr',
      { 'data-id': p.id, 'data-kind': p.kind },
      h(
        'td',
        { style: 'width:24px' },
        h('input', { type: 'checkbox', checked: true, onchange: (e: Event) => (p.enabled = (e.target as HTMLInputElement).checked) })
      ),
      h('td', {}, p.kind === 'conflict' ? `${t('conflict')}: ` : '', p.name, p.note ? h('small', {}, t(p.note)) : null),
      h('td', { style: 'width:45%' }, action)
    );
  });

  const log = h('div', { class: 'gjsp-msg', 'aria-live': 'polite' });
  const applyBtn = h('button', { class: 'gjsp-primary', type: 'button', 'data-role': 'apply' }, t('apply'));
  applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true;
    const res = await sync.apply(items);
    log.replaceChildren(
      h('div', {}, fmt(t('done'), res.ok)),
      ...(res.errors.length
        ? [
            h('div', { class: 'gjsp-err' }, `${t('errors')}:`),
            ...res.errors.map((e) => h('div', { class: 'gjsp-err' }, `${e.item.name}: ${e.error.message}`)),
          ]
        : [])
    );
    if (!res.errors.length) setTimeout(() => isEditorAlive(editor) && editor.Modal.close(), 900);
  });
  body.replaceChildren(h('table', {}, ...rows), log, applyBtn, closeBtn(editor, t));
}

/** Opens the sync dialog (or the settings, when no server is configured). */
export async function openSyncModal(editor: Editor, sync: SyncService, t: Translator): Promise<HTMLElement> {
  if (!sync.configured) return openSettingsModal(editor, sync, t);
  const body = h('div', { class: 'gjsp-modal gjsp-sync' }, h('p', {}, t('syncLoading')));
  editor.Modal.open({ title: t('sync'), content: body });
  try {
    renderPlan(editor, sync, t, body, await sync.plan());
  } catch (e) {
    body.replaceChildren(h('p', { class: 'gjsp-err' }, `${t('syncFail')}: ${(e as Error).message}`), closeBtn(editor, t));
  }
  return body;
}

/**
 * A new component: its name and what it starts from — empty, or an item of
 * a source another plugin registered (`components.addSource`). Resolves to
 * null when closed without creating.
 */
export function openComponentFromModal(
  editor: Editor,
  t: Translator,
  sources: Array<{ id: string; label: string; items: Array<{ id: string; name: string }> }>,
  defaultName: string
): Promise<{ name: string; from: { source: string; item: string } | null } | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: { name: string; from: { source: string; item: string } | null } | null): void => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const name = h('input', { class: 'gjsp-input', type: 'text', name: 'name', value: defaultName, 'aria-label': t('componentName') });
    const from = h(
      'select',
      { class: 'gjsp-input', name: 'from', 'aria-label': t('startFrom') },
      h('option', { value: '' }, t('emptyComponent')),
      ...sources
        .filter((s) => s.items.length)
        .map((s) => h('optgroup', { label: s.label }, ...s.items.map((i) => h('option', { value: JSON.stringify([s.id, i.id]) }, i.name))))
    );
    // Picking an item suggests its name (until the name was typed).
    let typed = false;
    name.addEventListener('input', () => (typed = true));
    from.addEventListener('change', () => {
      if (typed || !from.value) return;
      name.value = from.selectedOptions[0]?.textContent || defaultName;
    });
    const submit = (): void => {
      const v = from.value ? (JSON.parse(from.value) as [string, string]) : null;
      finish({ name: name.value.trim() || defaultName, from: v ? { source: v[0], item: v[1] } : null });
      editor.Modal.close();
    };
    name.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') submit();
    });
    const content = h(
      'div',
      { class: 'gjsp-modal gjsp-component-from' },
      h('label', {}, t('componentName'), name),
      h('label', {}, t('startFrom'), from),
      h(
        'div',
        { class: 'gjsp-actions' },
        h('button', { class: 'gjsp-primary', type: 'button', 'data-role': 'create', onclick: submit }, t('createComponent')),
        closeBtn(editor, t)
      )
    );
    editor.Modal.open({ title: t('newComponent'), content });
    (editor.Modal as any).onceClose?.(() => finish(null));
    setTimeout(() => name.focus());
  });
}
