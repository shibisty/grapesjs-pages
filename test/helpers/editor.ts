import grapesjs, { type Editor } from 'grapesjs';
import pagesPlugin, { getPagesManager } from '../../src/index';
import { MemoryPageStore } from '../../src/store/MemoryPageStore';
import type { PagesManagerApi, PagesOptions } from '../../src/types';

export const SAMPLE_HTML = '<section id="sec"><h1 id="title">Hello</h1><p id="p1" class="lead">One</p></section>';
export const SAMPLE_CSS = '#title{color:red}.lead{font-size:20px}';

export interface Setup {
  editor: Editor;
  api: PagesManagerApi;
  store: MemoryPageStore;
}

export interface CreateOpts {
  plugin?: PagesOptions;
  html?: string;
  css?: string;
  /** Extra grapesjs.init config. */
  config?: Record<string, unknown>;
  /** Don't wait for the plugin to be ready. */
  noWait?: boolean;
}

/** A real grapesjs editor in jsdom with the plugin and a fast in-memory store. */
export async function createEditor(o: CreateOpts = {}): Promise<Setup> {
  const container = document.createElement('div');
  container.id = 'gjs';
  document.body.append(container);
  const store = (o.plugin?.store as MemoryPageStore) || new MemoryPageStore();
  const editor = grapesjs.init({
    container,
    height: '600px',
    storageManager: false,
    telemetry: false,
    components: o.html ?? SAMPLE_HTML,
    style: o.css ?? SAMPLE_CSS,
    plugins: [(ed: Editor) => pagesPlugin(ed, { settleMs: 0, autosaveDelay: 5, ...o.plugin, store })],
    ...o.config,
  } as Parameters<typeof grapesjs.init>[0]);
  const api = getPagesManager(editor)!;
  if (!o.noWait) await api.whenReady();
  await tick();
  return { editor, api, store };
}

export async function destroyEditor(editor: Editor | undefined): Promise<void> {
  if (!editor) return;
  // Let GrapesJS' own debounced handlers (selector manager, layers) run
  // before the teardown, otherwise they fire on a destroyed editor.
  try {
    editor.select([]);
  } catch {
    /* already gone */
  }
  await new Promise((r) => setTimeout(r, 30));
  try {
    editor.destroy();
  } catch {
    /* jsdom teardown noise */
  }
  document.body.innerHTML = '';
}

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Waits for the debounced autosave to land. */
export const settle = async (api: PagesManagerApi): Promise<void> => {
  await tick(20);
  await api.flush();
};

export const html = (editor: Editor): string => editor.getHtml();

export function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

export function sidebar(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.gjsp');
  if (!el) throw new Error('no sidebar');
  return el;
}

export function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.gjsp-item')];
}

export const names = (): string[] => rows().map((r) => r.querySelector('.gjsp-name')!.textContent || '');
