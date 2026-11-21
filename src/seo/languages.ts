/**
 * The languages of a site and what a page is in each of them: pure
 * functions (no DOM, no GrapesJS) that the editor and a server share.
 *
 * - The site's languages are its values' `site.languages`:
 *   `{ default: 'uk-ua', enabled: ['uk-ua', 'en-gb'] }` (codes: language +
 *   region, lower case, as in grapesjs-storage; the default first).
 * - Addresses: the default language has none of its own (`/about`), another
 *   one is prefixed with its language (`/en/about`), or with the whole code
 *   (`/en-gb/about`) when the site has the language in two regions.
 * - A page's translations are its values' `i18n.<code>`: an object with
 *   `name` (the menu and breadcrumbs), `slug` (an address without the
 *   prefix; none — the default language's), `hidden` (the page does not
 *   exist in that language) and any page value (`seo.title`, `og.image_alt`,
 *   `schema.props`…) to use instead of the default one. A server that does
 *   not know languages ignores these keys.
 */

export const SITE_LANGUAGES_KEY = 'site.languages';
/** A page's (or the site's) translations into a language are its values' `i18n.<code>`. */
export const I18N_PREFIX = 'i18n.';

export interface LanguageInfo {
  /** `uk-ua` */
  code: string;
  /** The name in the language itself. */
  native: string;
  /** Right to left. */
  rtl?: true;
}

/** Which languages a site has: the default first, then the others in order. */
export interface LanguageSettings {
  /** Untranslated values fall back to this one; addresses in it have no prefix. */
  default: string;
  /** Enabled languages in order, the default among them (first). */
  enabled: string[];
}

/** A page's translation into one language (`values['i18n.<code>']`). */
export interface PageTranslation {
  name?: string;
  slug?: string;
  hidden?: boolean;
  /** Any other page value (`seo.title`…). */
  [key: string]: unknown;
}

export const LANG_CODE_RE = /^[a-z]{2,3}-[a-z0-9]{2,4}$/;

/* prettier-ignore */
export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'af-za', native: 'Afrikaans' },
  { code: 'am-et', native: 'አማርኛ' },
  { code: 'ar-ae', native: 'العربية (الإمارات)', rtl: true },
  { code: 'ar-eg', native: 'العربية (مصر)', rtl: true },
  { code: 'ar-sa', native: 'العربية (السعودية)', rtl: true },
  { code: 'az-az', native: 'Azərbaycan' },
  { code: 'be-by', native: 'Беларуская' },
  { code: 'bg-bg', native: 'Български' },
  { code: 'bn-bd', native: 'বাংলা' },
  { code: 'bs-ba', native: 'Bosanski' },
  { code: 'ca-es', native: 'Català' },
  { code: 'cs-cz', native: 'Čeština' },
  { code: 'cy-gb', native: 'Cymraeg' },
  { code: 'da-dk', native: 'Dansk' },
  { code: 'de-at', native: 'Deutsch (Österreich)' },
  { code: 'de-ch', native: 'Deutsch (Schweiz)' },
  { code: 'de-de', native: 'Deutsch' },
  { code: 'el-gr', native: 'Ελληνικά' },
  { code: 'en-au', native: 'English (Australia)' },
  { code: 'en-ca', native: 'English (Canada)' },
  { code: 'en-gb', native: 'English (UK)' },
  { code: 'en-ie', native: 'English (Ireland)' },
  { code: 'en-in', native: 'English (India)' },
  { code: 'en-nz', native: 'English (New Zealand)' },
  { code: 'en-us', native: 'English (US)' },
  { code: 'en-za', native: 'English (South Africa)' },
  { code: 'es-ar', native: 'Español (Argentina)' },
  { code: 'es-cl', native: 'Español (Chile)' },
  { code: 'es-co', native: 'Español (Colombia)' },
  { code: 'es-es', native: 'Español' },
  { code: 'es-mx', native: 'Español (México)' },
  { code: 'et-ee', native: 'Eesti' },
  { code: 'eu-es', native: 'Euskara' },
  { code: 'fa-ir', native: 'فارسی', rtl: true },
  { code: 'fi-fi', native: 'Suomi' },
  { code: 'fil-ph', native: 'Filipino' },
  { code: 'fr-be', native: 'Français (Belgique)' },
  { code: 'fr-ca', native: 'Français (Canada)' },
  { code: 'fr-ch', native: 'Français (Suisse)' },
  { code: 'fr-fr', native: 'Français' },
  { code: 'ga-ie', native: 'Gaeilge' },
  { code: 'gl-es', native: 'Galego' },
  { code: 'gu-in', native: 'ગુજરાતી' },
  { code: 'he-il', native: 'עברית', rtl: true },
  { code: 'hi-in', native: 'हिन्दी' },
  { code: 'hr-hr', native: 'Hrvatski' },
  { code: 'hu-hu', native: 'Magyar' },
  { code: 'hy-am', native: 'Հայերեն' },
  { code: 'id-id', native: 'Bahasa Indonesia' },
  { code: 'is-is', native: 'Íslenska' },
  { code: 'it-ch', native: 'Italiano (Svizzera)' },
  { code: 'it-it', native: 'Italiano' },
  { code: 'ja-jp', native: '日本語' },
  { code: 'ka-ge', native: 'ქართული' },
  { code: 'kk-kz', native: 'Қазақ' },
  { code: 'km-kh', native: 'ខ្មែរ' },
  { code: 'kn-in', native: 'ಕನ್ನಡ' },
  { code: 'ko-kr', native: '한국어' },
  { code: 'ky-kg', native: 'Кыргызча' },
  { code: 'lo-la', native: 'ລາວ' },
  { code: 'lt-lt', native: 'Lietuvių' },
  { code: 'lv-lv', native: 'Latviešu' },
  { code: 'mk-mk', native: 'Македонски' },
  { code: 'ml-in', native: 'മലയാളം' },
  { code: 'mn-mn', native: 'Монгол' },
  { code: 'mr-in', native: 'मराठी' },
  { code: 'ms-my', native: 'Bahasa Melayu' },
  { code: 'mt-mt', native: 'Malti' },
  { code: 'my-mm', native: 'မြန်မာ' },
  { code: 'nb-no', native: 'Norsk bokmål' },
  { code: 'ne-np', native: 'नेपाली' },
  { code: 'nl-be', native: 'Nederlands (België)' },
  { code: 'nl-nl', native: 'Nederlands' },
  { code: 'nn-no', native: 'Norsk nynorsk' },
  { code: 'pa-in', native: 'ਪੰਜਾਬੀ' },
  { code: 'pl-pl', native: 'Polski' },
  { code: 'pt-br', native: 'Português (Brasil)' },
  { code: 'pt-pt', native: 'Português' },
  { code: 'ro-md', native: 'Română (Moldova)' },
  { code: 'ro-ro', native: 'Română' },
  { code: 'ru-ru', native: 'Русский' },
  { code: 'si-lk', native: 'සිංහල' },
  { code: 'sk-sk', native: 'Slovenčina' },
  { code: 'sl-si', native: 'Slovenščina' },
  { code: 'sq-al', native: 'Shqip' },
  { code: 'sr-rs', native: 'Српски' },
  { code: 'sv-fi', native: 'Svenska (Finland)' },
  { code: 'sv-se', native: 'Svenska' },
  { code: 'sw-ke', native: 'Kiswahili' },
  { code: 'ta-in', native: 'தமிழ்' },
  { code: 'te-in', native: 'తెలుగు' },
  { code: 'tg-tj', native: 'Тоҷикӣ' },
  { code: 'th-th', native: 'ไทย' },
  { code: 'tk-tm', native: 'Türkmen' },
  { code: 'tr-tr', native: 'Türkçe' },
  { code: 'uk-ua', native: 'Українська' },
  { code: 'ur-pk', native: 'اردو', rtl: true },
  { code: 'uz-uz', native: 'Oʻzbek' },
  { code: 'vi-vn', native: 'Tiếng Việt' },
  { code: 'zh-cn', native: '中文（简体）' },
  { code: 'zh-hk', native: '中文（香港）' },
  { code: 'zh-tw', native: '中文（繁體）' },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

/** A language of the catalog (or a bare one for a code not in it). */
export const languageInfo = (code: string): LanguageInfo => BY_CODE.get(code) || { code, native: code };

/** The flag of the code's region: `uk-ua` → 🇺🇦 (regional indicator letters). */
export function flagOf(code: string): string {
  const region = code.split('-')[1] || '';
  if (!/^[a-z]{2}$/.test(region)) return '🏳';
  return String.fromCodePoint(...[...region.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** The region's two letters, upper case (a badge where flags do not draw, e.g. Windows). */
export const regionOf = (code: string): string => (code.split('-')[1] || '').toUpperCase();

/** A language's name in the editor's language (`Intl.DisplayNames`), else the native name. */
export function languageName(code: string, uiLocale?: string): string {
  try {
    const dn = new Intl.DisplayNames(uiLocale ? [uiLocale] : undefined, { type: 'language' });
    const [lang, region] = code.split('-');
    const name = dn.of(region ? `${lang}-${region.toUpperCase()}` : lang);
    if (name && name.toLowerCase() !== code) return name;
  } catch {
    /* no Intl.DisplayNames */
  }
  return languageInfo(code).native;
}

/** Cleans settings: known shape, unique codes, the default enabled and first. Null: no languages. */
export function normalizeLanguages(raw: unknown): LanguageSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const list = (Array.isArray(o.enabled) ? o.enabled : [])
    .map((c) => String(c).trim().toLowerCase().replace('_', '-'))
    .filter((c, i, a) => LANG_CODE_RE.test(c) && a.indexOf(c) === i);
  let def = typeof o.default === 'string' ? o.default.trim().toLowerCase().replace('_', '-') : '';
  if (!LANG_CODE_RE.test(def)) def = list[0] || '';
  if (!def) return null;
  return { default: def, enabled: [def, ...list.filter((c) => c !== def)] };
}


type V = Record<string, unknown>;

/** The site's languages from its values; null — a site in one language. */
export function siteLanguages(site: V | null | undefined): LanguageSettings | null {
  const l = normalizeLanguages(site?.[SITE_LANGUAGES_KEY]);
  return l;
}

/**
 * The address prefix of each language: `''` for the default, `/en` for
 * another, `/en-gb` when the site has the language in two regions.
 */
export function langPrefixes(l: LanguageSettings | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!l) return out;
  const count = new Map<string, number>();
  l.enabled.forEach((c) => count.set(c.split('-')[0], (count.get(c.split('-')[0]) || 0) + 1));
  l.enabled.forEach((c) => {
    out[c] = c === l.default ? '' : '/' + ((count.get(c.split('-')[0]) || 0) > 1 ? c : c.split('-')[0]);
  });
  return out;
}

/** The language an address is in, and the address without its prefix. */
export function langOfPath(path: string, l: LanguageSettings | null): { lang: string; path: string } {
  if (!l) return { lang: '', path };
  const prefixes = langPrefixes(l);
  for (const c of l.enabled) {
    const p = prefixes[c];
    if (p && (path === p || path.startsWith(p + '/'))) return { lang: c, path: path.slice(p.length) || '/' };
  }
  return { lang: l.default, path };
}

/** `/en` + `/about` → `/en/about`; `/en` + `/` → `/en`. */
export const withPrefix = (prefix: string, slug: string): string => (prefix ? (slug === '/' || !slug ? prefix : prefix + slug) : slug || '/');

/** A page's translation into a language (an object, or empty). */
export function translationOf(values: V | null | undefined, lang: string): PageTranslation {
  const t = values?.[I18N_PREFIX + lang];
  return t && typeof t === 'object' && !Array.isArray(t) ? (t as PageTranslation) : {};
}

/** Does the page exist in the language? (The default one: always.) */
export function inLanguage(values: V | null | undefined, lang: string, l: LanguageSettings | null): boolean {
  if (!l || lang === l.default) return true;
  if (!l.enabled.includes(lang)) return false;
  return translationOf(values, lang).hidden !== true;
}

/** The page's own address in a language without the prefix: its translated slug, else the default one. */
export function slugIn(page: { slug?: string; values?: V | null }, lang: string, l: LanguageSettings | null): string {
  const own = l && lang !== l.default ? translationOf(page.values, lang).slug : undefined;
  return typeof own === 'string' && own.trim() ? own.trim() : page.slug || '/';
}

/** The page's address in a language, with the prefix (`/en/about`). */
export function pathIn(page: { slug?: string; values?: V | null }, lang: string, l: LanguageSettings | null): string {
  const prefixes = langPrefixes(l);
  return withPrefix(prefixes[lang] || '', slugIn(page, lang, l));
}

/** Values with a language's translation applied (the `i18n.*` keys left out); empty translated values keep the default. */
export function valuesIn(values: V | null | undefined, lang: string, l: LanguageSettings | null): V {
  const out: V = {};
  const other = !!l && !!lang && lang !== l.default;
  Object.entries(values || {}).forEach(([k, v]) => {
    // A canonical address is of one language: another one does not inherit it.
    if (!k.startsWith(I18N_PREFIX) && !(other && k === 'seo.canonical')) out[k] = v;
  });
  if (!other) return out;
  Object.entries(translationOf(values, lang)).forEach(([k, v]) => {
    if (k === 'name' || k === 'slug' || k === 'hidden') return;
    if (v === undefined || v === null || v === '') return;
    // An object (Schema.org props) is merged: the translated keys over the default ones.
    const base = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base && typeof base === 'object' && !Array.isArray(base) ? { ...(base as V), ...(v as V) } : v;
  });
  return out;
}

/** A record as it is in a language: name, slug (with the prefix) and values; null when the page is hidden there. */
export function localizePage<T extends { name: string; slug?: string; values?: V | null }>(page: T, lang: string, l: LanguageSettings | null): T | null {
  if (!l || !lang || lang === l.default) return page;
  if (!inLanguage(page.values, lang, l)) return null;
  const t = translationOf(page.values, lang);
  const name = typeof t.name === 'string' && t.name.trim() ? t.name.trim() : page.name;
  return { ...page, name, slug: pathIn(page, lang, l), values: valuesIn(page.values, lang, l) };
}

/** The site's values in a language (its own `i18n.<code>`, and `site.lang` = the language). */
export function localizeSite(site: V | null | undefined, lang: string, l: LanguageSettings | null): V {
  const out = valuesIn(site, lang, l);
  if (l && lang) out['site.lang'] = lang;
  return out;
}

/**
 * Slugs taken twice in a language: `[{ lang, slug, ids }]`. A page without
 * its own slug in a language uses the default one; hidden pages take none.
 */
export function slugClashes(pages: Array<{ id: string; slug?: string; values?: V | null }>, l: LanguageSettings | null): Array<{ lang: string; slug: string; ids: string[] }> {
  const out: Array<{ lang: string; slug: string; ids: string[] }> = [];
  if (!l) return out;
  l.enabled.forEach((lang) => {
    const by = new Map<string, string[]>();
    pages.forEach((p) => {
      if (!inLanguage(p.values, lang, l)) return;
      const s = slugIn(p, lang, l);
      by.set(s, [...(by.get(s) || []), p.id]);
    });
    by.forEach((ids, slug) => ids.length > 1 && out.push({ lang, slug, ids }));
  });
  return out;
}
