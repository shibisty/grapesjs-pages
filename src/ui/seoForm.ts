import type { Translator } from '../i18n';
import type { PagesLabels } from '../i18n/types';
import {
  extraError,
  fullTitle,
  OG_TYPES,
  pageUrl,
  SCHEMA_FIELDS,
  SCHEMA_TYPES,
  SEO_KEYS as K,
  seoJsonLd,
  SITE_KEYS as S,
  type FaqItem,
  type SeoPage,
} from '../seo/head';
import type { RecordFormSection } from '../types';
import { fmt } from '../utils';
import { h } from './dom';
import type { MediaSource, PickedMedia } from './media';

type V = Record<string, unknown>;

/** Media for the image fields of these forms (the Asset Manager, the cloud). */
export interface SeoMedia {
  sources(): MediaSource[];
  pick(source: MediaSource['id']): Promise<PickedMedia[] | null>;
}

export interface SeoFormDeps {
  t: Translator;
  media: SeoMedia;
  /** The site's values (defaults, title template, address). */
  site(): Promise<V>;
  /** All pages, for the breadcrumbs of the preview. */
  pages(): Promise<SeoPage[]>;
  language?: string;
}

const str = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const nul = (s: string): string | null => (s.trim() ? s.trim() : null);

const field = (label: string, control: HTMLElement, hint?: string): HTMLElement =>
  h('label', { class: 'gjsp-seo-field' }, h('span', { class: 'gjsp-seo-label' }, label), control, hint ? h('small', { class: 'gjsp-seo-hint' }, hint) : null);

const input = (name: string, value: string, attrs: Record<string, string> = {}): HTMLInputElement =>
  h('input', { class: 'gjsp-input', type: 'text', name, value, ...attrs }) as HTMLInputElement;

const area = (name: string, value: string, rows = 3): HTMLTextAreaElement => {
  const el = h('textarea', { class: 'gjsp-input', name, rows: String(rows) }) as HTMLTextAreaElement;
  el.value = value;
  return el;
};

const check = (name: string, on: boolean, label: string): { el: HTMLElement; box: HTMLInputElement } => {
  const box = h('input', { type: 'checkbox', name, checked: on }) as HTMLInputElement;
  return { box, el: h('label', { class: 'gjsp-check' }, box, ' ', label) };
};

/** A character counter that turns red past the limit. */
const counter = (t: Translator, el: HTMLInputElement | HTMLTextAreaElement, max: number, fallback: () => string): HTMLElement => {
  const out = h('small', { class: 'gjsp-seo-count', 'aria-live': 'polite' });
  const draw = (): void => {
    const n = (el.value || fallback()).length;
    out.textContent = fmt(t('seoChars'), n, max);
    out.classList.toggle('is-over', n > max);
  };
  el.addEventListener('input', draw);
  draw();
  return out;
};

/**
 * An image field: the address (typed or picked), a preview, and buttons of
 * the media sources — the Asset Manager and, with grapesjs-cloud-assets,
 * the cloud. A temporary cloud link is taken with a warning.
 */
export function mediaField(t: Translator, media: SeoMedia, name: string, value: string, onChange?: () => void, language?: string): { el: HTMLElement; input: HTMLInputElement } {
  const url = input(name, value, { placeholder: 'https://…', type: 'url' });
  const preview = h('img', { class: 'gjsp-seo-thumb', alt: '' }) as HTMLImageElement;
  const warn = h('p', { class: 'gjsp-seo-warn', role: 'note', hidden: true });
  const draw = (): void => {
    preview.hidden = !url.value.trim();
    if (url.value.trim()) preview.src = url.value.trim();
  };
  url.addEventListener('input', () => {
    warn.hidden = true;
    draw();
    onChange?.();
  });
  const take = (list: PickedMedia[] | null): void => {
    const a = list?.[0];
    if (!a) return;
    url.value = a.url;
    warn.hidden = !a.expiresAt;
    if (a.expiresAt) warn.textContent = fmt(t('tempLink'), new Date(a.expiresAt).toLocaleString(language || undefined));
    draw();
    onChange?.();
  };
  const buttons = media.sources().map((src) =>
    h(
      'button',
      { type: 'button', class: 'gjsp-secondary', 'data-role': `pick-${src.id}`, onclick: () => void media.pick(src.id).then(take, (e) => console.error('[grapesjs-pages]', e)) },
      src.id === 'cloud' ? `☁ ${src.label}` : src.label
    )
  );
  const clear = h(
    'button',
    {
      type: 'button',
      class: 'gjsp-secondary',
      'data-role': 'clear',
      onclick: () => {
        url.value = '';
        warn.hidden = true;
        draw();
        onChange?.();
      },
    },
    t('remove')
  );
  draw();
  return { input: url, el: h('div', { class: 'gjsp-seo-media' }, preview, url, h('div', { class: 'gjsp-seo-row' }, ...buttons, clear), warn) };
}

/**
 * The tabs a page's properties get: SEO (title, description, keywords,
 * canonical, robots, a search snippet), Open Graph (social title,
 * description, image, type, X card, a card preview) and Schema.org (the
 * type, its fields, breadcrumbs, extra JSON-LD, what the page gets).
 */
export function pageSeoSections(rec: SeoPage, d: SeoFormDeps): RecordFormSection[] {
  const t = d.t;
  const v = rec.values || {};
  let site: V = {};
  let pages: SeoPage[] = [];
  const redraws: Array<() => void> = [];
  const redraw = (): void => redraws.forEach((fn) => fn());
  void Promise.all([d.site().catch(() => ({})), d.pages().catch(() => [])]).then(([s, p]) => {
    site = s as V;
    pages = p as SeoPage[];
    redraw();
  });

  /* ------------------------------- SEO ------------------------------- */
  const title = input(K.title, str(v[K.title]), { placeholder: rec.name });
  const desc = area(K.description, str(v[K.description]));
  const keywords = input(K.keywords, str(v[K.keywords]));
  const canonical = input(K.canonical, str(v[K.canonical]), { placeholder: 'https://…' });
  const noindex = check(K.noindex, v[K.noindex] === true, t('seoNoindex'));
  const nofollow = check(K.nofollow, v[K.nofollow] === true, t('seoNofollow'));
  const snippet = h('div', { class: 'gjsp-seo-snippet', 'aria-hidden': 'true' });
  const current = (): SeoPage => ({ ...rec, values: { ...v, ...seoValues(), ...ogValues(), ...schemaValues() } as V });
  const drawSnippet = (): void => {
    const p = current();
    snippet.replaceChildren(
      h('div', { class: 'gjsp-seo-snippet-url' }, pageUrl(p, site) || rec.slug || '/'),
      h('div', { class: 'gjsp-seo-snippet-title' }, fullTitle(p, site)),
      h('div', { class: 'gjsp-seo-snippet-desc' }, str(p.values?.[K.description]) || str(site[S.description]))
    );
  };
  redraws.push(drawSnippet);
  [title, desc, canonical].forEach((el) => el.addEventListener('input', drawSnippet));
  const seoValues = (): V => ({
    [K.title]: nul(title.value),
    [K.description]: nul(desc.value),
    [K.keywords]: nul(keywords.value),
    [K.canonical]: nul(canonical.value),
    [K.noindex]: noindex.box.checked ? true : null,
    [K.nofollow]: nofollow.box.checked ? true : null,
  });
  const seoEl = h(
    'div',
    { class: 'gjsp-seo' },
    snippet,
    field(t('seoTitle'), title),
    counter(t, title, 60, () => rec.name),
    field(t('seoDescription'), desc),
    counter(t, desc, 160, () => str(site[S.description])),
    field(t('seoKeywords'), keywords),
    field(t('seoCanonical'), canonical),
    noindex.el,
    nofollow.el
  );

  /* ---------------------------- Open Graph --------------------------- */
  const ogTitle = input(K.ogTitle, str(v[K.ogTitle]));
  const ogDesc = area(K.ogDescription, str(v[K.ogDescription]));
  const card = h('div', { class: 'gjsp-seo-card', 'aria-hidden': 'true' });
  const drawCard = (): void => {
    const p = current();
    const img = str(p.values?.[K.ogImage]) || str(site[S.ogImage]);
    let host = '';
    try {
      host = new URL(pageUrl(p, site)).host;
    } catch {
      host = str(site[S.name]);
    }
    card.replaceChildren(
      img ? h('img', { class: 'gjsp-seo-card-img', src: img, alt: '' }) : h('div', { class: 'gjsp-seo-card-img is-empty' }),
      h('div', { class: 'gjsp-seo-card-host' }, host),
      h('div', { class: 'gjsp-seo-card-title' }, ogTitle.value || title.value || rec.name),
      h('div', { class: 'gjsp-seo-card-desc' }, ogDesc.value || desc.value || str(site[S.description]))
    );
    ogTitle.placeholder = title.value || rec.name;
    ogDesc.placeholder = desc.value || str(site[S.description]);
  };
  redraws.push(drawCard);
  const image = mediaField(t, d.media, K.ogImage, str(v[K.ogImage]), drawCard, d.language);
  const alt = input(K.ogImageAlt, str(v[K.ogImageAlt]));
  const ogType = h('select', { class: 'gjsp-select', name: K.ogType }, h('option', { value: '' }, '—'), ...OG_TYPES.map((x) => h('option', { value: x, selected: v[K.ogType] === x }, x))) as HTMLSelectElement;
  const twitter = h(
    'select',
    { class: 'gjsp-select', name: K.twitterCard },
    h('option', { value: '' }, '—'),
    h('option', { value: 'summary', selected: v[K.twitterCard] === 'summary' }, t('twitterSmall')),
    h('option', { value: 'summary_large_image', selected: v[K.twitterCard] === 'summary_large_image' }, t('twitterLarge'))
  ) as HTMLSelectElement;
  [ogTitle, ogDesc, title, desc].forEach((el) => el.addEventListener('input', drawCard));
  const ogValues = (): V => ({
    [K.ogTitle]: nul(ogTitle.value),
    [K.ogDescription]: nul(ogDesc.value),
    [K.ogImage]: nul(image.input.value),
    [K.ogImageAlt]: nul(alt.value),
    [K.ogType]: ogType.value || null,
    [K.twitterCard]: twitter.value || null,
  });
  const ogEl = h(
    'div',
    { class: 'gjsp-seo' },
    card,
    field(t('ogTitle'), ogTitle),
    field(t('ogDescription'), ogDesc),
    field(t('ogImage'), image.el),
    field(t('ogImageAlt'), alt),
    h('div', { class: 'gjsp-seo-grid' }, field(t('ogType'), ogType), field(t('twitterCard'), twitter))
  );

  /* ---------------------------- Schema.org --------------------------- */
  const props: V = v[K.schemaProps] && typeof v[K.schemaProps] === 'object' ? JSON.parse(JSON.stringify(v[K.schemaProps])) : {};
  const type = h(
    'select',
    { class: 'gjsp-select', name: K.schemaType },
    h('option', { value: 'none', selected: v[K.schemaType] === 'none' }, t('schemaNone')),
    ...SCHEMA_TYPES.map((x) => h('option', { value: x, selected: (str(v[K.schemaType]) || 'WebPage') === x }, x))
  ) as HTMLSelectElement;
  const propsBox = h('div', { class: 'gjsp-seo-props' });
  const crumbs = check(K.schemaBreadcrumbs, v[K.schemaBreadcrumbs] !== false, t('schemaBreadcrumbs'));
  const extra = area(K.schemaExtra, typeof v[K.schemaExtra] === 'string' ? (v[K.schemaExtra] as string) : v[K.schemaExtra] ? JSON.stringify(v[K.schemaExtra], null, 2) : '', 5);
  extra.classList.add('gjsp-code');
  extra.placeholder = '{ "aggregateRating": { "@type": "AggregateRating", "ratingValue": 4.8, "reviewCount": 31 } }';
  const extraMsg = h('small', { class: 'gjsp-seo-err', 'aria-live': 'polite' });
  const out = h('pre', { class: 'gjsp-seo-ld gjsp-code' });
  const drawLd = (): void => {
    const err = extraError(extra.value);
    extraMsg.textContent = err ? fmt(t('schemaInvalid'), err) : '';
    const ld = seoJsonLd({ page: current(), site, pages });
    out.textContent = ld ? JSON.stringify(ld, null, 2) : '—';
  };
  redraws.push(drawLd);
  const LABEL: Record<string, keyof PagesLabels> = {
    author: 'schemaAuthor',
    published: 'schemaPublished',
    brand: 'schemaBrand',
    sku: 'schemaSku',
    price: 'schemaPrice',
    currency: 'schemaCurrency',
    availability: 'schemaAvailability',
    area: 'schemaArea',
    start: 'schemaStart',
    end: 'schemaEnd',
    place: 'schemaPlace',
    address: 'schemaAddress',
    phone: 'schemaPhone',
    hours: 'schemaHours',
    priceRange: 'schemaPriceRange',
    sameAs: 'schemaSameAs',
  };
  const drawProps = (): void => {
    const keys = SCHEMA_FIELDS[type.value] || [];
    const els: HTMLElement[] = [];
    keys.forEach((k) => {
      if (k === 'faq') {
        const list = (Array.isArray(props.faq) ? props.faq : (props.faq = [])) as FaqItem[];
        const box = h('div', { class: 'gjsp-seo-faq' });
        const draw = (): void => {
          box.replaceChildren(
            ...list.map((qa, i) => {
              const q = input(`faq.${i}.q`, qa.q || '', { placeholder: t('schemaQuestion'), 'aria-label': t('schemaQuestion') });
              const a = area(`faq.${i}.a`, qa.a || '', 2);
              a.placeholder = t('schemaAnswer');
              a.setAttribute('aria-label', t('schemaAnswer'));
              q.addEventListener('input', () => ((qa.q = q.value), drawLd()));
              a.addEventListener('input', () => ((qa.a = a.value), drawLd()));
              return h(
                'div',
                { class: 'gjsp-seo-qa' },
                q,
                a,
                h('button', { type: 'button', class: 'gjsp-act', title: t('remove'), 'aria-label': t('remove'), onclick: () => (list.splice(i, 1), draw(), drawLd()) }, '✕')
              );
            }),
            h('button', { type: 'button', class: 'gjsp-secondary', 'data-role': 'add-qa', onclick: () => (list.push({ q: '', a: '' }), draw()) }, `+ ${t('schemaAddQa')}`)
          );
        };
        draw();
        els.push(field(t('schemaFaq'), box));
        return;
      }
      let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (k === 'availability') {
        control = h(
          'select',
          { class: 'gjsp-select', name: `schema.${k}` },
          h('option', { value: '' }, '—'),
          h('option', { value: 'in_stock', selected: props[k] === 'in_stock' }, t('inStock')),
          h('option', { value: 'out_of_stock', selected: props[k] === 'out_of_stock' }, t('outOfStock')),
          h('option', { value: 'pre_order', selected: props[k] === 'pre_order' }, t('preOrder'))
        ) as HTMLSelectElement;
      } else if (k === 'sameAs') {
        control = area(`schema.${k}`, Array.isArray(props[k]) ? (props[k] as string[]).join('\n') : str(props[k]), 3);
      } else {
        const typeOf: Record<string, string> = { published: 'date', start: 'datetime-local', end: 'datetime-local', price: 'number' };
        control = input(`schema.${k}`, str(props[k]), typeOf[k] ? { type: typeOf[k], ...(k === 'price' ? { step: 'any', min: '0' } : {}) } : k === 'currency' ? { placeholder: 'UAH, USD, EUR…', maxlength: '3' } : {});
      }
      const write = (): void => {
        const val = control.value.trim();
        if (k === 'sameAs') props[k] = val ? val.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : undefined;
        else props[k] = k === 'currency' ? val.toUpperCase() || undefined : val || undefined;
        drawLd();
      };
      control.addEventListener('input', write);
      control.addEventListener('change', write);
      els.push(field(t(LABEL[k]), control, k === 'hours' ? 'Mo-Fr 09:00-18:00' : undefined));
    });
    propsBox.replaceChildren(...els);
  };
  type.addEventListener('change', () => {
    drawProps();
    drawLd();
  });
  [crumbs.box].forEach((el) => el.addEventListener('change', drawLd));
  extra.addEventListener('input', drawLd);
  [title, desc, canonical, ogTitle, ogDesc, image.input].forEach((el) => el.addEventListener('input', drawLd));
  drawProps();
  const schemaValues = (): V => {
    const keys = new Set(SCHEMA_FIELDS[type.value] || []);
    const kept: V = {};
    Object.entries(props).forEach(([k, val]) => {
      if (!keys.has(k) || val === undefined || val === '') return;
      if (k === 'faq') {
        const list = (val as FaqItem[]).filter((x) => x && (x.q?.trim() || x.a?.trim())).map((x) => ({ q: x.q.trim(), a: x.a.trim() }));
        if (list.length) kept.faq = list;
      } else kept[k] = val;
    });
    return {
      [K.schemaType]: type.value === 'WebPage' ? null : type.value,
      [K.schemaProps]: Object.keys(kept).length ? kept : null,
      [K.schemaExtra]: nul(extra.value),
      [K.schemaBreadcrumbs]: crumbs.box.checked ? null : false,
    };
  };
  const schemaEl = h(
    'div',
    { class: 'gjsp-seo' },
    field(t('schemaType'), type),
    propsBox,
    crumbs.el,
    field(t('schemaExtra'), extra, t('schemaExtraHint')),
    extraMsg,
    h('details', { class: 'gjsp-seo-out' }, h('summary', {}, t('schemaPreview')), out)
  );
  redraw();

  return [
    { id: 'seo', label: 'SEO', tab: true, el: seoEl, values: seoValues },
    { id: 'og', label: 'Open Graph', tab: true, el: ogEl, values: ogValues },
    {
      id: 'schema',
      label: 'Schema.org',
      tab: true,
      el: schemaEl,
      values: schemaValues,
      validate: () => {
        const err = extraError(extra.value);
        return err ? fmt(t('schemaInvalid'), err) : null;
      },
    },
  ];
}

/**
 * The site's SEO: its address, name and language, the title template,
 * defaults of the description and the image, the X account, and the
 * organization (name, logo, profiles) for Schema.org.
 */
export function siteSeoSections(values: V, d: Pick<SeoFormDeps, 't' | 'media' | 'language'>): RecordFormSection[] {
  const t = d.t;
  const url = input(S.url, str(values[S.url]), { placeholder: 'https://example.com', type: 'url' });
  const name = input(S.name, str(values[S.name]));
  const lang = input(S.lang, str(values[S.lang]), { placeholder: d.language || 'en' });
  const tpl = input(S.titleTemplate, str(values[S.titleTemplate]), { placeholder: `%s — ${str(values[S.name]) || 'Site'}` });
  const desc = area(`site.${S.description}`, str(values[S.description]));
  const image = mediaField(t, d.media, `site.${S.ogImage}`, str(values[S.ogImage]), undefined, d.language);
  const tw = input(S.twitterSite, str(values[S.twitterSite]), { placeholder: '@site' });
  const orgName = input(S.orgName, str(values[S.orgName]));
  const logo = mediaField(t, d.media, S.orgLogo, str(values[S.orgLogo]), undefined, d.language);
  const same = area(S.orgSameAs, Array.isArray(values[S.orgSameAs]) ? (values[S.orgSameAs] as string[]).join('\n') : str(values[S.orgSameAs]), 3);
  same.placeholder = 'https://facebook.com/…\nhttps://instagram.com/…';
  return [
    {
      id: 'site-seo',
      label: 'SEO',
      tab: true,
      el: h(
        'div',
        { class: 'gjsp-seo' },
        h('p', { class: 'gjsp-seo-hint' }, t('seoDefaultsHint')),
        field(t('siteUrl'), url, t('siteUrlHint')),
        h('div', { class: 'gjsp-seo-grid' }, field(t('siteName'), name), field(t('siteLang'), lang)),
        field(t('titleTemplate'), tpl, t('titleTemplateHint')),
        field(t('defaultDescription'), desc),
        field(t('defaultImage'), image.el),
        field(t('twitterSite'), tw)
      ),
      values: () => ({
        [S.url]: nul(url.value.replace(/\/+$/, '')),
        [S.name]: nul(name.value),
        [S.lang]: nul(lang.value),
        [S.titleTemplate]: nul(tpl.value),
        [S.description]: nul(desc.value),
        [S.ogImage]: nul(image.input.value),
        [S.twitterSite]: nul(tw.value),
      }),
    },
    {
      id: 'site-org',
      label: t('organization'),
      tab: true,
      el: h('div', { class: 'gjsp-seo' }, field(t('orgName'), orgName), field(t('orgLogo'), logo.el), field(t('schemaSameAs'), same)),
      values: () => {
        const links = same.value
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        return { [S.orgName]: nul(orgName.value), [S.orgLogo]: nul(logo.input.value), [S.orgSameAs]: links.length ? links : null };
      },
    },
  ];
}
