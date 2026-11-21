import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'grapesjs';
import { unzipSync, strFromU8 } from 'fflate';
import { absolute, ogLocale, pageUrl, seoHead, seoJsonLd, SITE_SHARED_KEY, type SeoPage } from '../src/seo/head';
import { SHARED_META } from '../src/core/SharedData';
import { MemoryPageStore } from '../src/store/MemoryPageStore';
import { click, createEditor, destroyEditor, settle, sidebar, tick } from './helpers/editor';
import { FakeServerV2 } from './helpers/fakeServerV2';

const site = {
  'site.url': 'https://shop.test/',
  'site.name': 'Shop',
  'site.lang': 'uk',
  'seo.title_template': '%s — Shop',
  'seo.description': 'The best shop',
  'og.image': '/img/default.png',
  'twitter.site': 'shop',
  'org.name': 'Shop LLC',
  'org.logo': '/logo.png',
  'org.same_as': ['https://facebook.com/shop', 'not a link'],
};
const home: SeoPage = { id: 'h', name: 'Home', slug: '/', kind: 'page' };
const cat: SeoPage = { id: 'c', name: 'Catalog', slug: '/catalog', parentId: 'h', kind: 'page', values: { 'seo.title': 'All goods' } };

describe('head and JSON-LD (pure)', () => {
  it('title with the template, defaults of the site, robots, canonical, Open Graph, X', () => {
    const page: SeoPage = {
      id: 'p',
      name: 'Grinder',
      slug: '/catalog/grinder',
      parentId: 'c',
      values: { 'seo.title': 'Coffee "grinder"', 'seo.noindex': true, 'og.image': 'data:image/png;base64,xx', 'seo.keywords': 'coffee, grinder' },
    };
    const head = seoHead({ page, site, pages: [home, cat, page] });
    expect(head).toContain('<title>Coffee &quot;grinder&quot; — Shop</title>');
    expect(head).toContain('<meta name="description" content="The best shop">');
    expect(head).toContain('<meta name="keywords" content="coffee, grinder">');
    expect(head).toContain('<meta name="robots" content="noindex">');
    expect(head).toContain('<link rel="canonical" href="https://shop.test/catalog/grinder">');
    expect(head).toContain('<meta property="og:title" content="Coffee &quot;grinder&quot;">');
    // a data: URL is of no use to a crawler: the site's default image is not used either (the page has its own)
    expect(head).not.toContain('og:image');
    expect(head).toContain('<meta property="og:locale" content="uk_UA">');
    expect(head).toContain('<meta name="twitter:card" content="summary">');
    expect(head).toContain('<meta name="twitter:site" content="@shop">');
    expect(seoHead({ page: home, site }, { title: false, jsonLd: false })).not.toMatch(/<title>|ld\+json/);
    expect(seoHead({ page: home, site })).toContain('<meta property="og:image" content="https://shop.test/img/default.png">');
  });

  it('the graph: WebSite, Organization, the page node by type, breadcrumbs, extra nodes', () => {
    const page: SeoPage = {
      id: 'p',
      name: 'Grinder',
      slug: '/catalog/grinder',
      parentId: 'c',
      values: {
        'schema.type': 'Product',
        'schema.props': { brand: 'Acme', sku: 'G-1', price: '1200', currency: 'UAH', availability: 'in_stock', author: 'ignored' },
        'schema.extra': '{"aggregateRating":{"@type":"AggregateRating","ratingValue":4.8,"reviewCount":3}}',
      },
    };
    const ld = seoJsonLd({ page, site, pages: [home, cat, page] }) as any;
    const types = ld['@graph'].map((n: any) => n['@type']);
    expect(types).toEqual(['WebSite', 'Organization', 'Product', 'BreadcrumbList']);
    const [ws, org, product, crumbs] = ld['@graph'];
    expect(ws).toEqual({ '@type': 'WebSite', '@id': 'https://shop.test/#website', name: 'Shop', url: 'https://shop.test/', inLanguage: 'uk' });
    expect(org).toMatchObject({ name: 'Shop LLC', logo: 'https://shop.test/logo.png', sameAs: ['https://facebook.com/shop'] });
    expect(product).toMatchObject({
      '@id': 'https://shop.test/catalog/grinder#page',
      brand: { '@type': 'Brand', name: 'Acme' },
      sku: 'G-1',
      offers: { '@type': 'Offer', price: '1200', priceCurrency: 'UAH', availability: 'https://schema.org/InStock' },
      aggregateRating: { ratingValue: 4.8 },
      image: 'https://shop.test/img/default.png',
    });
    expect(product.author).toBeUndefined();
    expect(crumbs.itemListElement.map((i: any) => [i.position, i.name, i.item])).toEqual([
      [1, 'Home', 'https://shop.test/'],
      [2, 'All goods', 'https://shop.test/catalog'],
      [3, 'Grinder', 'https://shop.test/catalog/grinder'],
    ]);
  });

  it('FAQ, articles with dates, no node, an array of extra nodes, a script that cannot break out', () => {
    const faq = seoJsonLd({ page: { ...home, values: { 'schema.type': 'FAQPage', 'schema.props': { faq: [{ q: 'Why?', a: 'Because.' }, { q: '', a: 'x' }] } } } }) as any;
    expect(faq['@graph'][0].mainEntity).toEqual([{ '@type': 'Question', name: 'Why?', acceptedAnswer: { '@type': 'Answer', text: 'Because.' } }]);
    const art = seoJsonLd({ page: { ...home, publishedAt: '2026-11-01T10:00:00Z', updatedAt: Date.UTC(2026, 10, 2), values: { 'schema.type': 'BlogPosting', 'schema.props': { author: 'Ann' } } }, site }) as any;
    expect(art['@graph'][2]).toMatchObject({ headline: 'Home', author: { '@type': 'Person', name: 'Ann' }, publisher: { '@id': 'https://shop.test/#organization' }, datePublished: '2026-11-01T10:00:00.000Z', dateModified: '2026-11-02T00:00:00.000Z' });
    expect(seoHead({ page: { ...home, values: { 'schema.type': 'BlogPosting' } } })).toContain('<meta property="og:type" content="article">');
    expect(seoJsonLd({ page: { ...home, values: { 'schema.type': 'none' } } })).toBeNull();
    const arr = seoJsonLd({ page: { ...home, values: { 'schema.type': 'none', 'schema.extra': '[{"@type":"Event","name":"x"}]' } } }) as any;
    expect(arr['@graph']).toEqual([{ '@type': 'Event', name: 'x' }]);
    const broken = seoJsonLd({ page: { ...home, values: { 'schema.extra': '{oops' } } }) as any;
    expect(broken['@graph'][0]['@type']).toBe('WebPage');
    const head = seoHead({ page: { ...home, values: { 'seo.description': '</script><script>alert(1)</script>' } } });
    expect(head.match(/<\/script>/g)!.length).toBe(1);
  });

  it('helpers', () => {
    expect(absolute('/a', 'https://x.test/')).toBe('https://x.test/a');
    expect(absolute('https://y.test/a', 'https://x.test')).toBe('https://y.test/a');
    expect(pageUrl({ ...home, values: { 'seo.canonical': '/main' } }, site)).toBe('https://shop.test/main');
    expect(pageUrl(cat, null)).toBe('/catalog');
    expect(ogLocale('ru')).toBe('ru_RU');
    expect(ogLocale('en-gb')).toBe('en_GB');
  });
});

let editor: Editor | undefined;
afterEach(async () => {
  await destroyEditor(editor);
  editor = undefined;
  vi.restoreAllMocks();
});

const until = async (fn: () => boolean | Promise<boolean>, ms = 10000): Promise<void> => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await tick(5);
  }
};
const modal = (): HTMLElement => document.querySelector<HTMLElement>('.gjs-mdl-container .gjsp-props')!;
const set = (el: Element | null, value: string): void => {
  const i = el as HTMLInputElement;
  i.value = value;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('local mode: the dialogs', () => {
  it('a page’s properties: SEO, Open Graph (image from the cloud), Schema.org; the site’s SEO; head() and the archive', async () => {
    const s = await createEditor({
      extraPlugins: [
        (ed) => ed.Commands.add('cloud-assets:pick', { run: async () => [{ src: 'https://dl.test/og.jpg', name: 'og.jpg', expiresAt: Date.now() + 3600e3, provider: 'dropbox' }] }),
      ],
    });
    editor = s.editor;
    const [page] = await s.api.list();
    await s.api.update(page.id, { slug: '/' });
    editor.runCommand('pages-manager:properties', { id: page.id });
    await until(() => !!modal());
    const form = modal();
    expect([...form.querySelectorAll('.gjsp-tab')].map((b) => b.textContent)).toEqual(['General', 'SEO', 'Open Graph', 'Schema.org']);
    set(form.querySelector('[name="seo.title"]'), 'Welcome');
    expect(form.querySelector('.gjsp-seo-snippet-title')!.textContent).toBe('Welcome');
    set(form.querySelector('[name="seo.description"]'), 'x'.repeat(170));
    expect(form.querySelectorAll('.gjsp-seo-count')[1].classList.contains('is-over')).toBe(true);
    click(form.querySelector('[name="seo.noindex"]')!);
    // Open Graph: the cloud is a source; a temporary link is taken with a warning
    click(form.querySelector('.gjsp-tab[data-tab="og"]')!);
    click(form.querySelector('[data-pane="og"] [data-role="pick-cloud"]')!);
    await until(() => form.querySelector<HTMLInputElement>('[name="og.image"]')!.value === 'https://dl.test/og.jpg');
    expect(form.querySelector<HTMLElement>('[data-pane="og"] .gjsp-seo-warn')!.hidden).toBe(false);
    expect(form.querySelector('.gjsp-seo-card-title')!.textContent).toBe('Welcome');
    (form.querySelector('[name="twitter.card"]') as HTMLSelectElement).value = 'summary_large_image';
    // Schema.org: a type with its fields, FAQ rows, an invalid extra stops the save
    const type = form.querySelector<HTMLSelectElement>('[name="schema.type"]')!;
    type.value = 'FAQPage';
    type.dispatchEvent(new Event('change'));
    click(form.querySelector('[data-role="add-qa"]')!);
    set(form.querySelector('[name="faq.0.q"]'), 'Open on Sunday?');
    set(form.querySelector('[name="faq.0.a"]'), 'No.');
    expect(form.querySelector('.gjsp-seo-ld')!.textContent).toContain('Open on Sunday?');
    set(form.querySelector('[name="schema.extra"]'), '{bad');
    click(form.querySelector('[data-role="save"]')!);
    await tick(10);
    expect(form.querySelector('.gjsp-msg')!.textContent).toMatch(/^Extra JSON-LD is not valid JSON/);
    set(form.querySelector('[name="schema.extra"]'), '');
    click(form.querySelector('[data-role="save"]')!);
    await until(() => !editor!.Modal.isOpen());
    const rec = (await s.store.get(page.id))!;
    expect(rec.values).toMatchObject({
      'seo.title': 'Welcome',
      'seo.noindex': true,
      'og.image': 'https://dl.test/og.jpg',
      'twitter.card': 'summary_large_image',
      'schema.type': 'FAQPage',
      'schema.props': { faq: [{ q: 'Open on Sunday?', a: 'No.' }] },
    });
    expect(rec.values).not.toHaveProperty('seo.keywords');
    expect(rec.values).not.toHaveProperty('schema.breadcrumbs');

    // The site's SEO: the 🔍 button of the sidebar (local mode: its own dialog, kept in the shared meta).
    editor.runCommand('pages-manager:open');
    await tick();
    click(sidebar().querySelector('.gjsp-head .gjsp-btn[title="SEO of the site"]')!);
    await until(() => !!document.querySelector('.gjsp-sections'));
    const sf = document.querySelector<HTMLElement>('.gjsp-sections')!;
    expect([...sf.querySelectorAll('.gjsp-tab')].map((b) => b.textContent)).toEqual(['SEO', 'Organization', 'Languages']);
    set(sf.querySelector('[name="site.url"]'), 'https://shop.test/');
    set(sf.querySelector('[name="site.name"]'), 'Shop');
    set(sf.querySelector('[name="seo.title_template"]'), '%s | Shop');
    set(sf.querySelector('[name="org.name"]'), 'Shop LLC');
    set(sf.querySelector('[name="org.same_as"]'), 'https://t.me/shop\n');
    click(sf.querySelector('[data-role="save"]')!);
    await until(() => !editor!.Modal.isOpen());
    const shared = (await s.store.getMeta<Record<string, any>>(SHARED_META))![SITE_SHARED_KEY];
    expect(shared).toEqual({ 'site.url': 'https://shop.test', 'site.name': 'Shop', 'seo.title_template': '%s | Shop', 'org.name': 'Shop LLC', 'org.same_as': ['https://t.me/shop'] });
    expect(await s.api.seo.site()).toEqual(shared);

    const head = await s.api.seo.head(page.id);
    expect(head).toContain('<title>Welcome | Shop</title>');
    expect(head).toContain('<meta name="robots" content="noindex">');
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(head).toContain('"@type":"FAQPage"');

    // The archive's preview page has the head too.
    await settle(s.api);
    const files = unzipSync(await s.api.exportArchive());
    const index = Object.entries(files).find(([k]) => k.endsWith('/index.html'))!;
    expect(strFromU8(index[1])).toContain('<title>Welcome | Shop</title>');
    expect(strFromU8(index[1])).toContain('application/ld+json');
  });
});

describe('remote mode', () => {
  let server: FakeServerV2;
  beforeEach(() => {
    server = new FakeServerV2();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('a publish sends the head; the site’s SEO is the site record’s settings', async () => {
    const ID = '00000000-0000-4000-8000-000000000001';
    server.seed('pages', ID, 'Home', { slug: '/', values: { 'seo.title': 'Hi', 'schema.type': 'Organization' } });
    server.site.settings = { 'site.url': 'https://x.test', 'site.name': 'X' };
    const s = await createEditor({
      html: '<p>start</p>',
      css: '',
      plugin: { remote: { url: server.base, fetch: server.fetch, cache: new MemoryPageStore(), refreshInterval: 0, retryDelay: 5 } },
    });
    editor = s.editor;
    await until(async () => !!(await s.api.store.get('site')));
    expect(await s.api.seo.site()).toMatchObject({ 'site.name': 'X' });
    await s.api.open(ID);
    await s.api.publish(ID);
    const call = server.find('POST', `/pages/${ID}/publish`)[0];
    expect(call.body.head).toContain('<title>Hi</title>');
    expect(call.body.head).toContain('<link rel="canonical" href="https://x.test/">');
    expect(call.body.head).toContain('"@type":"Organization"');
    // the site's values through the API go to the site record
    await s.api.seo.setSite({ 'org.name': 'X Ltd', 'site.name': null });
    expect((await s.api.store.get('site'))!.values).toEqual({ 'site.url': 'https://x.test', 'org.name': 'X Ltd' });
  });

  it('a site with languages: the publish sends the head of every other language; languages API and event', async () => {
    const ID = '00000000-0000-4000-8000-000000000002';
    server.seed('pages', ID, 'Про нас', { slug: '/pro-nas', values: { 'seo.title': 'Про нас', 'i18n.en-gb': { name: 'About', slug: '/about', 'seo.title': 'About us' }, 'i18n.pl-pl': { hidden: true } } });
    server.site.settings = { 'site.url': 'https://x.test' };
    const s = await createEditor({
      html: '<p>start</p>',
      css: '',
      plugin: { remote: { url: server.base, fetch: server.fetch, cache: new MemoryPageStore(), refreshInterval: 0, retryDelay: 5 } },
    });
    editor = s.editor;
    await until(async () => !!(await s.api.store.get('site')));
    const events: unknown[] = [];
    s.editor.on('pages-manager:languages', (e: unknown) => events.push(e));
    await s.api.languages.set({ default: 'uk-ua', enabled: ['uk-ua', 'en-gb', 'pl-pl'] });
    expect(events).toEqual([{ languages: { default: 'uk-ua', enabled: ['uk-ua', 'en-gb', 'pl-pl'] } }]);
    expect(await s.api.languages.get()).toEqual({ default: 'uk-ua', enabled: ['uk-ua', 'en-gb', 'pl-pl'] });
    expect(await s.api.languages.prefixes()).toEqual({ 'uk-ua': '', 'en-gb': '/en', 'pl-pl': '/pl' });
    expect(await s.api.languages.pathIn(ID, 'en-gb')).toBe('/en/about');
    expect(await s.api.languages.pathIn(ID, 'pl-pl')).toBeNull();
    await s.api.open(ID);
    await s.api.publish(ID);
    const call = server.find('POST', `/pages/${ID}/publish`)[0];
    expect(call.body.head).toContain('<title>Про нас</title>');
    expect(call.body.head).toContain('hreflang="en-gb" href="https://x.test/en/about"');
    expect(Object.keys(call.body.heads)).toEqual(['en-gb']);
    expect(call.body.heads['en-gb']).toContain('<title>About us</title>');
    expect(call.body.heads['en-gb']).toContain('<link rel="canonical" href="https://x.test/en/about">');
  });
});
