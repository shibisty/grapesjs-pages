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
} as const;
