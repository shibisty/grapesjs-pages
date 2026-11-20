import type { Translator } from '../i18n';
import { h } from '../ui/dom';
import {
  autoLayout,
  bounds,
  fitView,
  LAYOUT_DEFAULTS,
  SECTIONS,
  visibleFrames,
  zoomAt,
  type BoardItem,
  type BoardSection,
  type FrameBox,
  type View,
} from './layout';

export interface BoardState {
  view?: View;
  /** Frames the user moved. */
  placed?: Record<string, { x: number; y: number }>;
  /** Measured heights of the frames. */
  heights?: Record<string, number>;
  /** Sections shown. */
  sections?: BoardSection[];
  /** The device each frame is shown as (Device Manager id; none: the board's width). */
  devices?: Record<string, string>;
}

/** A device of the editor's Device Manager, offered above every frame. */
export interface BoardDevice {
  id: string;
  name: string;
  /** px; `null` — the board's width (desktop). */
  width: number | null;
}

export interface BoardSnapshot {
  html: string;
  css: string;
}

/**
 * Live editing on the board: the editor's own canvas is the board's
 * surface and its frame sits on the frame of the open record.
 */
export interface BoardLive {
  /** The record in the canvas. */
  activeId(): string | null;
  /** Puts another record in the canvas. */
  activate(id: string): void;
  /** Where the canvas frame goes (screen px from the board's top-left, the zoom); `null` hides it. */
  place(p: { x: number; y: number; zoom: number } | null): void;
  /** The record in the canvas is shown as another device (`null`: desktop). */
  device?(device: BoardDevice | null, width: number): void;
}

export interface BoardDeps {
  t: Translator;
  /** The element the board covers (the editor). */
  host: HTMLElement;
  items(): Promise<BoardItem[]>;
  activeId(): string | null;
  /** The record's markup (rendered in the editor, cached). */
  render(id: string, force?: boolean): Promise<BoardSnapshot | null>;
  /** Head of every frame: the canvas's stylesheets. */
  head(): string;
  /** Leaves the board and opens the record in the editor. */
  open(id: string): void;
  /** Leaves the board (Esc, ✕): back to where the editor was. */
  close(): void;
  load(): Promise<BoardState | null>;
  save(s: BoardState): void;
  width?: number;
  /** At most this many live frames (the farthest from the centre wait). */
  maxLive?: number;
  /** Edit on the board: the board is drawn inside the canvas element (`host`). */
  live?: BoardLive;
  /** Devices offered above every frame (the editor's Device Manager). */
  devices?(): BoardDevice[];
}

const DEFAULT_SECTIONS: BoardSection[] = ['page', 'layout', 'template', 'component'];
const LABEL: Record<BoardSection, 'boardPages' | 'boardData' | 'boardLayouts' | 'boardTemplates' | 'boardComponents'> = {
  page: 'boardPages',
  data: 'boardData',
  layout: 'boardLayouts',
  template: 'boardTemplates',
  component: 'boardComponents',
};

/**
 * A Figma-like board over the editor: every page, layout, template and
 * component as a frame on an endless plane. Pan (drag the background, the
 * middle button, Space + drag, wheel / trackpad), zoom (Ctrl + wheel, pinch,
 * + / −, Shift+1 fits all, Shift+0 is 100%). Only frames in view are drawn
 * (live iframes, static: no scripts); the others wait as named boxes.
 * Frames are moved by their titles; double click (or Enter) opens one in
 * the editor; Esc goes back.
 */
export class Board {
  readonly root: HTMLElement;
  private readonly vp: HTMLElement;
  private readonly world: HTMLElement;
  private readonly zoomLabel: HTMLButtonElement;
  private readonly veil: HTMLElement;
  private readonly veilText: HTMLElement;
  private readonly veilBar: HTMLElement;
  private busyText: string | null = null;
  private progress = { done: 0, total: 0 };
  private readonly chips: HTMLElement;
  private items: BoardItem[] = [];
  private frames: FrameBox[] = [];
  private view: View = { x: 0, y: 0, zoom: 0.25 };
  private state: BoardState = {};
  private els = new Map<string, { el: HTMLElement; body: HTMLElement; live: boolean; key: string }>();
  private snaps = new Map<string, BoardSnapshot>();
  private pending = new Set<string>();
  private selected: string | null = null;
  private raf = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private space = false;
  private destroyed = false;
  private readonly width: number;
  private readonly offs: Array<() => void> = [];

  constructor(private readonly d: BoardDeps) {
    const t = d.t;
    this.width = d.width || LAYOUT_DEFAULTS.width;
    const btn = (text: string, title: string, run: () => void, role?: string) =>
      h('button', { type: 'button', class: 'gjsp-board__btn', title, 'aria-label': title, 'data-role': role || '', onclick: () => run() }, text);
    this.zoomLabel = btn('100%', t('boardZoom100'), () => this.setZoom(1), 'zoom-100');
    this.chips = h('div', { class: 'gjsp-board__chips' });
    this.world = h('div', { class: 'gjsp-board__world' });
    this.vp = h('div', { class: 'gjsp-board__vp', tabindex: '0' }, this.world);
    // Over the board while frames load or a page is being opened: nothing jumps under the pointer.
    this.veilText = h('div', { class: 'gjsp-board__veil-text' });
    this.veilBar = h('div', { class: 'gjsp-board__veil-bar' });
    this.veil = h('div', { class: 'gjsp-board__veil', hidden: true, 'aria-live': 'polite' }, h('div', { class: 'gjsp-board__veil-box' }, this.veilText, h('div', { class: 'gjsp-board__veil-track' }, this.veilBar)));
    this.root = h(
      'div',
      { class: `gjsp-board${d.live ? ' gjsp-board--live' : ''}`, role: d.live ? 'region' : 'dialog', 'aria-label': t('board') },
      h(
        'div',
        { class: 'gjsp-board__bar' },
        h('span', { class: 'gjsp-board__title' }, t('board')),
        this.chips,
        h('span', { class: 'gjsp-board__sp' }),
        btn('−', t('boardZoomOut'), () => this.zoomBy(1 / 1.25), 'zoom-out'),
        this.zoomLabel,
        btn('+', t('boardZoomIn'), () => this.zoomBy(1.25), 'zoom-in'),
        btn('⤢', t('boardFit'), () => this.fit(), 'fit'),
        btn('⟳', t('boardRefresh'), () => this.refresh(), 'refresh'),
        btn('✕', t('close'), () => d.close(), 'close')
      ),
      this.vp,
      this.veil,
      h('div', { class: 'gjsp-board__hint' }, t('boardHint'))
    );
    this.listen();
  }

  /** Shows the board (reads the records and the saved state). */
  async show(): Promise<void> {
    // Live: under the canvas's own frames (first child of the canvas element).
    if (this.d.live) this.d.host.prepend(this.root);
    else this.d.host.appendChild(this.root);
    this.state = (await this.d.load().catch(() => null)) || {};
    if (this.destroyed) return;
    await this.reload();
    const v = this.state.view;
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && v.zoom > 0) this.view = { ...v };
    else this.fit(false);
    // The open page in sight.
    const cur = this.d.live?.activeId() ?? this.d.activeId();
    if (cur && this.frames.some((f) => f.id === cur)) {
      this.selected = cur;
      const f = this.frames.find((x) => x.id === cur)!;
      const size = this.size();
      const r = { x: this.view.x, y: this.view.y, w: size.w / this.view.zoom, h: size.h / this.view.zoom };
      if (!(f.x < r.x + r.w && r.x < f.x + f.w && f.y < r.y + r.h && r.y < f.y + f.h)) {
        this.view = { ...this.view, x: f.x + f.w / 2 - r.w / 2, y: f.y - 80 / this.view.zoom };
      }
    }
    this.draw();
    this.vp.focus();
  }

  /** The records changed (names, new pages): the frames follow. */
  async reload(): Promise<void> {
    this.items = await this.d.items();
    this.drawChips();
    this.relayout();
  }

  /** Forgets the drawn markup (and asks the renderer for fresh). */
  refresh(): void {
    this.snaps.clear();
    this.els.forEach((x) => (x.key = ''));
    this.draw(true);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.flushSave();
    this.offs.splice(0).forEach((f) => f());
    this.root.remove();
  }

  /* --------------------------------- view --------------------------------- */

  private size(): { w: number; h: number } {
    return { w: this.vp.clientWidth || 1200, h: this.vp.clientHeight || 800 };
  }

  private shown(): BoardSection[] {
    return this.state.sections?.length ? this.state.sections : DEFAULT_SECTIONS;
  }

  private relayout(): void {
    const show = new Set(this.shown());
    const { frames, sections } = autoLayout(
      this.items.filter((i) => show.has(i.section)),
      { width: this.width, heights: this.state.heights, placed: this.state.placed, widths: this.widths() }
    );
    this.frames = frames;
    // Section titles.
    this.world.querySelectorAll('.gjsp-board__sec').forEach((e) => e.remove());
    sections.forEach((s) =>
      this.world.prepend(h('div', { class: 'gjsp-board__sec', style: `left:${s.x}px;top:${s.y}px` }, this.d.t(LABEL[s.section])))
    );
    // Frames gone (filtered out, deleted).
    const ids = new Set(frames.map((f) => f.id));
    this.els.forEach((x, id) => {
      if (!ids.has(id)) {
        x.el.remove();
        this.els.delete(id);
      }
    });
    this.draw();
  }

  /* -------------------------------- devices ------------------------------- */

  private deviceList(): BoardDevice[] {
    try {
      return this.d.devices?.() || [];
    } catch {
      return [];
    }
  }

  /** The device a frame is shown as (`null`: desktop, the board's width). */
  deviceOf(id: string): BoardDevice | null {
    const dev = this.state.devices?.[id];
    return (dev && this.deviceList().find((x) => x.id === dev && x.width)) || null;
  }

  /** A frame's width: its device's, else the board's. */
  widthOf(id: string): number {
    return this.deviceOf(id)?.width || this.width;
  }

  private widths(): Record<string, number> {
    const out: Record<string, number> = {};
    Object.keys(this.state.devices || {}).forEach((id) => {
      const w = this.deviceOf(id)?.width;
      if (w) out[id] = w;
    });
    return out;
  }

  /** Shows a frame as a device (the live one: the editor switches too, so styles go to its media). */
  setDevice(id: string, device: BoardDevice | null): void {
    const devices = (this.state.devices ||= {});
    if (device?.width) devices[id] = device.id;
    else delete devices[id];
    // Its height depends on its width: measured again.
    if (this.state.heights) delete this.state.heights[id];
    const x = this.els.get(id);
    if (x) {
      x.key = '';
      this.syncTools(id);
    }
    if (this.d.live && this.d.live.activeId() === id) this.d.live.device?.(this.deviceOf(id), this.widthOf(id));
    this.relayout();
  }

  /** Zoom on one frame: `fit` — its width fills the board; `1` — 100%, its top-left in sight. */
  focus(id: string, mode: 'fit' | 1): void {
    const f = this.frames.find((x) => x.id === id);
    if (!f) return;
    const size = this.size();
    if (mode === 'fit') {
      const zoom = Math.min(4, Math.max(0.02, (size.w - 120) / f.w));
      this.view = { zoom, x: f.x - 60 / zoom, y: f.y - 90 / zoom };
    } else this.view = { zoom: 1, x: f.x - 60, y: f.y - 90 };
    this.selected = id;
    this.draw();
  }

  private syncTools(id: string): void {
    const x = this.els.get(id);
    if (!x) return;
    const cur = this.state.devices?.[id] || '';
    x.el.querySelectorAll<HTMLButtonElement>('[data-device]').forEach((b) => {
      const on = (b.dataset.device || '') === (this.deviceOf(id) ? cur : '');
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  private fit(draw = true): void {
    this.view = fitView(bounds(this.frames), this.size(), 60, 1);
    if (draw) this.draw();
  }

  private setZoom(z: number): void {
    const s = this.size();
    this.view = zoomAt(this.view, z / this.view.zoom, s.w / 2, s.h / 2);
    this.draw();
  }

  private zoomBy(f: number): void {
    const s = this.size();
    this.view = zoomAt(this.view, f, s.w / 2, s.h / 2);
    this.draw();
  }

  /** Next frame: transform, labels, which frames are live. */
  private draw(force = false): void {
    if (this.destroyed) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.paint(force));
  }

  private paint(force = false): void {
    const { x, y, zoom } = this.view;
    this.world.style.transform = `translate(${-x * zoom}px, ${-y * zoom}px) scale(${zoom})`;
    this.root.style.setProperty('--gjsp-inv', String(1 / zoom));
    this.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    const size = this.size();
    const vis = visibleFrames(this.frames, this.view, size, 0.5);
    // The nearest to the centre first; the rest stay boxes.
    const cx = x + size.w / zoom / 2;
    const cy = y + size.h / zoom / 2;
    const dist = (f: FrameBox) => Math.hypot(f.x + f.w / 2 - cx, f.y + f.h / 2 - cy);
    const live = new Set(
      vis
        .slice()
        .sort((a, b) => dist(a) - dist(b))
        .slice(0, this.d.maxLive || 24)
        .map((f) => f.id)
    );
    const byId = new Map(this.items.map((i) => [i.id, i]));
    const liveId = this.d.live?.activeId() ?? null;
    if (this.d.live) {
      const f = liveId ? this.frames.find((x) => x.id === liveId) : undefined;
      this.d.live.place(f ? { x: (f.x - x) * zoom, y: (f.y - y) * zoom, zoom } : null);
    }
    this.frames.forEach((f) => {
      let x2 = this.els.get(f.id);
      if (!x2) {
        if (!vis.includes(f)) return;
        x2 = this.makeFrame(f.id, byId.get(f.id)?.name || f.id);
      }
      const s = x2.el.style;
      s.left = `${f.x}px`;
      s.top = `${f.y}px`;
      s.width = `${f.w}px`;
      s.height = `${f.h}px`;
      x2.el.classList.toggle('is-selected', f.id === this.selected);
      x2.el.classList.toggle('is-current', f.id === (liveId ?? this.d.activeId()));
      x2.el.classList.toggle('is-live', !!liveId && f.id === liveId);
      const title = x2.el.querySelector('.gjsp-board__name');
      const name = byId.get(f.id)?.name || '';
      if (title && title.textContent !== name) title.textContent = name;
      if (live.has(f.id)) this.goLive(f.id, force);
      else if (x2.live) this.goStill(f.id);
    });
    this.saveSoon();
  }

  private makeFrame(id: string, name: string) {
    const body = h('div', { class: 'gjsp-board__body' }, h('span', { class: 'gjsp-board__wait' }, name));
    const t = this.d.t;
    const devs = this.deviceList();
    const icon = (w: number | null): string => (!w ? '🖥' : w <= 480 ? '📱' : '▭');
    const tool = (text: string, title: string, run: () => void, attrs: Record<string, string> = {}) =>
      h('button', { type: 'button', class: 'gjsp-board__tool', title, 'aria-label': title, ...attrs, onclick: (e: Event) => (e.stopPropagation(), run()) }, text);
    const tools = h(
      'div',
      { class: 'gjsp-board__tools' },
      ...(devs.length > 1
        ? devs.map((dv) => tool(icon(dv.width), dv.width ? `${dv.name} · ${dv.width}px` : `${dv.name} · ${this.width}px`, () => this.setDevice(id, dv.width ? dv : null), { 'data-device': dv.width ? dv.id : '' }))
        : []),
      tool('⤢', t('boardFitFrame'), () => this.focus(id, 'fit'), { 'data-role': 'fit-frame' }),
      tool('1:1', t('boardZoom100'), () => this.focus(id, 1), { 'data-role': 'frame-100' })
    );
    const el = h(
      'div',
      { class: 'gjsp-board__frame', 'data-id': id },
      h('div', { class: 'gjsp-board__label', 'data-drag': id }, h('span', { class: 'gjsp-board__name' }, name), tools),
      body
    );
    this.world.appendChild(el);
    const rec = { el, body, live: false, key: '' };
    this.els.set(id, rec);
    this.syncTools(id);
    return rec;
  }

  /** Draws a frame's markup (asks for it first). */
  private goLive(id: string, force = false): void {
    const x = this.els.get(id)!;
    x.live = true;
    const snap = this.snaps.get(id);
    if (!snap) {
      if (this.pending.has(id)) return;
      this.pending.add(id);
      x.el.classList.add('is-loading');
      void this.d
        .render(id, force)
        .then((s) => {
          this.pending.delete(id);
          if (this.destroyed || !s) return;
          this.snaps.set(id, s);
          this.draw();
        })
        .catch(() => this.pending.delete(id))
        .finally(() => x.el.classList.remove('is-loading'));
      return;
    }
    const key = `${snap.html.length}:${snap.css.length}:${hash(snap.html + snap.css)}`;
    if (x.key === key && x.body.querySelector('iframe')) return;
    x.key = key;
    const frame = h('iframe', { class: 'gjsp-board__iframe', sandbox: 'allow-same-origin', tabindex: '-1', 'aria-hidden': 'true' }) as HTMLIFrameElement;
    frame.style.width = `${this.widthOf(id)}px`;
    frame.addEventListener('load', () => this.measure(id, frame));
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8">${this.d.head()}<style>${snap.css}</style><style>html,body{overflow:hidden}html{height:auto}</style></head><body>${snap.html}</body></html>`;
    x.body.replaceChildren(frame);
  }

  private goStill(id: string): void {
    const x = this.els.get(id)!;
    x.live = false;
    x.key = '';
    const name = this.items.find((i) => i.id === id)?.name || '';
    x.body.replaceChildren(h('span', { class: 'gjsp-board__wait' }, name));
  }

  /** The frame takes its content's height (a row grows; moved frames too). */
  private measure(id: string, frame: HTMLIFrameElement): void {
    if (this.d.live?.activeId() === id) return; // the canvas frame gives its height
    let hgt = 0;
    try {
      // The content's height: the body's (the document's is at least the iframe's own).
      const doc = frame.contentDocument!;
      const body = doc.body;
      const st = body ? doc.defaultView!.getComputedStyle(body) : null;
      hgt = body ? body.scrollHeight + parseFloat(st!.marginTop || '0') + parseFloat(st!.marginBottom || '0') : doc.documentElement.scrollHeight;
    } catch {
      return;
    }
    hgt = Math.min(Math.max(Math.round(hgt), 120), 20000);
    const heights = (this.state.heights ||= {});
    if (Math.abs((heights[id] || 0) - hgt) < 2) return;
    heights[id] = hgt;
    this.relayout();
  }

  /* -------------------------------- events -------------------------------- */

  private listen(): void {
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window | Document, ev: K | string, fn: (e: any) => void, o?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn, o);
      this.offs.push(() => el.removeEventListener(ev, fn, o));
    };
    // Wheel: pan; Ctrl/⌘ (and trackpad pinch): zoom at the pointer.
    on(
      this.vp,
      'wheel',
      (e: WheelEvent) => {
        const r = this.vp.getBoundingClientRect();
        this.wheel(e, e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false }
    );
    // Drag: a frame by its title, else the board.
    on(this.vp, 'pointerdown', (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.gjsp-board__tools')) return;
      const frameEl = target.closest<HTMLElement>('.gjsp-board__frame');
      const dragId = target.closest<HTMLElement>('[data-drag]')?.dataset.drag;
      const pan = e.button === 1 || this.space || (!frameEl && e.button === 0);
      if (e.button === 0 && frameEl && !this.space) {
        this.selected = frameEl.dataset.id || null;
        // Live: a click on another frame puts it in the canvas.
        if (this.d.live && !dragId && this.selected && this.selected !== this.d.live.activeId()) this.d.live.activate(this.selected);
        this.draw();
      }
      if (!pan && !(dragId && e.button === 0)) return;
      e.preventDefault();
      this.vp.setPointerCapture?.(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, view: { ...this.view } };
      const f = dragId ? this.frames.find((x) => x.id === dragId) : null;
      const from = f ? { x: f.x, y: f.y } : null;
      this.vp.classList.add(pan ? 'is-panning' : 'is-moving');
      const move = (ev: PointerEvent): void => {
        const dx = (ev.clientX - start.x) / this.view.zoom;
        const dy = (ev.clientY - start.y) / this.view.zoom;
        if (pan) this.view = { ...start.view, x: start.view.x - dx, y: start.view.y - dy };
        else if (f && from) {
          f.x = Math.round(from.x + dx);
          f.y = Math.round(from.y + dy);
          (this.state.placed ||= {})[f.id] = { x: f.x, y: f.y };
        }
        this.draw();
      };
      const up = (): void => {
        this.vp.removeEventListener('pointermove', move);
        this.vp.removeEventListener('pointerup', up);
        this.vp.removeEventListener('pointercancel', up);
        this.vp.classList.remove('is-panning', 'is-moving');
        this.saveSoon();
      };
      this.vp.addEventListener('pointermove', move);
      this.vp.addEventListener('pointerup', up);
      this.vp.addEventListener('pointercancel', up);
    });
    on(this.vp, 'dblclick', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.gjsp-board__tools')) return;
      const id = (e.target as HTMLElement).closest<HTMLElement>('.gjsp-board__frame')?.dataset.id;
      if (id && this.d.live) this.d.live.activate(id);
      else if (id) this.d.open(id);
    });
    on(this.root, 'keydown', (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,select,textarea')) return;
      const k = e.key;
      if (k === 'Escape') this.d.close();
      else if (k === ' ') {
        this.space = true;
        this.vp.classList.add('is-space');
      } else if (k === 'Enter' && this.selected) {
        if (this.d.live) this.d.live.activate(this.selected);
        else this.d.open(this.selected);
      }
      else if ((k === '!' || k === '1') && e.shiftKey) this.fit();
      else if ((k === ')' || k === '0') && (e.shiftKey || e.ctrlKey || e.metaKey)) this.setZoom(1);
      else if (k === '+' || k === '=') this.zoomBy(1.25);
      else if (k === '-' || k === '_') this.zoomBy(1 / 1.25);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    on(this.root, 'keyup', (e: KeyboardEvent) => {
      if (e.key === ' ') {
        this.space = false;
        this.vp.classList.remove('is-space');
      }
    });
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.draw());
      ro.observe(this.vp);
      this.offs.push(() => ro.disconnect());
    }
  }

  /**
   * Wheel: pan; Ctrl/⌘ (and a trackpad's pinch): zoom at (sx, sy) — screen
   * px from the board's top-left. Live: the canvas frame passes its own
   * wheel events here.
   */
  wheel(e: WheelEvent, sx: number, sy: number): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      this.view = zoomAt(this.view, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), sx, sy);
    } else {
      const k = e.deltaMode === 1 ? 20 : 1;
      const dx = (e.shiftKey ? e.deltaY : e.deltaX) * k;
      const dy = (e.shiftKey ? 0 : e.deltaY) * k;
      this.view = { ...this.view, x: this.view.x + dx / this.view.zoom, y: this.view.y + dy / this.view.zoom };
    }
    this.draw();
  }

  /** The current zoom (live: the canvas frame scales with the board). */
  get zoom(): number {
    return this.view.zoom;
  }

  /** A fresh snapshot of a record (the one being edited, after a change). */
  setSnapshot(id: string, snap: BoardSnapshot): void {
    this.snaps.set(id, snap);
    const x = this.els.get(id);
    if (x) x.key = '';
    this.draw();
  }

  /** A frame's height measured elsewhere (live: the canvas frame's). */
  setHeight(id: string, h: number): void {
    const v = Math.min(Math.max(Math.round(h), 120), 20000);
    const heights = (this.state.heights ||= {});
    if (Math.abs((heights[id] || 0) - v) < 2) return;
    heights[id] = v;
    this.relayout();
  }

  /** Frames being drawn: `done` of `total` (`total` 0 — none). */
  setProgress(done: number, total: number): void {
    this.progress = { done, total };
    this.showVeil();
  }

  /** Something the board waits for (a page being opened); `null` — done. */
  setBusy(text: string | null): void {
    this.busyText = text;
    this.showVeil();
  }

  private showVeil(): void {
    const { done, total } = this.progress;
    const on = !!this.busyText || total > done;
    this.veil.hidden = !on;
    this.root.classList.toggle('is-busy', on);
    if (!on) return;
    this.veilText.textContent = this.busyText || this.d.t('boardLoading').replace('%s', `${done}/${total}`);
    this.veilBar.style.width = total ? `${Math.round((done / total) * 100)}%` : '100%';
    this.veilBar.classList.toggle('is-indeterminate', !total);
  }

  /** Redraw (the live record changed). */
  update(): void {
    this.draw();
  }

  private drawChips(): void {
    const shown = new Set(this.shown());
    const count = (s: BoardSection) => this.items.filter((i) => i.section === s).length;
    this.chips.replaceChildren(
      ...SECTIONS.filter((s) => count(s)).map((s) =>
        h(
          'button',
          {
            type: 'button',
            class: `gjsp-board__chip${shown.has(s) ? ' is-on' : ''}`,
            'data-section': s,
            'aria-pressed': String(shown.has(s)),
            onclick: () => {
              const next = new Set(this.shown());
              if (next.has(s)) next.delete(s);
              else next.add(s);
              this.state.sections = SECTIONS.filter((x) => next.has(x));
              this.drawChips();
              this.relayout();
            },
          },
          `${this.d.t(LABEL[s])} · ${count(s)}`
        )
      )
    );
  }

  private saveSoon(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 400);
  }

  private flushSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.d.save({ ...this.state, view: { ...this.view } });
  }

  /* --------------------------------- tests -------------------------------- */

  /** The frame boxes (tests, other plugins). */
  get layout(): FrameBox[] {
    return this.frames.map((f) => ({ ...f }));
  }

  get currentView(): View {
    return { ...this.view };
  }
}

function hash(s: string): number {
  let x = 0;
  for (let i = 0; i < s.length; i += Math.max(1, Math.floor(s.length / 2048))) x = (x * 31 + s.charCodeAt(i)) | 0;
  return x;
}
