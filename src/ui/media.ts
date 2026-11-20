import type { Editor } from 'grapesjs';

/**
 * Picking media for a field: the editor's own Asset Manager and, when
 * grapesjs-cloud-assets is on the page, its cloud picker (found by the
 * command name, no import).
 *
 * Both open above whatever dialog is open: GrapesJS has one modal, and
 * `editor.Modal.open()` would replace a page's properties or a data form
 * together with its unsaved fields. So the Asset Manager's own view
 * (`AssetManager.render()`: list, upload, add by URL) is shown in an
 * overlay of ours, and the cloud picker is asked for its overlay too.
 *
 * The same file is used by grapesjs-storage and grapesjs-site-pages
 * (copies, no shared package): keep them identical.
 */

export type MediaKind = 'image' | 'file';

export interface PickedMedia {
  url: string;
  name?: string;
  /** Epoch ms: a temporary link (Dropbox, OneDrive, S3 of the cloud picker). */
  expiresAt?: number;
  /** Where it came from: `assets` or the cloud provider's id. */
  provider?: string;
}

export interface MediaSource {
  id: 'assets' | 'cloud';
  label: string;
}

export const CLOUD_PICK_COMMAND = 'cloud-assets:pick';

export interface MediaLabels {
  assets: string;
  cloud: string;
  choose: string;
  /** %s — count */
  chooseN: string;
  cancel: string;
}

/** The sources this editor has: the Asset Manager always, the cloud with grapesjs-cloud-assets. */
export function mediaSources(editor: Editor, labels: Pick<MediaLabels, 'assets' | 'cloud'>): MediaSource[] {
  const out: MediaSource[] = [];
  if ((editor as any).AssetManager) out.push({ id: 'assets', label: labels.assets });
  if (hasCloud(editor)) out.push({ id: 'cloud', label: labels.cloud });
  return out;
}

export function hasCloud(editor: Editor): boolean {
  try {
    const cmds = editor.Commands as any;
    return !!(cmds.has ? cmds.has(CLOUD_PICK_COMMAND) : cmds.get?.(CLOUD_PICK_COMMAND));
  } catch {
    return false;
  }
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?|#|$)/i;
export const isImageUrl = (url: string, type?: string): boolean => type === 'image' || IMAGE_RE.test(url) || url.startsWith('data:image/');

export function pickMedia(editor: Editor, source: MediaSource['id'], o: { kind: MediaKind; multiple?: boolean; title?: string; labels: MediaLabels; pfx: string }): Promise<PickedMedia[] | null> {
  return source === 'cloud' ? pickFromCloud(editor, o) : pickFromAssets(editor, o);
}

/** grapesjs-cloud-assets' picker (in its overlay). */
export async function pickFromCloud(editor: Editor, o: { kind: MediaKind; multiple?: boolean; title?: string }): Promise<PickedMedia[] | null> {
  const res = (await Promise.resolve(editor.runCommand(CLOUD_PICK_COMMAND, { type: o.kind === 'image' ? 'image' : 'all', title: o.title, overlay: true }))) as Array<{
    src: string;
    name?: string;
    expiresAt?: number;
    provider?: string;
  }> | null;
  if (!res || !res.length) return null;
  const list = res.filter((a) => a && a.src).map((a) => ({ url: a.src, ...(a.name ? { name: a.name } : {}), ...(a.expiresAt ? { expiresAt: a.expiresAt } : {}), ...(a.provider ? { provider: a.provider } : {}) }));
  return list.length ? (o.multiple ? list : list.slice(0, 1)) : null;
}

/**
 * The Asset Manager's view in an overlay. A click marks an asset (several
 * with `multiple`), a double click takes it at once; uploads and "add by
 * URL" of the Asset Manager work as usual. With a custom Asset Manager UI
 * (`assetManager.custom`) its own `open({ select })` is used instead.
 */
export function pickFromAssets(editor: Editor, o: { kind: MediaKind; multiple?: boolean; title?: string; labels: MediaLabels; pfx: string }): Promise<PickedMedia[] | null> {
  const am = (editor as any).AssetManager;
  if (!am) return Promise.resolve(null);
  const of = (a: any): PickedMedia => {
    const url = String(a?.getSrc?.() || a?.get?.('src') || '');
    const name = a?.get?.('name');
    return { url, ...(name ? { name: String(name) } : {}), provider: 'assets' };
  };

  if (am.getConfig?.().custom || typeof am.render !== 'function' || typeof am.__behaviour !== 'function') {
    return new Promise((resolve) => {
      let done = false;
      am.open({
        types: o.kind === 'image' ? ['image'] : [],
        select(asset: any, complete: boolean) {
          if (done || !complete) return;
          done = true;
          am.close();
          resolve([of(asset)]);
        },
      });
      (editor.Modal as any)?.onceClose?.(() => !done && ((done = true), resolve(null)));
    });
  }

  return new Promise((resolve) => {
    const p = o.pfx;
    const L = o.labels;
    const chosen: any[] = [];
    let finished = false;
    const all = am.getAll().models as any[];
    const shown = o.kind === 'image' ? all.filter((a) => isImageUrl(String(a.getSrc?.() || a.get('src') || ''), a.get('type'))) : all;
    const view = am.render(shown) as HTMLElement;

    const overlay = document.createElement('div');
    overlay.className = `${p}-ov`;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const dialog = document.createElement('div');
    dialog.className = `${p}-ov-dialog gjs-one-bg gjs-two-color`;
    const head = document.createElement('div');
    head.className = `${p}-ov-head`;
    const title = document.createElement('div');
    title.className = `${p}-ov-title`;
    title.textContent = o.title || L.assets;
    overlay.setAttribute('aria-label', title.textContent);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = `${p}-ov-close`;
    x.setAttribute('aria-label', L.cancel);
    x.textContent = '×';
    head.append(title, x);
    const body = document.createElement('div');
    body.className = `${p}-ov-body`;
    body.appendChild(view);
    const foot = document.createElement('div');
    foot.className = `${p}-ov-foot`;
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = `${p}-primary`;
    ok.setAttribute('data-role', 'pick-ok');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = `${p}-secondary`;
    cancel.textContent = L.cancel;
    foot.append(ok, cancel);
    dialog.append(head, body, foot);
    overlay.appendChild(dialog);

    const relabel = (): void => {
      ok.disabled = !chosen.length;
      ok.textContent = o.multiple && chosen.length > 1 ? L.chooseN.replace('%s', String(chosen.length)) : L.choose;
    };
    const mark = (): void => {
      const urls = new Set(chosen.map((a) => of(a).url));
      // The Asset Manager highlights the last clicked one only; with `multiple` every chosen one is marked.
      if (o.multiple)
        am.getAll().models.forEach((m: any) => {
          const el = m.view?.el as HTMLElement | undefined;
          el?.classList.toggle('gjs-highlight', urls.has(of(m).url));
          el?.classList.toggle(`${p}-chosen`, urls.has(of(m).url));
        });
    };
    const finish = (value: PickedMedia[] | null): void => {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', onKey, true);
      am.__behaviour({ select: undefined, types: undefined, options: undefined });
      overlay.remove();
      resolve(value && value.length ? value : null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      finish(null);
    };
    am.__behaviour({
      types: o.kind === 'image' ? ['image'] : [],
      select(asset: any, complete: boolean) {
        if (!asset) return;
        const i = chosen.findIndex((a) => of(a).url === of(asset).url);
        if (complete) {
          if (i < 0) chosen.push(asset);
          finish((o.multiple ? chosen : [asset]).map(of));
          return;
        }
        if (o.multiple) {
          if (i >= 0) chosen.splice(i, 1);
          else chosen.push(asset);
        } else chosen.splice(0, chosen.length, asset);
        relabel();
        mark();
      },
    });
    ok.addEventListener('click', () => finish(chosen.map(of)));
    cancel.addEventListener('click', () => finish(null));
    x.addEventListener('click', () => finish(null));
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) finish(null);
    });
    document.addEventListener('keydown', onKey, true);
    relabel();
    document.body.appendChild(overlay);
  });
}

/** The overlay's look (`pfx` — the plugin's class prefix). */
export const mediaCss = (p: string): string => `
.${p}-ov{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.55);font-family:var(--gjs-main-font,Helvetica,sans-serif);font-size:13px}
.${p}-ov-dialog{display:flex;flex-direction:column;width:90%;max-width:850px;max-height:calc(100vh - 32px);background:var(--gjs-primary-color,#444);color:var(--gjs-font-color,#ddd);border-radius:3px;box-shadow:0 8px 32px rgba(0,0,0,.5);overflow:hidden}
.${p}-ov-head{display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px solid rgba(0,0,0,.2)}
.${p}-ov-title{font-size:15px}
.${p}-ov-close{background:none;border:0;color:inherit;font-size:22px;line-height:1;cursor:pointer;opacity:.8}
.${p}-ov-body{flex:1;min-height:0;overflow:auto;padding:10px 15px}
.${p}-ov-body .gjs-am-assets-cont{height:auto;min-height:240px}
.${p}-ov-foot{display:flex;gap:6px;justify-content:flex-end;padding:10px 15px;border-top:1px solid rgba(0,0,0,.2)}
.${p}-ov-foot button[disabled]{opacity:.5;cursor:default}
.${p}-chosen{outline:2px solid var(--gjs-quaternary-color,#d278c9);outline-offset:-2px}
`;
