import type { Editor } from 'grapesjs';

export const SLOT_BLOCK_ID = 'gjsp-page-slot';

/**
 * The element a layout marks the page's place with (`<page-slot>` by
 * default; the server puts the page there). In the canvas it shows as a
 * dashed box with a label; none of that is exported.
 */
export function registerSlot(editor: Editor, tag: string, label: () => string): void {
  const dc = editor.DomComponents;
  if (dc.getType(tag)) return;
  dc.addType(tag, {
    isComponent: (el: HTMLElement) => (el?.tagName && el.tagName.toLowerCase() === tag ? { type: tag } : false),
    model: {
      defaults: {
        tagName: tag,
        name: 'Page slot',
        droppable: false,
        editable: false,
        copyable: false,
        stylable: false,
        components: [],
        traits: [],
      },
    },
    view: {
      onRender(this: { el: HTMLElement }) {
        const el = this.el;
        el.style.minHeight = '96px';
        el.style.outline = '2px dashed rgba(127,127,127,.8)';
        el.style.outlineOffset = '-6px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.font = '13px/1.4 sans-serif';
        el.style.color = 'rgba(127,127,127,.95)';
        el.querySelector('[data-gjsp-slot-label]')?.remove();
        const span = document.createElement('span');
        span.setAttribute('data-gjsp-slot-label', '');
        span.textContent = label();
        el.appendChild(span);
      },
    },
  } as any);
}

/** The "Page slot" block, offered only while a layout is open. */
export function toggleSlotBlock(editor: Editor, tag: string, show: boolean, label: string): void {
  const bm = editor.Blocks;
  const has = !!bm.get(SLOT_BLOCK_ID);
  if (show && !has) {
    bm.add(SLOT_BLOCK_ID, {
      label,
      category: label,
      content: { type: tag },
      media:
        '<svg viewBox="0 0 24 24" width="40" height="40"><path fill="none" stroke="currentColor" stroke-dasharray="3 2" stroke-width="1.5" d="M3 5h18v14H3z"/><path fill="currentColor" d="M7 11h10v2H7z"/></svg>',
    } as any);
  } else if (!show && has) {
    bm.remove(SLOT_BLOCK_ID);
  }
}
