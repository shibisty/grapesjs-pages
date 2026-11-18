import type { Editor } from 'grapesjs';
import type { ExportOptions, ImportOptions, ImportReport } from '../archive/ArchiveService';
import type { Translator } from '../i18n';
import { fmt } from '../utils';
import { h } from './dom';

export interface ArchiveActions {
  isRemote: boolean;
  download(opts: ExportOptions): Promise<void>;
  import(file: File, opts: ImportOptions): Promise<ImportReport>;
}

const closeBtn = (editor: Editor, t: Translator): HTMLButtonElement =>
  h('button', { class: 'gjsp-secondary', type: 'button', onclick: () => editor.Modal.close() }, t('close'));

const msgBox = (): HTMLDivElement => h('div', { class: 'gjsp-msg', 'aria-live': 'polite' });

const say = (box: HTMLElement, text: string, error = false): void => {
  box.className = error ? 'gjsp-msg gjsp-err' : 'gjsp-msg';
  box.textContent = text;
};

/** Export: with or without the rendered HTML, then a download. */
export function openExportModal(editor: Editor, t: Translator, actions: ArchiveActions): HTMLElement {
  const withHtml = h('input', { type: 'checkbox', name: 'html', checked: true });
  const msg = msgBox();
  const go = h('button', { class: 'gjsp-primary', type: 'button', 'data-role': 'export' }, t('download'));
  go.onclick = async () => {
    go.disabled = true;
    try {
      await actions.download({ html: withHtml.checked, onProgress: (d, n) => say(msg, fmt(t('exporting'), `${d}/${n}`)) });
      say(msg, t('exported'));
    } catch (e) {
      say(msg, fmt(t('saveError'), (e as Error)?.message || String(e)), true);
    } finally {
      go.disabled = false;
    }
  };
  const content = h(
    'div',
    { class: 'gjsp-modal gjsp-archive' },
    h('p', {}, actions.isRemote ? t('exportHint') : t('exportHintLocal')),
    h('label', { class: 'gjsp-check' }, withHtml, ' ', t('exportHtml')),
    msg,
    go,
    closeBtn(editor, t)
  );
  editor.Modal.open({ title: t('exportArchive'), content });
  return content;
}

/** Import: a file, what to do with records that exist, the site or not. */
export function openImportModal(editor: Editor, t: Translator, actions: ArchiveActions): HTMLElement {
  const file = h('input', { class: 'gjsp-input', type: 'file', name: 'file', accept: '.zip,application/zip' });
  const radio = (value: string, label: string, checked: boolean) =>
    h('label', { class: 'gjsp-check' }, h('input', { type: 'radio', name: 'gjsp-mode', value, checked }), ' ', label);
  const replace = radio('replace', t('modeReplace'), true);
  const copy = radio('copy', t('modeCopy'), false);
  const site = h('input', { type: 'checkbox', name: 'site', checked: true });
  const mode = (): 'replace' | 'copy' => ((copy.querySelector('input') as HTMLInputElement).checked ? 'copy' : 'replace');
  // A copy leaves the site alone unless asked.
  [replace, copy].forEach((l) => l.addEventListener('change', () => (site.checked = mode() === 'replace')));
  const msg = msgBox();
  const go = h('button', { class: 'gjsp-primary', type: 'button', 'data-role': 'import' }, t('importBtn'));
  go.onclick = async () => {
    const f = file.files?.[0];
    if (!f) return say(msg, t('archiveFile'), true);
    go.disabled = true;
    try {
      const r = await actions.import(f, {
        mode: mode(),
        site: actions.isRemote ? site.checked : false,
        onProgress: (d, n) => say(msg, fmt(t('importing'), `${d}/${n}`)),
      });
      const lines = [fmt(t('importDone'), r.created, r.updated)];
      if (r.fromMarkup) lines.push(fmt(t('importFromMarkup'), r.fromMarkup));
      if (r.skipped) lines.push(fmt(t('importSkipped'), r.skipped));
      if (r.errors.length) lines.push(fmt(t('importErrors'), r.errors.map((e) => `${e.name}: ${e.error}`).join('; ')));
      say(msg, lines.join(' '), r.errors.length > 0);
    } catch (e) {
      say(msg, fmt(t('badArchive'), (e as Error)?.message || String(e)), true);
    } finally {
      go.disabled = false;
    }
  };
  const content = h(
    'div',
    { class: 'gjsp-modal gjsp-archive' },
    h('label', {}, t('archiveFile'), file),
    h('p', {}, t('importMode')),
    replace,
    copy,
    actions.isRemote ? h('label', { class: 'gjsp-check' }, site, ' ', t('importSite')) : null,
    msg,
    go,
    closeBtn(editor, t)
  );
  editor.Modal.open({ title: t('importArchive'), content });
  return content;
}
