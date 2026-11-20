/** Events the plugin triggers on the editor (`editor.on(EVENTS.open, …)`). */
export const EVENTS = {
  /** The active page is loaded and the plugin is ready. */
  ready: 'pages-manager:ready',
  /** A page was opened. Payload: the `PageRecord`. */
  open: 'pages-manager:open',
  /** The canvas was let go (`detach()`): no record is open. */
  detach: 'pages-manager:detach',
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
  /** Remote mode: a record went live. Payload: `{ record, revision, warnings }`. */
  publish: 'pages-manager:published',
  /** Remote mode: a save hit a newer server version. Payload: the `PageRecord`. */
  conflict: 'pages-manager:conflict',
  /** Remote mode: the connection state changed. Payload: `'idle' | 'saving' | 'offline' | 'error'`. */
  remote: 'pages-manager:remote',
  /** A site archive was made. Payload: `{ bytes: Uint8Array }`. */
  exported: 'pages-manager:exported',
  /** A site archive was imported. Payload: the `ImportReport`. */
  imported: 'pages-manager:imported',
  /** The list of components changed. Payload: `Master[]`. */
  components: 'pages-manager:components',
  /** A component's content changed from one of its instances (edited in place). Payload: `{ id, record }`. */
  componentSaved: 'pages-manager:component-saved',
  /**
   * Asked for each record shown in the sidebar: push `{ id, label, icon?, run(record) }`
   * into `actions` to add a button to it. Payload: `{ record, actions }`.
   */
  recordActions: 'pages-manager:record-actions',
  /**
   * Asked when the "new page" or "properties" dialog opens: push a
   * `RecordFormSection` into `sections`. Payload: `RecordFormRequest`.
   */
  recordForm: 'pages-manager:record-form',
  /** A shared project key got a new value (`shared.register`). Payload: `{ key, value }`. */
  shared: 'pages-manager:shared',
  /** The board was opened or closed. Payload: `{ open }`. */
  board: 'pages-manager:board',
  /**
   * A record is about to be rendered for the board (opened silently).
   * Payload: `{ record, waitFor(promise), placeholders, inPlace }` — plugins
   * that fill the canvas from their own data (grapesjs-storage) load it and
   * pass the promise; `placeholders`: draw the fields as placeholders in the
   * markup (the board shows templates); `inPlace`: the record is already in
   * the canvas. `pages-manager:rendered` follows.
   */
  rendering: 'pages-manager:rendering',
  /** The board took the record's markup: plugins go back to normal. Payload: `{ record }`. */
  rendered: 'pages-manager:rendered',
} as const;

/** Command ids registered by the plugin. */
export const COMMANDS = {
  open: 'pages-manager:open',
  toggle: 'pages-manager:toggle',
  copy: 'pages-manager:copy',
  paste: 'pages-manager:paste',
  sync: 'pages-manager:sync',
  settings: 'pages-manager:settings',
  publish: 'pages-manager:publish',
  revisions: 'pages-manager:revisions',
  properties: 'pages-manager:properties',
  /** Opens the "SEO of the site" dialog. */
  siteSeo: 'pages-manager:site-seo',
  refresh: 'pages-manager:refresh',
  /** Opens the export dialog of the site archive. */
  exportArchive: 'pages-manager:export',
  /** Opens the import dialog of the site archive. */
  importArchive: 'pages-manager:import',
  /** Saves the selected component as a linked component (`{ component?, name? }`). */
  saveComponent: 'pages-manager:component-save',
  /** Opens the component of the selected instance (`{ component? }`). */
  editComponent: 'pages-manager:component-edit',
  /** Turns the selected instance into a plain copy (`{ component? }`). */
  detachComponent: 'pages-manager:component-detach',
  /** Opens (toggles) the board of all pages: Figma-like, over the editor. */
  board: 'pages-manager:board',
} as const;
