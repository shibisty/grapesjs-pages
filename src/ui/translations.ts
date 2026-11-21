import type { Translator } from '../i18n';
import { normalizeSlug } from '../remote/RemoteEditor';
import { SEO_KEYS as K, SITE_KEYS as S, type SeoPage } from '../seo/head';
import {
  I18N_PREFIX,
  LANGUAGES,
  langPrefixes,
  languageName,
  type LanguageSettings,
  normalizeLanguages,
  pathIn,
  siteLanguages,
  SITE_LANGUAGES_KEY,
  slugClashes,
  translationOf,
} from '../seo/languages';
import type { RecordFormSection } from '../types';
import { fmt } from '../utils';
import { h } from './dom';

type V = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

const field = (label: string, control: HTMLElement, hint?: string): HTMLElement =>
  h('label', { class: 'gjsp-seo-field' }, h('span', { class: 'gjsp-seo-label' }, label), control, hint ? h('small', { class: 'gjsp-seo-hint' }, hint) : null);

const input = (name: string, value: string, placeholder = ''): HTMLInputElement => h('input', { class: 'gjsp-input', type: 'text', name, value, placeholder }) as HTMLInputElement;

const area = (name: string, value: string, placeholder = '', rows = 2): HTMLTextAreaElement => {
  const el = h('textarea', { class: 'gjsp-input', name, rows: String(rows), placeholder }) as HTMLTextAreaElement;
  el.value = value;
  return el;
};

/** A language's label: its name in the editor's language and the code. */
const langLabel = (code: string, ui?: string): string => `${languageName(code, ui)} · ${code}`;

/** Text props of Schema.org that are translated (the others — prices, dates, codes — are one for every language). */
const SCHEMA_TEXT = ['author', 'brand', 'area', 'place', 'address'] as const;

/* ------------------------------------------------------------------ */
/*                          The site's languages                       */
/* ------------------------------------------------------------------ */

/**
 * The site's languages (`site.languages`): which are enabled, which is the
 * default, the address prefix of each; and per other language the site's
 * name, title template and default description.
 */
export function siteLanguagesSection(values: V, d: { t: Translator; language?: string }): RecordFormSection {
  const t = d.t;
  let l: LanguageSettings | null = normalizeLanguages(values[SITE_LANGUAGES_KEY]);
  const translations: Record<string, V> = {};
  (l?.enabled || []).forEach((c) => (translations[c] = { ...translationOf(values, c) }));
  const box = h('div', { class: 'gjsp-seo gjsp-langs' });

  const draw = (): void => {
    const prefixes = langPrefixes(l);
    const rows = (l?.enabled || []).map((c, i) => {
      const def = c === l!.default;
      const site = translations[c] || (translations[c] = {});
      const extra = def
        ? null
        : h(
            'details',
            { class: 'gjsp-lang-site' },
            h('summary', {}, t('langSiteTexts')),
            field(t('siteName'), bind(input(`${c}.name`, str(site[S.name]), str(values[S.name])), site, S.name)),
            field(t('titleTemplate'), bind(input(`${c}.tpl`, str(site[S.titleTemplate]), str(values[S.titleTemplate])), site, S.titleTemplate)),
            field(t('defaultDescription'), bind(area(`${c}.desc`, str(site[S.description]), str(values[S.description])), site, S.description))
          );
      return h(
        'li',
        { class: 'gjsp-lang', 'data-lang': c },
        h(
          'div',
          { class: 'gjsp-lang-row' },
          h('label', { class: 'gjsp-check', title: t('langDefault') }, h('input', { type: 'radio', name: 'gjsp-lang-default', checked: def, onchange: () => setDefault(c) }), ' ★'),
          h('span', { class: 'gjsp-lang-name' }, langLabel(c, d.language)),
          h('code', { class: 'gjsp-lang-prefix', title: t('langPrefix') }, (prefixes[c] || '') + '/…'),
          h('button', { type: 'button', class: 'gjsp-act', title: t('moveUp'), 'aria-label': t('moveUp'), disabled: i < 2 || def, onclick: () => move(c, -1) }, '↑'),
          h('button', { type: 'button', class: 'gjsp-act', title: t('remove'), 'aria-label': t('remove'), disabled: def, onclick: () => remove(c) }, '✕')
        ),
        extra
      );
    });
    const free = LANGUAGES.filter((x) => !l?.enabled.includes(x.code));
    const add = h(
      'select',
      { class: 'gjsp-select', 'data-role': 'add-lang', 'aria-label': t('langAdd'), onchange: (e: Event) => addLang((e.target as HTMLSelectElement).value) },
      h('option', { value: '' }, `+ ${t('langAdd')}`),
      ...free.map((x) => h('option', { value: x.code }, `${langLabel(x.code, d.language)} — ${x.native}`))
    );
    box.replaceChildren(h('p', { class: 'gjsp-seo-hint' }, t('langHint')), h('ul', { class: 'gjsp-lang-list' }, ...rows), add);
  };
  const bind = <E extends HTMLInputElement | HTMLTextAreaElement>(el: E, into: V, key: string): E => {
    el.addEventListener('input', () => (el.value.trim() ? (into[key] = el.value.trim()) : delete into[key]));
    return el;
  };
  const addLang = (code: string): void => {
    if (!code) return;
    l = normalizeLanguages(l ? { default: l.default, enabled: [...l.enabled, code] } : { default: str(values[S.lang]) || code, enabled: [str(values[S.lang]) || code, code] });
    draw();
  };
  const remove = (code: string): void => {
    if (!l) return;
    l = normalizeLanguages({ default: l.default, enabled: l.enabled.filter((c) => c !== code) });
    draw();
  };
  const setDefault = (code: string): void => {
    if (!l) return;
    l = normalizeLanguages({ default: code, enabled: l.enabled });
    draw();
  };
  const move = (code: string, by: number): void => {
    if (!l) return;
    const list = [...l.enabled];
    const i = list.indexOf(code);
    const j = i + by;
    if (j < 1 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    l = normalizeLanguages({ default: l.default, enabled: list });
    draw();
  };
  draw();

  return {
    id: 'site-languages',
    label: t('langs'),
    tab: true,
    el: box,
    values: () => {
      const out: V = {};
      // Keys of languages no longer enabled go.
      Object.keys(values)
        .filter((k) => k.startsWith(I18N_PREFIX))
        .forEach((k) => (out[k] = null));
      if (!l || l.enabled.length < 2) {
        out[SITE_LANGUAGES_KEY] = null;
        return out;
      }
      out[SITE_LANGUAGES_KEY] = l;
      out[S.lang] = l.default;
      l.enabled.forEach((c) => {
        const tr = translations[c];
        if (c !== l!.default && tr && Object.keys(tr).length) out[I18N_PREFIX + c] = { ...tr };
      });
      return out;
    },
  };
}

/* ------------------------------------------------------------------ */
/*                        A page's translations                        */
/* ------------------------------------------------------------------ */

export interface TranslationDeps {
  t: Translator;
  site(): Promise<V>;
  pages(): Promise<SeoPage[]>;
  language?: string;
  /** The page's other values as the form has them now (SEO, OG, Schema.org): the placeholders. */
  current?: () => V;
}

/**
 * The page in each other language of the site: its name (menus,
 * breadcrumbs), address, SEO, Open Graph and Schema.org texts, or "not in
 * this language". Empty fields take the default language's.
 */
export function pageTranslationsSection(rec: SeoPage, d: TranslationDeps): RecordFormSection {
  const t = d.t;
  const v = rec.values || {};
  let l: LanguageSettings | null = null;
  let pages: SeoPage[] = [];
  const state: Record<string, V> = {};
  const box = h('div', { class: 'gjsp-seo gjsp-translations' }, h('p', { class: 'gjsp-seo-hint' }, '…'));

  const defaults = (): V => ({ ...v, ...(d.current?.() || {}) });
  const draw = (): void => {
    if (!l || l.enabled.length < 2) {
      box.replaceChildren(h('p', { class: 'gjsp-seo-hint' }, t('langNone')));
      return;
    }
    const base = defaults();
    const props = (base[K.schemaProps] && typeof base[K.schemaProps] === 'object' ? base[K.schemaProps] : {}) as V;
    const blocks = l.enabled
      .filter((c) => c !== l!.default)
      .map((c) => {
        const tr = state[c] || (state[c] = JSON.parse(JSON.stringify(translationOf(v, c))) as V);
        const trProps = (tr[K.schemaProps] && typeof tr[K.schemaProps] === 'object' ? tr[K.schemaProps] : (tr[K.schemaProps] = {})) as V;
        const set = (key: string, val: unknown): void => {
          if (val === '' || val === null || val === undefined || val === false) delete tr[key];
          else tr[key] = val;
        };
        const txt = (key: string, label: string, ph: string, multi = false): HTMLElement => {
          const el = multi ? area(`${c}.${key}`, str(tr[key]), ph) : input(`${c}.${key}`, str(tr[key]), ph);
          el.addEventListener('input', () => set(key, el.value.trim()));
          return field(label, el);
        };
        const hidden = h('input', { type: 'checkbox', name: `${c}.hidden`, checked: tr.hidden === true }) as HTMLInputElement;
        const fields = h('div', { class: 'gjsp-lang-fields', hidden: tr.hidden === true });
        hidden.addEventListener('change', () => {
          set('hidden', hidden.checked);
          fields.hidden = hidden.checked;
        });
        const prefix = langPrefixes(l)[c] || '';
        const slug = input(`${c}.slug`, str(tr.slug), rec.slug || '/');
        const slugUrl = h('small', { class: 'gjsp-seo-hint' });
        const drawUrl = (): void => {
          slugUrl.textContent = pathIn({ slug: rec.slug, values: { [I18N_PREFIX + c]: tr } }, c, l);
        };
        slug.addEventListener('input', () => {
          set('slug', slug.value.trim() ? normalizeSlug(slug.value) : '');
          drawUrl();
        });
        slug.addEventListener('change', () => (slug.value = str(tr.slug)));
        drawUrl();
        const schema = SCHEMA_TEXT.filter((k) => str(props[k])).map((k) => {
          const el = input(`${c}.schema.${k}`, str(trProps[k]), str(props[k]));
          el.addEventListener('input', () => (el.value.trim() ? (trProps[k] = el.value.trim()) : delete trProps[k]));
          return field(`Schema.org · ${k}`, el);
        });
        const faq = Array.isArray(props.faq) ? (props.faq as Array<{ q: string; a: string }>) : [];
        const faqEls = faq.map((qa, i) => {
          const list = (Array.isArray(trProps.faq) ? trProps.faq : (trProps.faq = faq.map(() => ({ q: '', a: '' })))) as Array<{ q: string; a: string }>;
          const cur = list[i] || (list[i] = { q: '', a: '' });
          const q = input(`${c}.faq.${i}.q`, cur.q, qa.q);
          const a = area(`${c}.faq.${i}.a`, cur.a, qa.a);
          q.addEventListener('input', () => (cur.q = q.value.trim()));
          a.addEventListener('input', () => (cur.a = a.value.trim()));
          return h('div', { class: 'gjsp-seo-qa' }, q, a);
        });
        function fill(): void {
          fields.replaceChildren(
            h('div', { class: 'gjsp-seo-grid' }, txt('name', t('langName'), rec.name), field(t('langSlug'), slug)),
            slugUrl,
            txt(K.title, t('seoTitle'), str(base[K.title]) || rec.name),
            txt(K.description, t('seoDescription'), str(base[K.description]), true),
            txt(K.keywords, t('seoKeywords'), str(base[K.keywords])),
            txt(K.canonical, t('seoCanonical'), ''),
            txt(K.ogTitle, t('ogTitle'), str(base[K.ogTitle])),
            txt(K.ogDescription, t('ogDescription'), str(base[K.ogDescription]), true),
            txt(K.ogImageAlt, t('ogImageAlt'), str(base[K.ogImageAlt])),
            ...schema,
            ...(faqEls.length ? [field(t('schemaFaq'), h('div', { class: 'gjsp-seo-faq' }, ...faqEls))] : [])
          );
        }
        fill();
        return h(
          'details',
          { class: 'gjsp-lang-page', 'data-lang': c, open: true },
          h('summary', {}, langLabel(c, d.language), ' ', h('code', { class: 'gjsp-lang-prefix' }, prefix + '/…')),
          h('label', { class: 'gjsp-check' }, hidden, ' ', t('langHidden')),
          fields
        );
      });
    box.replaceChildren(h('p', { class: 'gjsp-seo-hint' }, t('langPageHint')), ...blocks);
  };
  void Promise.all([d.site().catch(() => ({})), d.pages().catch(() => [])]).then(([s, p]) => {
    l = siteLanguages(s as V);
    pages = p as SeoPage[];
    draw();
  });

  const values = (): V => {
    const out: V = {};
    if (!l) return out;
    l.enabled.forEach((c) => {
      if (c === l!.default || !state[c]) return;
      const tr = JSON.parse(JSON.stringify(state[c])) as V;
      const p = tr[K.schemaProps] as V | undefined;
      if (p) {
        if (Array.isArray(p.faq) && !(p.faq as Array<{ q: string; a: string }>).some((x) => x.q || x.a)) delete p.faq;
        if (!Object.keys(p).length) delete tr[K.schemaProps];
      }
      out[I18N_PREFIX + c] = Object.keys(tr).length ? tr : null;
    });
    return out;
  };

  return {
    id: 'translations',
    label: t('translations'),
    tab: true,
    el: box,
    values,
    validate: () => {
      if (!l) return null;
      const me = { id: rec.id, slug: rec.slug, values: { ...v, ...values() } };
      const all = [...pages.filter((p) => p.id !== rec.id), me];
      const clash = slugClashes(all, l).find((x) => x.ids.includes(rec.id) && x.lang !== l!.default);
      return clash ? fmt(t('langSlugTaken'), pathIn(me, clash.lang, l), langLabel(clash.lang, d.language)) : null;
    },
  };
}
