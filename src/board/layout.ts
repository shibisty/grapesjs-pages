/**
 * The board's model: frames on an endless plane, sections by kind, what is
 * in view. Pure functions (no DOM) — tested on their own.
 */

export type BoardSection = 'page' | 'data' | 'layout' | 'template' | 'component';
export const SECTIONS: BoardSection[] = ['page', 'data', 'layout', 'template', 'component'];

export interface BoardItem {
  id: string;
  name: string;
  section: BoardSection;
  /** Depth in the page tree (pages: indented order). */
  depth?: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameBox extends Rect {
  id: string;
  section: BoardSection;
}

export interface SectionBox {
  section: BoardSection;
  x: number;
  y: number;
}

export interface View {
  /** Board coordinates of the viewport's top-left corner. */
  x: number;
  y: number;
  zoom: number;
}

export interface LayoutOptions {
  /** Frame width (the device the pages are drawn for). */
  width: number;
  /** Height of a frame not measured yet. */
  height: number;
  gap: number;
  /** Frames per row. */
  perRow: number;
  /** Space for a section's title. */
  title: number;
}

export const LAYOUT_DEFAULTS: LayoutOptions = { width: 1280, height: 800, gap: 160, perRow: 6, title: 120 };

/**
 * Places the frames: sections one under another (pages, data, layouts,
 * templates, components), frames in rows. A frame the user moved keeps its
 * place (`placed`); measured heights (`heights`) set the rows.
 */
export function autoLayout(
  items: BoardItem[],
  o: Partial<LayoutOptions> & {
    heights?: Record<string, number>;
    placed?: Record<string, { x: number; y: number }>;
    /** Frame widths other than `width` (a frame shown as a phone, a tablet). */
    widths?: Record<string, number>;
  } = {}
): { frames: FrameBox[]; sections: SectionBox[] } {
  const L = { ...LAYOUT_DEFAULTS, ...o };
  const heights = o.heights || {};
  const placed = o.placed || {};
  const widthOf = (id: string): number => o.widths?.[id] || L.width;
  const frames: FrameBox[] = [];
  const sections: SectionBox[] = [];
  let y = 0;
  SECTIONS.forEach((section) => {
    const list = items.filter((i) => i.section === section);
    if (!list.length) return;
    sections.push({ section, x: 0, y });
    y += L.title;
    const auto = list.filter((i) => !placed[i.id]);
    for (let r = 0; r * L.perRow < auto.length; r++) {
      const row = auto.slice(r * L.perRow, (r + 1) * L.perRow);
      let rowH = 0;
      let x = 0;
      row.forEach((it) => {
        const h = heights[it.id] || L.height;
        const w = widthOf(it.id);
        rowH = Math.max(rowH, h);
        frames.push({ id: it.id, section, x, y, w, h });
        x += w + L.gap;
      });
      y += rowH + L.gap;
    }
    list
      .filter((i) => placed[i.id])
      .forEach((it) => frames.push({ id: it.id, section, x: placed[it.id].x, y: placed[it.id].y, w: widthOf(it.id), h: heights[it.id] || L.height }));
    y += L.gap;
  });
  return { frames, sections };
}

/** The board rectangle the viewport shows. */
export function viewRect(view: View, size: { w: number; h: number }): Rect {
  return { x: view.x, y: view.y, w: size.w / view.zoom, h: size.h / view.zoom };
}

export const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Frames in view, with a margin (in screens) so panning finds them drawn. */
export function visibleFrames(frames: FrameBox[], view: View, size: { w: number; h: number }, margin = 0.5): FrameBox[] {
  const r = viewRect(view, size);
  const m = { x: r.x - r.w * margin, y: r.y - r.h * margin, w: r.w * (1 + 2 * margin), h: r.h * (1 + 2 * margin) };
  return frames.filter((f) => intersects(f, m));
}

export function bounds(frames: Rect[]): Rect | null {
  if (!frames.length) return null;
  const x = Math.min(...frames.map((f) => f.x));
  const y = Math.min(...frames.map((f) => f.y));
  const x2 = Math.max(...frames.map((f) => f.x + f.w));
  const y2 = Math.max(...frames.map((f) => f.y + f.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 4;
export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** The view that shows `r` whole, centred, with a padding in screen pixels. */
export function fitView(r: Rect | null, size: { w: number; h: number }, pad = 40, max = 1): View {
  if (!r || !r.w || !r.h) return { x: 0, y: 0, zoom: 1 };
  const zoom = clampZoom(Math.min((size.w - 2 * pad) / r.w, (size.h - 2 * pad) / r.h, max));
  return { zoom, x: r.x - (size.w / zoom - r.w) / 2, y: r.y - (size.h / zoom - r.h) / 2 };
}

/** Zoom by `factor` keeping the board point under the screen point (sx, sy) in place. */
export function zoomAt(view: View, factor: number, sx: number, sy: number): View {
  const zoom = clampZoom(view.zoom * factor);
  const bx = view.x + sx / view.zoom;
  const by = view.y + sy / view.zoom;
  return { zoom, x: bx - sx / zoom, y: by - sy / zoom };
}
