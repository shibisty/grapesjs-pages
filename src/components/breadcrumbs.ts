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
  '.gjsp-breadcrumbs li+li::before{content:"/";margin-inline-end:.4em;opacity:.5}' +
  '.gjsp-breadcrumbs a{color:inherit}';

/**
 * The trail as HTML: every page from the top of the tree to the open one.
 * Ancestors link to their address (`#` when they have none); the open page
 * is the last item, without a link.
 */
export function breadcrumbsHtml(path: PageRecord[]): string {
  if (!path.length) return '';
  const items = path.map((p, i) => {
    const last = i === path.length - 1;
    const name = esc(p.name || '');
    if (last) return `<li><span aria-current="page">${name}</span></li>`;
    return `<li><a href="${esc(p.slug || '#')}">${name}</a></li>`;
  });
  return `<ol>${items.join('')}</ol>`;
}

/**
 * Breadcrumbs built from the page tree: a `<nav>` whose content is not
 * stored — it is drawn from the path of the open record (in the canvas and
 * in `getHtml()`, so a publish sends the trail of the page published).
 * Returns `refresh()` (re-draws every instance) and the remover.
 */
export function registerBreadcrumbs(
  editor: Editor,
  o: { path: () => PageRecord[]; label: () => string; category: () => string }
): { refresh(): void; destroy(): void } {
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
      },
      // The trail is not kept: it follows the tree and the open page.
      getInnerHTML() {
        return breadcrumbsHtml(o.path());
      },
    },
    view: {
      onRender() {
        (this as any).el.innerHTML = breadcrumbsHtml(o.path());
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
    const html = breadcrumbsHtml(o.path());
    // Walks the models: `find()` reads the rendered DOM, which may not be there yet.
    const walk = (c: any): void => {
      if (c.get?.('type') === BREADCRUMBS_TYPE) {
        const el = c.getEl?.();
        if (el) el.innerHTML = html;
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
