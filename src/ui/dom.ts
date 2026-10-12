type Attrs = Record<string, string | boolean | null | undefined | EventListener>;
type Child = Node | string | number | null | undefined | false | Child[];

/**
 * Tiny element factory. Text always goes through text nodes (never
 * innerHTML), `on*` keys become listeners, `false`/`null` attributes are
 * skipped, `class` sets className.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === false || v == null) return;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, v === true ? '' : String(v));
  });
  const add = (k: Child): void => {
    if (Array.isArray(k)) return k.forEach(add);
    if (k === false || k == null) return;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return el;
}

/** "Page" icon used by the panel button and the fallback toggle. */
export function pageIcon(size: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('style', `display:block;width:${size}px;height:${size}px`);
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z');
  svg.appendChild(path);
  return svg;
}

export const PAGE_ICON_HTML = (size: number): string => pageIcon(size).outerHTML;
