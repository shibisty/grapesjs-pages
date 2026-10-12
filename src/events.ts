/** Events the plugin triggers on the editor (`editor.on(EVENTS.open, …)`). */
export const EVENTS = {
  /** The active page is loaded and the plugin is ready. */
  ready: 'pages-manager:ready',
  /** A page was opened. Payload: the `PageRecord`. */
  open: 'pages-manager:open',
  /** The page list or a page's metadata changed (create/rename/save/sync…). */
  change: 'pages-manager:change',
  /** Undo/redo availability of the active page may have changed. */
  history: 'pages-manager:history',
  /** Components copied. Payload: `{ count }`. */
  copy: 'pages-manager:copied',
  /** Components pasted. Payload: `{ count, components }`. */
  paste: 'pages-manager:pasted',
  /** Server settings changed. Payload: `ServerSettings`. */
  settings: 'pages-manager:settings',
  /** A sync run finished. Payload: `{ ok, errors }`. */
  sync: 'pages-manager:synced',
} as const;

/** Command ids registered by the plugin. */
export const COMMANDS = {
  open: 'pages-manager:open',
  toggle: 'pages-manager:toggle',
  copy: 'pages-manager:copy',
  paste: 'pages-manager:paste',
  sync: 'pages-manager:sync',
  settings: 'pages-manager:settings',
} as const;
