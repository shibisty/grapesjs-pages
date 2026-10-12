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
  keys: DEFAULT_KEYS,
  blank: null,
  headers: null,
  labels: {},
  panelId: null,
  sidebarContainer: null,
  injectCss: true,
};

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
    injectCss: o.injectCss !== false,
    store: o.store ?? null,
    blank: o.blank ?? null,
    headers: typeof o.headers === 'function' ? o.headers : null,
    panelId: o.panelId ?? null,
    sidebarContainer: o.sidebarContainer ?? null,
    keys,
    labels: { ...(o.labels || {}) },
  };
}
