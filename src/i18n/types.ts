/**
 * Every UI string of the plugin. `%s` is a placeholder filled in order.
 */
export interface PagesLabels {
  pages: string;
  newPage: string;
  sync: string;
  settings: string;
  undo: string;
  redo: string;
  rename: string;
  duplicate: string;
  remove: string;
  /** %s — page name */
  confirmRemove: string;
  promptName: string;
  /** Base of auto-generated names: "Page 1", "Page 2"… */
  defaultName: string;
  copySuffix: string;
  serverSuffix: string;
  /** %s — count */
  copied: string;
  /** %s — count */
  pasted: string;
  noServer: string;
  /** %s — URL */
  server: string;
  /** %s — date */
  lastSync: string;
  unsynced: string;
  onServer: string;
  localOnly: string;
  notSent: string;
  serverUrl: string;
  token: string;
  test: string;
  save: string;
  close: string;
  /** %s — count */
  connOk: string;
  /** %s — error */
  connFail: string;
  syncLoading: string;
  syncFail: string;
  allSynced: string;
  apply: string;
  push: string;
  pull: string;
  del: string;
  purge: string;
  choiceLocal: string;
  choiceRemote: string;
  choiceBoth: string;
  conflict: string;
  missingOnServer: string;
  restored: string;
  /** %s — count */
  done: string;
  errors: string;
  conflictErr: string;

  /* ---- remote mode (contract v2) ---- */
  layouts: string;
  templates: string;
  site: string;
  newLayout: string;
  newTemplate: string;
  properties: string;
  publish: string;
  unpublish: string;
  published: string;
  draft: string;
  revisions: string;
  restore: string;
  live: string;
  noRevisions: string;
  /** %s — revision number */
  confirmRestore: string;
  slug: string;
  parent: string;
  none: string;
  layout: string;
  seoTitle: string;
  seoDescription: string;
  inMenu: string;
  saving: string;
  saved: string;
  offline: string;
  /** %s — error */
  saveError: string;
  conflictHint: string;
  resolve: string;
  /** %s — name */
  publishedMsg: string;
  /** %s — list */
  publishWarnings: string;
  /** %s — count */
  importLocal: string;
  /** %s — count */
  imported: string;
  slotLabel: string;
  slotBlock: string;
  refresh: string;
}
