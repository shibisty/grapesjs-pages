import type { Editor } from 'grapesjs';
import type { PagesLabels } from './types';

import ar from './locales/ar';
import bs from './locales/bs';
import ca from './locales/ca';
import de from './locales/de';
import el from './locales/el';
import en from './locales/en';
import es from './locales/es';
import fa from './locales/fa';
import fr from './locales/fr';
import he from './locales/he';
import id from './locales/id';
import it from './locales/it';
import ko from './locales/ko';
import nb from './locales/nb';
import nl from './locales/nl';
import pl from './locales/pl';
import pt from './locales/pt';
import ru from './locales/ru';
import se from './locales/se';
import tr from './locales/tr';
import uk from './locales/uk';
import vi from './locales/vi';
import zh from './locales/zh';

export type { PagesLabels };

/** i18n namespace inside `editor.I18n`: keys are `pagesManager.<label>`. */
export const I18N_NS = 'pagesManager';

/**
 * The language codes of `grapesjs/locale` plus `uk`. `se` is Swedish (the
 * GrapesJS core's historical code).
 */
export const locales: Record<string, PagesLabels> = {
  ar,
  bs,
  ca,
  de,
  el,
  en,
  es,
  fa,
  fr,
  he,
  id,
  it,
  ko,
  nb,
  nl,
  pl,
  pt,
  ru,
  se,
  tr,
  uk,
  vi,
  zh,
};

export const SUPPORTED_LOCALES: readonly string[] = Object.keys(locales);

/** Right-to-left languages among the built-in locales. */
const RTL = new Set(['ar', 'he', 'fa']);
export const isRtlLocale = (locale: string | undefined): boolean => !!locale && RTL.has(locale.split('-')[0]);

/**
 * Registers every built-in locale in `editor.I18n` under `pagesManager`
 * (merge — messages of the site and of other plugins survive). Copies are
 * registered, so the exported `locales` objects are never mutated.
 */
export function registerMessages(editor: Editor): void {
  const i18n = editor.I18n;
  if (!i18n || typeof i18n.addMessages !== 'function') return;
  const messages: Record<string, Record<string, PagesLabels>> = {};
  SUPPORTED_LOCALES.forEach((lang) => {
    messages[lang] = { [I18N_NS]: { ...locales[lang] } };
  });
  i18n.addMessages(messages);
}

export type Translator = (key: keyof PagesLabels) => string;

/**
 * Label lookup order: explicit `labels` option (non-empty strings) →
 * `editor.I18n` (current locale, then its fallback) → built-in English.
 * Resolved on every call, so a locale switch applies on the next render.
 */
export function createTranslator(editor: Editor, overrides: Partial<PagesLabels> = {}): Translator {
  return (key) => {
    const own = overrides[key];
    if (typeof own === 'string' && own) return own;
    let msg: unknown;
    try {
      msg = editor.I18n?.t(`${I18N_NS}.${key}`);
    } catch {
      msg = undefined;
    }
    return typeof msg === 'string' && msg ? msg : en[key];
  };
}

export function getLocale(editor: Editor): string | undefined {
  try {
    return editor.I18n?.getLocale();
  } catch {
    return undefined;
  }
}
