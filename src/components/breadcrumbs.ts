import type { Editor } from 'grapesjs';
import type { PageRecord } from '../types';

/** Component type of the breadcrumbs. */
export const BREADCRUMBS_TYPE = 'page-breadcrumbs';
export const BREADCRUMBS_ATTR = 'data-gjsp-breadcrumbs';
export const BREADCRUMBS_BLOCK = 'page-breadcrumbs';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Default look; a site overrides it with its own rules for `.gjsp-breadcrumbs`. */
const CSS =
  '.gjsp-breadcrumbs ol{display:flex;flex-wrap:wrap;gap:.4em;list-style:none;margin:0;padding:0}' +
  '.gjsp-breadcrumbs:not([data-gjsp-sep]) li+li::before{content:"/";margin-inline-end:.4em;opacity:.5}' +
  '.gjsp-breadcrumbs .gjsp-bc-sep{margin-inline-end:.4em;opacity:.5}' +
  '.gjsp-breadcrumbs a{color:inherit}';

/**
 * The trail as HTML: every page from the top of the tree to the open one.
 * Ancestors link to their address (`#` when they have none); the open page
 * is the last item, without a link.
 */
export interface BreadcrumbsOptions {
  /** Between the items (default: "/" drawn by CSS). */
  separator?: string;
  /** The first item's text instead of its page's name (e.g. "Home"). */
  home?: string;
  /** Show the open page as the last item (default: yes). */
  current?: boolean;
}

export function breadcrumbsHtml(path: PageRecord[], o: BreadcrumbsOptions = {}): string {
  const shown = o.current === false ? path.slice(0, -1) : path;
  if (!shown.length) return '';
  const sep = o.separator ? `<span class="gjsp-bc-sep" aria-hidden="true">${esc(o.separator)}</span>` : '';
  const items = shown.map((p, i) => {
    const last = i === path.length - 1;
    const name = esc((i === 0 && o.home) || p.name || '');
    const before = i > 0 ? sep : '';
    if (last) return `<li>${before}<span aria-current="page">${name}</span></li>`;
    return `<li>${before}<a href="${esc(p.slug || '#')}">${name}</a></li>`;
  });
  return `<ol>${items.join('')}</ol>`;
}

/** A breadcrumbs component's options (its traits). */
const optionsOf = (c: any): BreadcrumbsOptions => ({
  separator: String(c.get?.('separator') || ''),
  home: String(c.get?.('home') || ''),
  current: c.get?.('current') !== false,
});

/**
 * Breadcrumbs built from the page tree: a `<nav>` whose content is not
 * stored — it is drawn from the path of the open record (in the canvas and
 * in `getHtml()`, so a publish sends the trail of the page published).
 * Returns `refresh()` (re-draws every instance) and the remover.
 */
export function registerBreadcrumbs(
  editor: Editor,
  o: {
    path: () => PageRecord[];
    label: () => string;
    category: () => string;
    labels?: () => { separator: string; home: string; current: string };
  }
): { refresh(): void; destroy(): void } {
  const traits = (): any[] => {
    const l = o.labels?.() || { separator: 'Separator', home: 'First item', current: 'Show the current page' };
    return [
      { type: 'text', name: 'separator', label: l.separator, changeProp: true, placeholder: '/' },
      { type: 'text', name: 'home', label: l.home, changeProp: true },
      { type: 'checkbox', name: 'current', label: l.current, changeProp: true },
    ];
  };
  const dc = editor.DomComponents;
  dc.addType(BREADCRUMBS_TYPE, {
    isComponent: (el: HTMLElement) => (el?.tagName === 'NAV' && el.hasAttribute?.(BREADCRUMBS_ATTR) ? { type: BREADCRUMBS_TYPE } : false),
    model: {
      defaults: {
        tagName: 'nav',
        name: o.label(),
        droppable: false,
        editable: false,
        attributes: { [BREADCRUMBS_ATTR]: '', class: 'gjsp-breadcrumbs', 'aria-label': 'Breadcrumb' },
        components: [],
        styles: CSS,
        separator: '',
        home: '',
        current: true,
      },
      init(this: any) {
        this.set('traits', traits());
        const sync = (): void => {
          const sep = String(this.get('separator') || '');
          if (sep) this.addAttributes({ 'data-gjsp-sep': '' });
          else this.removeAttributes?.('data-gjsp-sep');
          const el = this.getEl?.();
          if (el) el.innerHTML = breadcrumbsHtml(o.path(), optionsOf(this));
        };
        this.on('change:separator change:home change:current', sync);
      },
      // The trail is not kept: it follows the tree and the open page.
      getInnerHTML(this: any) {
        return breadcrumbsHtml(o.path(), optionsOf(this));
      },
    },
    view: {
      onRender(this: any) {
        this.el.innerHTML = breadcrumbsHtml(o.path(), optionsOf(this.model));
      },
    },
  } as any);
  editor.BlockManager.add(BREADCRUMBS_BLOCK, {
    label: o.label(),
    category: o.category(),
    media:
      '<svg viewBox="0 0 24 24" width="40" height="40"><path fill="currentColor" d="M2 11h4v2H2zm6.6-3.4L12 12l-3.4 4.4-1.6-1.2L9.5 12 7 8.8zM14 11h4v2h-4zm6.6-3.4L24 12l-3.4 4.4-1.6-1.2 2.5-3.2L19 8.8z"/></svg>',
    content: { type: BREADCRUMBS_TYPE },
  } as any);

  const refresh = (): void => {
    const wrapper = editor.getWrapper?.();
    if (!wrapper) return;
    const path = o.path();
    // Walks the models: `find()` reads the rendered DOM, which may not be there yet.
    const walk = (c: any): void => {
      if (c.get?.('type') === BREADCRUMBS_TYPE) {
        const el = c.getEl?.();
        if (el) el.innerHTML = breadcrumbsHtml(path, optionsOf(c));
        return;
      }
      c.components?.().forEach(walk);
    };
    walk(wrapper);
  };
  return {
    refresh,
    destroy: () => {
      try {
        editor.BlockManager.remove(BREADCRUMBS_BLOCK);
      } catch {
        /* the editor is gone */
      }
    },
  };
}
