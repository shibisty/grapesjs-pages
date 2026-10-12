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
}
