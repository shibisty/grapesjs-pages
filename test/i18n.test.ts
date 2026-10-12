import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from 'grapesjs';
import { createTranslator, isRtlLocale, locales, SUPPORTED_LOCALES } from '../src/i18n';
import en from '../src/i18n/locales/en';
import ru from '../src/i18n/locales/ru';
import type { PagesLabels } from '../src/i18n/types';
import { createEditor, destroyEditor, sidebar, tick } from './helpers/editor';

const keys = Object.keys(en).sort() as (keyof PagesLabels)[];
const placeholders = (s: string) => (s.match(/%s/g) || []).length;

describe('built-in locales', () => {
  it('every locale has exactly the English keys, all non-empty', () => {
    Object.entries(locales).forEach(([lang, msgs]) => {
      expect(Object.keys(msgs).sort(), lang).toEqual(keys);
      Object.values(msgs).forEach((v) => expect(typeof v === 'string' && v.trim().length > 0, lang).toBe(true));
    });
  });

  it('covers every locale shipped with GrapesJS core (plus uk)', () => {
    const core = ['ar', 'bs', 'ca', 'de', 'el', 'en', 'es', 'fa', 'fr', 'he', 'id', 'it',
      'ko', 'nb', 'nl', 'pl', 'pt', 'ru', 'se', 'tr', 'vi', 'zh'];
    expect([...SUPPORTED_LOCALES].sort()).toEqual([...core, 'uk'].sort());
  });

  it('keeps the %s placeholders of every string', () => {
    Object.entries(locales).forEach(([lang, msgs]) => {
      keys.forEach((k) => expect(placeholders(msgs[k]), `${lang}.${k}`).toBe(placeholders(en[k])));
    });
  });

  it('keeps the shortcut hints and the 412 code', () => {
    Object.entries(locales).forEach(([lang, msgs]) => {
      expect(msgs.undo, lang).toContain('Ctrl+Z');
      expect(msgs.redo, lang).toContain('Ctrl+Y');
      expect(msgs.conflictErr, lang).toContain('412');
    });
  });

  it('every non-English locale is actually translated', () => {
    Object.entries(locales)
      .filter(([lang]) => lang !== 'en')
      .forEach(([lang, msgs]) => {
        expect(keys.filter((k) => msgs[k] === en[k]), lang).toEqual([]);
      });
  });

  it('labels are single-line and not padded', () => {
    Object.entries(locales).forEach(([lang, msgs]) => {
      Object.values(msgs).forEach((v) => {
        expect(v, lang).toBe(v.trim());
        expect(/[\n\r]/.test(v), lang).toBe(false);
      });
    });
  });

  it('RTL detection', () => {
    expect(isRtlLocale('ar')).toBe(true);
    expect(isRtlLocale('he-IL')).toBe(true);
    expect(isRtlLocale('ru')).toBe(false);
    expect(isRtlLocale(undefined)).toBe(false);
  });
});

describe('translations in the editor', () => {
  let editor: Editor | undefined;
  afterEach(async () => {
    await destroyEditor(editor);
    editor = undefined;
  });

  it('registers every locale in editor.I18n without mutating the exports', async () => {
    ({ editor } = await createEditor());
    SUPPORTED_LOCALES.forEach((l) => {
      expect(editor!.I18n.t('pagesManager.pages', { l }), l).toBe(locales[l].pages);
    });
  });

  it('translator: labels option → I18n → English', async () => {
    ({ editor } = await createEditor());
    editor.I18n.setLocale('ru');
    expect(createTranslator(editor)('pages')).toBe(ru.pages);
    expect(createTranslator(editor, { pages: 'Мои' })('pages')).toBe('Мои');
    expect(createTranslator(editor, { pages: '' })('pages')).toBe(ru.pages);
    editor.I18n.setLocale('xx');
    expect(createTranslator(editor)('pages')).toBe(en.pages);
  });

  it('starts in the editor locale and relabels on the fly (with RTL)', async () => {
    ({ editor } = await createEditor({ config: { i18n: { locale: 'ru', detectLocale: false } } }));
    const title = () => sidebar().querySelector('.gjsp-title')!.textContent;
    expect(title()).toBe('Страницы');
    expect(sidebar().querySelector('.gjsp-name')!.textContent).toBe('Страница 1');
    editor.I18n.setLocale('de');
    await tick(5);
    expect(title()).toBe(locales.de.pages);
    expect(sidebar().getAttribute('dir')).toBe('ltr');
    editor.I18n.setLocale('ar');
    await tick(5);
    expect(title()).toBe(locales.ar.pages);
    expect(sidebar().getAttribute('dir')).toBe('rtl');
    const btn = editor.Panels.getPanel('views')!.get('buttons')!.get('pages-manager')!;
    expect(btn.get('attributes').title).toBe(locales.ar.pages);
  });
});
