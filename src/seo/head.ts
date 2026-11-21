/**
 * What a page puts into `<head>`: the title, meta description and robots,
 * the canonical link, Open Graph and X (Twitter) cards, and Schema.org as
 * one JSON-LD `@graph`. Pure functions (no DOM, no GrapesJS): the editor
 * uses them for publishing and the archive, a server may use them too.
 *
 * Everything comes from the values of the page and of the site
 * (`PageRecord.values`; the site's: the site record's `values` in remote
 * mode, the shared key `pages.site` in local mode). The keys are flat, as
 * the rest of the page values (`seo.title`…), so a server reads them as is.
 */

import { inLanguage, type LanguageSettings, localizePage, localizeSite, pathIn, siteLanguages, translationOf } from './languages';

/** Keys of a page's values. */
export const SEO_KEYS = {
  title: 'seo.title',
  description: 'seo.description',
  keywords: 'seo.keywords',
  canonical: 'seo.canonical',
  noindex: 'seo.noindex',
  nofollow: 'seo.nofollow',
  ogTitle: 'og.title',
  ogDescription: 'og.description',
  ogImage: 'og.image',
  ogImageAlt: 'og.image_alt',
  ogType: 'og.type',
  twitterCard: 'twitter.card',
  schemaType: 'schema.type',
  schemaProps: 'schema.props',
  schemaExtra: 'schema.extra',
  schemaBreadcrumbs: 'schema.breadcrumbs',
} as const;

/** Keys of the site's values (defaults of every page, the WebSite and Organization nodes). */
export const SITE_KEYS = {
  url: 'site.url',
  name: 'site.name',
  lang: 'site.lang',
  titleTemplate: 'seo.title_template',
  description: 'seo.description',
  ogImage: 'og.image',
  twitterSite: 'twitter.site',
  orgName: 'org.name',
  orgLogo: 'org.logo',
  orgSameAs: 'org.same_as',
} as const;

/** Local mode keeps the site's values under this shared key. */
export const SITE_SHARED_KEY = 'pages.site';

export const OG_TYPES = ['website', 'article', 'product', 'profile'] as const;

/** Schema.org types the editor offers; `none` — no node for the page. */
export const SCHEMA_TYPES = [
  'WebPage',
  'AboutPage',
  'ContactPage',
  'CollectionPage',
  'Article',
  'BlogPosting',
  'NewsArticle',
  'Product',
  'Service',
  'Event',
  'FAQPage',
  'LocalBusiness',
  'Organization',
  'Person',
] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

const ARTICLES = new Set(['Article', 'BlogPosting', 'NewsArticle']);

/** Per type: the props the form shows (`schema.props.<key>`). */
export const SCHEMA_FIELDS: Record<string, string[]> = {
  Article: ['author', 'published'],
  BlogPosting: ['author', 'published'],
  NewsArticle: ['author', 'published'],
  Product: ['brand', 'sku', 'price', 'currency', 'availability'],
  Service: ['area', 'price', 'currency'],
  Event: ['start', 'end', 'place', 'address', 'price', 'currency'],
  FAQPage: ['faq'],
  LocalBusiness: ['address', 'phone', 'hours', 'priceRange'],
  Organization: ['sameAs'],
  Person: ['sameAs'],
};

export interface FaqItem {
  q: string;
  a: string;
}

/** The fields of a record the head needs. */
export interface SeoPage {
  id: string;
  name: string;
  slug?: string;
  parentId?: string | null;
  kind?: string;
  values?: Record<string, unknown>;
  publishedAt?: string | null;
  updatedAt?: number | string;
}

export interface SeoInput {
  page: SeoPage;
  /** The site's values. */
  site?: Record<string, unknown> | null;
  /** All pages (for breadcrumbs); optional. */
  pages?: SeoPage[];
  /**
   * The language of the head (a site with `site.languages`): the page's
   * translation, its address with the language prefix, `hreflang`
   * alternates. Default: the site's default language.
   */
  lang?: string;
}

/**
 * The input as it is in its language: the page, the site and the pages
 * localized (pages hidden in the language left out). `page` is null when
 * the page does not exist in the language.
 */
export function localizeInput(input: SeoInput): { page: SeoPage | null; site: V; pages?: SeoPage[]; lang: string; languages: LanguageSettings | null } {
  const site = input.site || {};
  const l = siteLanguages(site);
  if (!l) return { page: input.page, site, pages: input.pages, lang: '', languages: null };
  const lang = input.lang && l.enabled.includes(input.lang) ? input.lang : l.default;
  return {
    page: localizePage(input.page, lang, l),
    site: localizeSite(site, lang, l),
    pages: input.pages?.map((p) => localizePage(p, lang, l)).filter((p): p is SeoPage => !!p),
    lang,
    languages: l,
  };
}

/**
 * The page in every language it exists in: `[{ lang, href }]` and the
 * default one again as `x-default` (absolute with the site's address).
 */
export function alternates(page: SeoPage, site: V | null | undefined): Array<{ hreflang: string; href: string }> {
  const l = siteLanguages(site);
  if (!l) return [];
  const base = str(site?.[SITE_KEYS.url]);
  const out: Array<{ hreflang: string; href: string }> = [];
  l.enabled.forEach((c) => {
    if (!inLanguage(page.values, c, l)) return;
    const own = c === l.default ? str(page.values?.[SEO_KEYS.canonical]) : str(translationOf(page.values, c)[SEO_KEYS.canonical]);
    out.push({ hreflang: c, href: absolute(own || pathIn(page, c, l), base) });
  });
  const def = out.find((a) => a.hreflang === l.default);
  if (def && out.length > 1) out.push({ hreflang: 'x-default', href: def.href });
  return out.length > 1 ? out : [];
}

type V = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

const escAttr = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** `https://site.test` + `/a/b`; absolute and data URLs as they are. */
export function absolute(url: string, base: string): string {
  const u = url.trim();
  if (!u || /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//')) return u;
  const b = base.trim().replace(/\/+$/, '');
  if (!b) return u;
  return `${b}${u.startsWith('/') ? '' : '/'}${u}`;
}

/** The page's own address: its canonical, or the site's address + its slug. */
export function pageUrl(page: SeoPage, site?: V | null): string {
  const canonical = str(page.values?.[SEO_KEYS.canonical]);
  const base = str(site?.[SITE_KEYS.url]);
  if (canonical) return absolute(canonical, base);
  if (!base) return page.slug || '';
  return absolute(page.slug || '/', base);
}

/** `ru` → `ru_RU`, `en-us` → `en_US` (og:locale). */
export function ogLocale(lang: string): string {
  const l = lang.trim().replace('-', '_');
  if (!l) return '';
  const [a, b] = l.split('_');
  if (b) return `${a.toLowerCase()}_${b.toUpperCase()}`;
  const known: Record<string, string> = { en: 'en_US', uk: 'uk_UA', he: 'he_IL', fa: 'fa_IR', zh: 'zh_CN', ko: 'ko_KR', vi: 'vi_VN', el: 'el_GR', nb: 'nb_NO', se: 'sv_SE', sv: 'sv_SE', ca: 'ca_ES', bs: 'bs_BA', ar: 'ar_AR', pt: 'pt_BR', ja: 'ja_JP', cs: 'cs_CZ', da: 'da_DK', kk: 'kk_KZ' };
  return known[a.toLowerCase()] || `${a.toLowerCase()}_${a.toUpperCase()}`;
}

/** The title as `<title>` shows it (with the site's template, `%s` — the page title). */
export function fullTitle(page: SeoPage, site?: V | null): string {
  const own = str(page.values?.[SEO_KEYS.title]) || page.name || '';
  const tpl = str(site?.[SITE_KEYS.titleTemplate]);
  return tpl && tpl.includes('%s') ? tpl.replace('%s', own) : own;
}

/** A value of the page, or the site's default. */
const pick = (page: SeoPage, site: V | null | undefined, key: string, siteKey?: string): string => str(page.values?.[key]) || (siteKey ? str(site?.[siteKey]) : '');

/** Lines or an array → links. */
export const sameAsList = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(str) : str(v).split(/\r?\n/))
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));

const parseExtra = (v: unknown): unknown => {
  if (v && typeof v === 'object') return v;
  const s = str(v);
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** Checks the extra JSON-LD of the form: the error message, or null. */
export function extraError(text: string): string | null {
  if (!text.trim()) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? null : 'an object or an array is expected';
  } catch (e) {
    return (e as Error).message;
  }
}

const availability = (v: string): string => {
  const known: Record<string, string> = { in_stock: 'InStock', out_of_stock: 'OutOfStock', pre_order: 'PreOrder' };
  return v ? `https://schema.org/${known[v] || v}` : '';
};

const isoDate = (v: unknown): string => {
  if (v == null || v === '') return '';
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};

const clean = <T extends V>(o: T): T => {
  Object.keys(o).forEach((k) => {
    const v = o[k];
    if (v === '' || v == null || (Array.isArray(v) && !v.length)) delete o[k];
  });
  return o;
};

/** The pages from the root to this one (by `parentId`). */
function trail(page: SeoPage, pages: SeoPage[]): SeoPage[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const out: SeoPage[] = [];
  let cur: SeoPage | undefined = page;
  while (cur && out.length < 32 && !out.includes(cur)) {
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  // The home page leads every trail that does not start with it.
  const home = pages.find((p) => p.slug === '/' && (p.kind || 'page') === 'page');
  if (home && out[0] !== home && out[0]?.id !== home.id) out.unshift(home);
  return out;
}

/** The Schema.org graph of a page: WebSite, Organization, the page's node, BreadcrumbList, extra nodes. */
export function seoJsonLd(input: SeoInput): Record<string, unknown> | null {
  const loc = localizeInput(input);
  if (!loc.page) return null;
  return jsonLdOf(loc.page, loc.site, loc.pages);
}

function jsonLdOf(page: SeoPage, site: V, pages?: SeoPage[]): Record<string, unknown> | null {
  const v = page.values || {};
  const s = site || {};
  const base = str(s[SITE_KEYS.url]).replace(/\/+$/, '');
  const url = pageUrl(page, s);
  const graph: V[] = [];
  const siteName = str(s[SITE_KEYS.name]);
  const lang = str(s[SITE_KEYS.lang]);
  const websiteId = base ? `${base}/#website` : '';
  const orgId = base ? `${base}/#organization` : '';

  if (siteName || base) graph.push(clean({ '@type': 'WebSite', '@id': websiteId, name: siteName, url: base ? `${base}/` : '', inLanguage: lang }));
  const orgName = str(s[SITE_KEYS.orgName]);
  if (orgName) {
    const logo = absolute(str(s[SITE_KEYS.orgLogo]), base);
    graph.push(clean({ '@type': 'Organization', '@id': orgId, name: orgName, url: base ? `${base}/` : '', logo: logo.startsWith('data:') ? '' : logo, sameAs: sameAsList(s[SITE_KEYS.orgSameAs]) }));
  }

  const type = str(v[SEO_KEYS.schemaType]) || 'WebPage';
  const props = (v[SEO_KEYS.schemaProps] && typeof v[SEO_KEYS.schemaProps] === 'object' ? v[SEO_KEYS.schemaProps] : {}) as V;
  const p = (k: string): string => str(props[k]);
  const name = str(v[SEO_KEYS.title]) || page.name;
  const description = pick(page, s, SEO_KEYS.description, SITE_KEYS.description);
  const imageRaw = pick(page, s, SEO_KEYS.ogImage, SITE_KEYS.ogImage);
  const image = imageRaw.startsWith('data:') ? '' : absolute(imageRaw, base);
  const crumbs = pages && v[SEO_KEYS.schemaBreadcrumbs] !== false ? trail(page, pages) : [];
  const crumbId = url && crumbs.length > 1 ? `${url}#breadcrumb` : '';

  let node: V | null = null;
  if (type !== 'none') {
    node = { '@type': type, '@id': url ? `${url}#page` : '', name, description, url, image, inLanguage: lang };
    const offers = (): V | '' => (p('price') ? clean({ '@type': 'Offer', price: p('price'), priceCurrency: p('currency'), url, availability: availability(p('availability')) }) : '');
    if (type.endsWith('Page') && type !== 'FAQPage') Object.assign(node, { isPartOf: websiteId ? { '@id': websiteId } : '', breadcrumb: crumbId ? { '@id': crumbId } : '' });
    if (ARTICLES.has(type))
      Object.assign(node, {
        headline: name.slice(0, 110),
        author: p('author') ? { '@type': 'Person', name: p('author') } : orgName ? { '@id': orgId || undefined, '@type': 'Organization', name: orgName } : '',
        publisher: orgName ? (orgId ? { '@id': orgId } : { '@type': 'Organization', name: orgName }) : '',
        datePublished: isoDate(p('published') || page.publishedAt),
        dateModified: isoDate(page.updatedAt),
        mainEntityOfPage: url,
      });
    if (type === 'Product') Object.assign(node, { brand: p('brand') ? { '@type': 'Brand', name: p('brand') } : '', sku: p('sku'), offers: offers() });
    if (type === 'Service') Object.assign(node, { areaServed: p('area'), provider: orgName ? (orgId ? { '@id': orgId } : { '@type': 'Organization', name: orgName }) : '', offers: offers() });
    if (type === 'Event')
      Object.assign(node, {
        startDate: p('start'),
        endDate: p('end'),
        location: p('place') || p('address') ? clean({ '@type': 'Place', name: p('place'), address: p('address') }) : '',
        offers: offers(),
      });
    if (type === 'FAQPage') {
      const faq = (Array.isArray(props.faq) ? props.faq : []) as FaqItem[];
      node.mainEntity = faq
        .filter((x) => x && str(x.q) && str(x.a))
        .map((x) => ({ '@type': 'Question', name: str(x.q), acceptedAnswer: { '@type': 'Answer', text: str(x.a) } }));
    }
    if (type === 'LocalBusiness') Object.assign(node, { address: p('address'), telephone: p('phone'), openingHours: p('hours'), priceRange: p('priceRange') });
    if (type === 'Organization' || type === 'Person') Object.assign(node, { sameAs: sameAsList(props.sameAs), ...(type === 'Organization' ? { logo: image } : {}) });
    clean(node);
  }

  const extra = parseExtra(v[SEO_KEYS.schemaExtra]);
  if (node && extra && !Array.isArray(extra) && typeof extra === 'object') Object.assign(node, extra);
  if (node) graph.push(node);
  if (crumbId)
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': crumbId,
      itemListElement: crumbs.map((c, i) => clean({ '@type': 'ListItem', position: i + 1, name: str(c.values?.[SEO_KEYS.title]) || c.name, item: pageUrl(c, s) })),
    });
  if (Array.isArray(extra)) extra.forEach((x) => x && typeof x === 'object' && graph.push(x as V));
  else if (!node && extra && typeof extra === 'object') graph.push(extra as V);
  return graph.length ? { '@context': 'https://schema.org', '@graph': graph } : null;
}

/** JSON-LD as a `<script>` (`</script>` and `<!--` inside cannot break out). */
export function jsonLdScript(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

export interface HeadOptions {
  /** Leave out the `<title>` (a server that writes its own). */
  title?: boolean;
  /** Leave out JSON-LD. */
  jsonLd?: boolean;
}

/** The tags of `<head>`, one per line ('' when the page does not exist in the language). */
export function seoHead(input: SeoInput, o: HeadOptions = {}): string {
  const loc = localizeInput(input);
  if (!loc.page) return '';
  const page = loc.page;
  const site = loc.site;
  const v = page.values || {};
  const base = str(site[SITE_KEYS.url]);
  const out: string[] = [];
  const meta = (attr: 'name' | 'property', key: string, content: string): void => {
    if (content) out.push(`<meta ${attr}="${key}" content="${escAttr(content)}">`);
  };
  const title = fullTitle(page, site);
  const own = str(v[SEO_KEYS.title]) || page.name;
  const description = pick(page, site, SEO_KEYS.description, SITE_KEYS.description);
  const url = pageUrl(page, site);

  if (o.title !== false && title) out.push(`<title>${escAttr(title)}</title>`);
  meta('name', 'description', description);
  meta('name', 'keywords', str(v[SEO_KEYS.keywords]));
  const robots = [v[SEO_KEYS.noindex] === true ? 'noindex' : '', v[SEO_KEYS.nofollow] === true ? 'nofollow' : ''].filter(Boolean);
  meta('name', 'robots', robots.join(', '));
  if (url && /^https?:\/\//i.test(url)) out.push(`<link rel="canonical" href="${escAttr(url)}">`);
  alternates(input.page, input.site).forEach((a) => out.push(`<link rel="alternate" hreflang="${escAttr(a.hreflang)}" href="${escAttr(a.href)}">`));

  const imgRaw = pick(page, site, SEO_KEYS.ogImage, SITE_KEYS.ogImage);
  const image = imgRaw.startsWith('data:') ? '' : absolute(imgRaw, base);
  meta('property', 'og:type', str(v[SEO_KEYS.ogType]) || (ARTICLES.has(str(v[SEO_KEYS.schemaType])) ? 'article' : 'website'));
  meta('property', 'og:title', str(v[SEO_KEYS.ogTitle]) || own);
  meta('property', 'og:description', str(v[SEO_KEYS.ogDescription]) || description);
  if (/^https?:\/\//i.test(url)) meta('property', 'og:url', url);
  meta('property', 'og:image', image);
  if (image) meta('property', 'og:image:alt', str(v[SEO_KEYS.ogImageAlt]));
  meta('property', 'og:site_name', str(site[SITE_KEYS.name]));
  meta('property', 'og:locale', ogLocale(str(site[SITE_KEYS.lang])));
  meta('name', 'twitter:card', str(v[SEO_KEYS.twitterCard]) || (image ? 'summary_large_image' : 'summary'));
  const tw = str(site[SITE_KEYS.twitterSite]);
  meta('name', 'twitter:site', tw && !tw.startsWith('@') ? `@${tw}` : tw);

  if (o.jsonLd !== false) {
    const ld = jsonLdOf(page, site, loc.pages);
    if (ld) out.push(jsonLdScript(ld));
  }
  return out.join('\n');
}
