import { describe, expect, it } from 'vitest';
import { alternates, seoHead, seoJsonLd, type SeoPage } from '../src/seo/head';
import { inLanguage, langOfPath, langPrefixes, localizePage, normalizeLanguages, pathIn, siteLanguages, slugClashes, valuesIn } from '../src/seo/languages';
import { pageTranslationsSection, siteLanguagesSection } from '../src/ui/translations';
import { locales, type Translator } from '../src/i18n';

const langs = { default: 'uk-ua', enabled: ['uk-ua', 'en-gb', 'pl-pl'] };
const site = {
  'site.url': 'https://shop.test',
  'site.name': 'Магазин',
  'site.lang': 'uk-ua',
  'seo.title_template': '%s — Магазин',
  'site.languages': langs,
  'i18n.en-gb': { 'site.name': 'Shop', 'seo.title_template': '%s — Shop' },
};
const home: SeoPage = { id: 'h', name: 'Головна', slug: '/', kind: 'page', values: { 'i18n.en-gb': { name: 'Home' } } };
const page: SeoPage = {
  id: 'p',
  name: 'Кавомолка',
  slug: '/kavomolka',
  parentId: 'h',
  kind: 'page',
  values: {
    'seo.title': 'Кавомолка ручна',
    'seo.description': 'Опис',
    'seo.canonical': 'https://shop.test/kavomolka',
    'schema.type': 'Product',
    'schema.props': { brand: 'Бренд', price: '1200', currency: 'UAH' },
    'i18n.en-gb': { name: 'Grinder', slug: '/grinder', 'seo.title': 'Hand grinder', 'schema.props': { brand: 'Brand' } },
    'i18n.pl-pl': { hidden: true },
  },
};

describe('languages (pure)', () => {
  it('prefixes: none for the default, the language, the whole code for two regions', () => {
    expect(langPrefixes(langs)).toEqual({ 'uk-ua': '', 'en-gb': '/en', 'pl-pl': '/pl' });
    const two = normalizeLanguages({ default: 'uk-ua', enabled: ['en-gb', 'en-us', 'uk-ua'] })!;
    expect(two.enabled[0]).toBe('uk-ua');
    expect(langPrefixes(two)).toEqual({ 'uk-ua': '', 'en-gb': '/en-gb', 'en-us': '/en-us' });
    expect(langOfPath('/en/grinder', langs)).toEqual({ lang: 'en-gb', path: '/grinder' });
    expect(langOfPath('/en', langs)).toEqual({ lang: 'en-gb', path: '/' });
    expect(langOfPath('/enterprise', langs)).toEqual({ lang: 'uk-ua', path: '/enterprise' });
    expect(siteLanguages({})).toBeNull();
  });

  it('a page in a language: name, address, values; hidden; canonical not inherited', () => {
    expect(pathIn(page, 'en-gb', langs)).toBe('/en/grinder');
    expect(pathIn(page, 'uk-ua', langs)).toBe('/kavomolka');
    expect(pathIn(home, 'en-gb', langs)).toBe('/en');
    expect(inLanguage(page.values, 'pl-pl', langs)).toBe(false);
    expect(localizePage(page, 'pl-pl', langs)).toBeNull();
    const en = localizePage(page, 'en-gb', langs)!;
    expect(en.name).toBe('Grinder');
    expect(en.values!['seo.title']).toBe('Hand grinder');
    expect(en.values!['seo.description']).toBe('Опис'); // untranslated: the default's
    expect(en.values!['seo.canonical']).toBeUndefined();
    expect(en.values!['schema.props']).toEqual({ brand: 'Brand', price: '1200', currency: 'UAH' });
    expect(Object.keys(valuesIn(page.values, 'uk-ua', langs)).some((k) => k.startsWith('i18n.'))).toBe(false);
  });

  it('slugs taken twice in a language', () => {
    const other = { id: 'o', slug: '/grinder', values: {} };
    expect(slugClashes([page, other], langs)).toEqual([{ lang: 'en-gb', slug: '/grinder', ids: ['p', 'o'] }]);
    expect(slugClashes([page, { ...other, values: { 'i18n.en-gb': { slug: '/other' } } }], langs)).toEqual([]);
  });

  it('the head in a language: translated texts, prefixed address, hreflang alternates, x-default', () => {
    const uk = seoHead({ page, site, pages: [home, page] });
    expect(uk).toContain('<title>Кавомолка ручна — Магазин</title>');
    expect(uk).toContain('<link rel="canonical" href="https://shop.test/kavomolka">');
    expect(uk).toContain('<link rel="alternate" hreflang="uk-ua" href="https://shop.test/kavomolka">');
    expect(uk).toContain('<link rel="alternate" hreflang="en-gb" href="https://shop.test/en/grinder">');
    expect(uk).toContain('<link rel="alternate" hreflang="x-default" href="https://shop.test/kavomolka">');
    expect(uk).not.toContain('hreflang="pl-pl"');
    expect(uk).toContain('<meta property="og:locale" content="uk_UA">');

    const en = seoHead({ page, site, pages: [home, page], lang: 'en-gb' });
    expect(en).toContain('<title>Hand grinder — Shop</title>');
    expect(en).toContain('<link rel="canonical" href="https://shop.test/en/grinder">');
    expect(en).toContain('<meta property="og:site_name" content="Shop">');
    expect(en).toContain('<meta property="og:locale" content="en_GB">');
    expect(en).toContain('hreflang="uk-ua"');
    expect(seoHead({ page, site, lang: 'pl-pl' })).toBe('');

    const ld = JSON.stringify(seoJsonLd({ page, site, pages: [home, page], lang: 'en-gb' }));
    expect(ld).toContain('"inLanguage":"en-gb"');
    expect(ld).toContain('"name":"Brand"');
    expect(ld).toContain('"item":"https://shop.test/en"');
    expect(alternates(page, { 'site.url': 'https://shop.test' })).toEqual([]); // one language
  });
});

describe('the forms', () => {
  const t: Translator = (k) => locales.en[k];

  it("the site's languages: add, default, prefixes, per-language site texts", () => {
    const sec = siteLanguagesSection({ 'site.lang': 'uk-ua' }, { t });
    const add = sec.el.querySelector('[data-role="add-lang"]') as HTMLSelectElement;
    add.value = 'en-gb';
    add.dispatchEvent(new Event('change'));
    expect(sec.el.querySelectorAll('.gjsp-lang')).toHaveLength(2);
    expect(sec.el.textContent).toContain('/en/…');
    const name = sec.el.querySelector('input[name="en-gb.name"]') as HTMLInputElement;
    name.value = 'Shop';
    name.dispatchEvent(new Event('input'));
    expect(sec.values!()).toEqual({ 'site.languages': { default: 'uk-ua', enabled: ['uk-ua', 'en-gb'] }, 'site.lang': 'uk-ua', 'i18n.en-gb': { 'site.name': 'Shop' } });
  });

  it("a page's translations: values per language, hidden, a taken address stops the save", async () => {
    const other: SeoPage = { id: 'o', name: 'O', slug: '/used', kind: 'page' };
    const sec = pageTranslationsSection({ ...page, values: { 'seo.title': 'Т' } }, { t, site: async () => site, pages: async () => [page, other] });
    await new Promise((r) => setTimeout(r, 0));
    const slug = sec.el.querySelector('input[name="en-gb.slug"]') as HTMLInputElement;
    slug.value = 'Used';
    slug.dispatchEvent(new Event('input'));
    const title = sec.el.querySelector('input[name="en-gb.seo.title"]') as HTMLInputElement;
    title.value = 'T';
    title.dispatchEvent(new Event('input'));
    const hidden = sec.el.querySelector('input[name="pl-pl.hidden"]') as HTMLInputElement;
    hidden.checked = true;
    hidden.dispatchEvent(new Event('change'));
    expect(sec.values!()).toEqual({ 'i18n.en-gb': { slug: '/used', 'seo.title': 'T' }, 'i18n.pl-pl': { hidden: true } });
    expect(sec.validate!()).toMatch(/\/en\/used/);
    slug.value = 'free';
    slug.dispatchEvent(new Event('input'));
    expect(sec.validate!()).toBeNull();
  });
});
