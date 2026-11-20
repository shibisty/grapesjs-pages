import type { Editor } from 'grapesjs';
import { report } from '../utils';

/** Class of the canvas element while the board is in it. */
export const LIVE_CLASS = 'gjsp-board-live';
const BUSY_CLASS = 'gjsp-board-busy';
const FRAME_STYLE_ID = 'gjsp-board-frame-css';

/** Inside the canvas frame: the page takes its content's height (not the frame's). */
const FRAME_CSS = 'html,body{height:auto!important;min-height:0!important;overflow:hidden!important}[data-gjs-type="wrapper"]{min-height:240px!important}';

/**
 * The editor's canvas as the board's surface: the frame takes the board's
 * width and its content's height, GrapesJS's zoom and coordinates follow
 * the board's view (so selection, the toolbar and drag and drop work as
 * usual), the wheel inside the frame moves the board. `exit()` puts the
 * canvas back as it was.
 */
export class LiveCanvas {
  private saved: { zoom: number; x: number; y: number } | null = null;
  private ro: ResizeObserver | null = null;
  private watched: Element | null = null;
  private docs = new Set<Document>();
  private readonly offs: Array<() => void> = [];
  private last: { x: number; y: number; zoom: number } | null = null;
  private active = false;
  private fixing = false;

  constructor(
    private readonly editor: Editor,
    private width: number,
    private readonly o: {
      /** The canvas frame's height changed (content px). */
      onHeight(h: number): void;
      /** A wheel event in the frame, at screen px from the canvas element's top-left. */
      onWheel(e: WheelEvent, sx: number, sy: number): void;
    }
  ) {}

  get canvasEl(): HTMLElement | null {
    try {
      return ((this.editor.Canvas as any)?.getElement?.() as HTMLElement) || null;
    } catch {
      return null;
    }
  }

  enter(): void {
    const cv = this.editor.Canvas as any;
    this.saved = { zoom: cv.getZoom?.() ?? 100, ...(cv.getCoords?.() || { x: 0, y: 0 }) };
    this.active = true;
    this.canvasEl?.classList.add(LIVE_CLASS);
    const reapply = (): void => {
      if (!this.active) return;
      this.dims();
      this.frameDoc();
      if (this.last) this.place(this.last);
    };
    const evs = 'canvas:frame:load change:device device:select';
    this.editor.on(evs, reapply);
    this.offs.push(() => this.editor.off(evs, reapply));
    // Others set the zoom too (a device toolbar's "fit" after a load): the board's wins.
    const hold = (): void => {
      if (!this.active || !this.last || this.fixing) return;
      this.fixing = true;
      setTimeout(() => {
        this.fixing = false;
        if (this.active && this.last) this.place(this.last);
      }, 0);
    };
    this.editor.on('canvas:zoom canvas:coords', hold);
    this.offs.push(() => this.editor.off('canvas:zoom canvas:coords', hold));
    // A new frame after a load takes its size a moment later.
    const t = setTimeout(reapply, 300);
    this.offs.push(() => clearTimeout(t));
    // A record opened (a new project): the frame is new.
    const opened = (): void => void setTimeout(reapply, 0);
    this.editor.on('pages-manager:open load', opened);
    this.offs.push(() => this.editor.off('pages-manager:open load', opened));
    reapply();
  }

  /** Puts the frame at (x, y) screen px with the board's zoom; `null` hides it. */
  place(p: { x: number; y: number; zoom: number } | null): void {
    if (!this.active || !(this.editor as any).Canvas) return;
    const el = this.canvasEl;
    el?.classList.toggle('gjsp-board-nolive', !p);
    if (!p) return;
    this.last = p;
    this.dims();
    const cv = this.editor.Canvas as any;
    const z = Math.max(1, p.zoom * 100);
    if (Math.abs((cv.getZoom?.() ?? 100) - z) > 1e-6) cv.setZoom(z);
    // The frames' area may start off the canvas's corner (rulers): the board's coordinates are the canvas's.
    const fa = cv.getFramesEl?.() as HTMLElement | undefined;
    const x = p.x - (fa?.offsetLeft || 0);
    const y = p.y - (fa?.offsetTop || 0);
    const c = cv.getCoords?.() || { x: 0, y: 0 };
    if (Math.abs(c.x - x) > 0.01 || Math.abs(c.y - y) > 0.01) cv.setCoords(x, y);
  }

  /** The frame's width (the device it is shown as). */
  setWidth(w: number): void {
    if (w === this.width) return;
    this.width = w;
    this.dims();
  }

  /** While other records are rendered (the canvas takes them in turn): the frame is hidden. */
  setBusy(b: boolean): void {
    this.canvasEl?.classList.toggle(BUSY_CLASS, b);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.offs.splice(0).forEach((f) => f());
    this.ro?.disconnect();
    this.ro = null;
    this.watched = null;
    this.docs.forEach((d) => d.getElementById(FRAME_STYLE_ID)?.remove());
    this.docs.clear();
    const el = this.canvasEl;
    el?.classList.remove(LIVE_CLASS, BUSY_CLASS, 'gjsp-board-nolive');
    const cv = this.editor.Canvas as any;
    try {
      // The device's size again, the zoom and the coordinates the editor had.
      const model = cv.getModel?.() || cv.canvas;
      if (model?.updateDevice) model.updateDevice();
      else this.frameModel()?.set({ width: '', height: '' });
      if (this.saved) {
        cv.setZoom(this.saved.zoom);
        cv.setCoords(this.saved.x, this.saved.y);
      }
      this.editor.refresh?.();
    } catch (e) {
      report(e);
    }
  }

  private frameModel(): any {
    const em = (this.editor as any).getModel?.();
    return em?.getCurrentFrameModel?.() || (this.editor.Canvas as any).getFrames?.()[0] || null;
  }

  /** The frame: the board's width, its content's height. */
  private dims(): void {
    const f = this.frameModel();
    if (!f) return;
    if (f.get('width') !== `${this.width}px` || f.get('height') !== 'auto') f.set({ width: `${this.width}px`, height: 'auto' }, { noUndo: 1 });
    const wrap = (this.editor.Canvas as any).getFrameEl?.()?.parentElement as HTMLElement | undefined;
    if (wrap && wrap !== this.watched && typeof ResizeObserver !== 'undefined') {
      this.ro?.disconnect();
      this.watched = wrap;
      this.ro = new ResizeObserver(() => {
        const h = wrap.offsetHeight;
        if (h > 0) this.o.onHeight(h);
      });
      this.ro.observe(wrap);
    }
  }

  /** Inside the frame: auto height; the wheel moves the board. */
  private frameDoc(): void {
    let doc: Document | undefined;
    try {
      doc = (this.editor.Canvas as any).getDocument?.();
    } catch {
      doc = undefined;
    }
    if (!doc?.head || this.docs.has(doc)) return;
    this.docs.add(doc);
    const st = doc.createElement('style');
    st.id = FRAME_STYLE_ID;
    st.textContent = FRAME_CSS;
    doc.head.appendChild(st);
    const win = doc.defaultView;
    const onWheel = (e: WheelEvent): void => {
      if (!this.active) return;
      const frameEl = (this.editor.Canvas as any).getFrameEl?.() as HTMLIFrameElement | undefined;
      const cvEl = this.canvasEl;
      if (!frameEl || !cvEl) return;
      const fr = frameEl.getBoundingClientRect();
      const cr = cvEl.getBoundingClientRect();
      const z = this.last?.zoom || 1;
      this.o.onWheel(e, fr.left - cr.left + e.clientX * z, fr.top - cr.top + e.clientY * z);
    };
    win?.addEventListener('wheel', onWheel, { passive: false, capture: true });
    this.offs.push(() => win?.removeEventListener('wheel', onWheel, { capture: true } as any));
  }
}
