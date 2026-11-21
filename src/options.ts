import type { PluginMeta } from './contract';
import type { KeyBindings, PagesOptions, ResolvedOptions } from './types';

export const DEFAULT_KEYS: KeyBindings = {
  undo: 'ctrl+z, ⌘+z',
  redo: 'ctrl+y, ctrl+shift+z, ⌘+shift+z, ⌘+y',
  copy: 'ctrl+c, ⌘+c',
  paste: 'ctrl+v, ⌘+v',
};

export const DEFAULT_OPTIONS: ResolvedOptions = {
  dbName: 'gjs-pages-manager',
  store: null,
  serverUrl: '',
  autosaveDelay: 600,
  historyLimit: 50,
  settleMs: 150,
  takeOverCopyPaste: true,
  workspaceTabs: true,
  keys: DEFAULT_KEYS,
  blank: null,
  headers: null,
  labels: {},
  panelId: null,
  sidebarContainer: null,
  injectCss: true,
  remote: null,
  slotTag: 'page-slot',
  archiveName: '',
  board: true,
  boardLive: true,
  boardWidth: 1280,
};

const TAG_RE = /^[a-z][a-z0-9]*-[a-z0-9-]*$/;

const num = (v: unknown, def: number, min: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min ? v : def;

/** Merges user options over the defaults; invalid numbers fall back to defaults. */
export function resolveOptions(user: PagesOptions = {}): ResolvedOptions {
  const o = user || {};
  const keys: KeyBindings = { ...DEFAULT_KEYS };
  (Object.keys(DEFAULT_KEYS) as (keyof KeyBindings)[]).forEach((k) => {
    const v = o.keys?.[k];
    if (typeof v === 'string' && v.trim()) keys[k] = v;
  });
  return {
    ...DEFAULT_OPTIONS,
    ...o,
    dbName: typeof o.dbName === 'string' && o.dbName ? o.dbName : DEFAULT_OPTIONS.dbName,
    serverUrl: typeof o.serverUrl === 'string' ? o.serverUrl : '',
    autosaveDelay: num(o.autosaveDelay, DEFAULT_OPTIONS.autosaveDelay, 0),
    historyLimit: num(o.historyLimit, DEFAULT_OPTIONS.historyLimit, 1),
    settleMs: num(o.settleMs, DEFAULT_OPTIONS.settleMs, 0),
    takeOverCopyPaste: o.takeOverCopyPaste !== false,
    workspaceTabs: o.workspaceTabs !== false,
    board: o.board !== false,
    boardLive: o.boardLive !== false,
    boardWidth: num(o.boardWidth, DEFAULT_OPTIONS.boardWidth, 240),
    injectCss: o.injectCss !== false,
    store: o.store ?? null,
    blank: o.blank ?? null,
    headers: typeof o.headers === 'function' ? o.headers : null,
    panelId: o.panelId ?? null,
    sidebarContainer: o.container ?? o.sidebarContainer ?? null,
    keys,
    labels: { ...(o.labels || {}) },
    remote: o.remote && typeof o.remote.url === 'string' && o.remote.url.trim() ? { ...o.remote } : null,
    // A custom element name: lower case with a dash.
    archiveName: typeof o.archiveName === 'string' || typeof o.archiveName === 'function' ? o.archiveName : '',
    slotTag: typeof o.slotTag === 'string' && TAG_RE.test(o.slotTag) ? o.slotTag : DEFAULT_OPTIONS.slotTag,
  };
}

export const PLUGIN_ID = 'grapesjs-site-pages';
/** Version of this package (a test checks it against package.json). */
export const VERSION = '2.16.0';

/** Options for forms (plugin contract). Changes apply after a reload. */
export const META: PluginMeta = {
  id: PLUGIN_ID,
  version: VERSION,
  title: 'Site Pages',
  description: 'Pages, layouts, templates and linked components; local storage or a server.',
  options: [
    {
      key: 'remote',
      type: 'json',
      default: null,
      title: 'Server (remote mode)',
      description: '{ "url": "/admin/cms/editor" } — the server keeps the site; null — local pages with manual sync.',
    },
    { key: 'serverUrl', type: 'string', default: '', title: 'Sync server (local mode)', description: 'REST API v1 for manual sync; also set in the panel.' },
    { key: 'autosaveDelay', type: 'number', default: DEFAULT_OPTIONS.autosaveDelay, title: 'Autosave delay, ms' },
    { key: 'historyLimit', type: 'number', default: DEFAULT_OPTIONS.historyLimit, title: 'Undo steps per page' },
    { key: 'workspaceTabs', type: 'boolean', default: true, title: 'Pages as workspace tabs', description: 'With grapesjs-sidebar-tools.' },
    { key: 'takeOverCopyPaste', type: 'boolean', default: true, title: 'Copy/paste between pages' },
    { key: 'keys', type: 'json', default: { ...DEFAULT_KEYS }, title: 'Shortcuts', advanced: true },
    { key: 'slotTag', type: 'string', default: DEFAULT_OPTIONS.slotTag, title: 'Layout slot tag', advanced: true },
    { key: 'archiveName', type: 'string', default: '', title: 'Archive file name', description: 'Without .zip; empty — site name and date.', advanced: true },
    { key: 'dbName', type: 'string', default: DEFAULT_OPTIONS.dbName, title: 'IndexedDB database', advanced: true },
    { key: 'settleMs', type: 'number', default: DEFAULT_OPTIONS.settleMs, title: 'Settle time after load, ms', advanced: true },
    { key: 'panelId', type: 'string', default: '', title: 'Panel of the "Pages" button', description: 'Empty — auto.', advanced: true },
    { key: 'container', type: 'string', default: '', title: 'Sidebar container (CSS selector)', description: 'Empty — auto.', aliases: ['sidebarContainer'], advanced: true },
    { key: 'labels', type: 'json', default: {}, title: 'Texts', advanced: true },
    { key: 'injectCss', type: 'boolean', default: true, title: 'Inject CSS', advanced: true },
  ],
};

/** The options a form can show (no functions or stores). */
export function publicOptions(o: ResolvedOptions): Record<string, unknown> {
  const r = o.remote;
  return {
    remote: r
      ? {
          url: r.url,
          ...(r.credentials ? { credentials: r.credentials } : {}),
          ...(r.refreshInterval !== undefined ? { refreshInterval: r.refreshInterval } : {}),
          ...(r.retryDelay !== undefined ? { retryDelay: r.retryDelay } : {}),
          ...(r.cacheDbName ? { cacheDbName: r.cacheDbName } : {}),
        }
      : null,
    serverUrl: o.serverUrl,
    autosaveDelay: o.autosaveDelay,
    historyLimit: o.historyLimit,
    workspaceTabs: o.workspaceTabs,
    takeOverCopyPaste: o.takeOverCopyPaste,
    keys: { ...o.keys },
    slotTag: o.slotTag,
    archiveName: typeof o.archiveName === 'string' ? o.archiveName : '',
    dbName: o.dbName,
    settleMs: o.settleMs,
    panelId: o.panelId || '',
    container: o.sidebarContainer || '',
    labels: { ...o.labels },
    injectCss: o.injectCss,
  };
}
