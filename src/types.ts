import type { ProjectData } from 'grapesjs';
import type { PagesLabels } from './i18n/types';
import type { PageStore } from './store/types';
import type { SyncService } from './sync/SyncService';

export type { ProjectData };

/** Version info the server returned for the last successful push/pull. */
export interface RemoteInfo {
  version: string | number;
  updatedAt?: number | string;
}

/**
 * One page as it is kept in the local store.
 *
 * The record layout is the storage format of the original
 * `gjs-pages-manager.js` and must stay backward compatible: existing
 * IndexedDB databases are opened as they are.
 */
export interface PageRecord {
  id: string;
  name: string;
  /** Full GrapesJS project data (`editor.getProjectData()`) of the page. */
  data: ProjectData;
  createdAt: number;
  updatedAt: number;
  /** Changed locally since the last successful sync. */
  dirty: boolean;
  /** Tombstone: deleted locally, still has to be deleted on the server. */
  deleted: boolean;
  /** `null` — the page has never been on the server. */
  remote: RemoteInfo | null;
}

export interface ServerSettings {
  /** Base URL of the REST API, without a trailing slash. Empty = no server. */
  url: string;
  /** Optional bearer token. */
  token: string;
}

export interface ClipboardItem {
  /** Component JSON with explicit `id` attributes on every node. */
  json: Record<string, any>;
  /** CSS rules that belong to the component (`editor.getCss({ component })`). */
  css: string;
}

export interface ClipboardData {
  /** Id of the page the components were copied from. */
  from: string | null;
  at: number;
  items: ClipboardItem[];
}

export interface KeyBindings {
  undo: string;
  redo: string;
  copy: string;
  paste: string;
}

export interface PagesOptions {
  /** IndexedDB database name (used by the default store). */
  dbName?: string;
  /**
   * Storage backend. Defaults to an `IndexedDbPageStore` named `dbName`.
   * Pass your own implementation of `PageStore` to keep pages elsewhere.
   */
  store?: PageStore | null;
  /** Initial REST API base URL (the user can change it in the settings dialog). */
  serverUrl?: string;
  /** Debounce of the autosave, ms. */
  autosaveDelay?: number;
  /** Max undo snapshots per page. */
  historyLimit?: number;
  /** How long editor events are ignored after `loadProjectData`, ms. */
  settleMs?: number;
  /** Replace the Ctrl+C / Ctrl+V keymaps with cross-page copy/paste. */
  takeOverCopyPaste?: boolean;
  keys?: Partial<KeyBindings>;
  /** Project data for new pages, or a function returning it. */
  blank?: ProjectData | (() => ProjectData) | null;
  /** Extra request headers for every REST call. */
  headers?: (() => Record<string, string>) | null;
  /** Override any UI text (wins over the built-in translations). */
  labels?: Partial<PagesLabels>;
  /** Id of the panel that gets the "Pages" button. Auto-detected when null. */
  panelId?: string | null;
  /** CSS selector of the element the sidebar is mounted into. Auto-detected when null. */
  sidebarContainer?: string | null;
  /** Inject the plugin CSS into `document.head`. */
  injectCss?: boolean;
}

export interface ResolvedOptions extends Required<Omit<PagesOptions, 'keys' | 'labels'>> {
  keys: KeyBindings;
  labels: Partial<PagesLabels>;
}

export interface OpenOptions {
  force?: boolean;
  skipFlush?: boolean;
}

export interface RemoveOptions {
  confirm?: boolean;
}

/** Public API, available as `editor.PagesManager` and via `getPagesManager(editor)`. */
export interface PagesManagerApi {
  list(): Promise<PageRecord[]>;
  open(id: string, opts?: OpenOptions): Promise<void>;
  create(init?: { name?: string; data?: ProjectData }): Promise<PageRecord>;
  duplicate(id: string): Promise<PageRecord | undefined>;
  rename(id: string, name?: string): Promise<void>;
  remove(id: string, opts?: RemoveOptions): Promise<void>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Writes pending changes of the active page to the store. */
  flush(): Promise<void>;
  copy(): boolean;
  paste(): boolean;
  /** Opens the sync dialog. */
  sync(): Promise<void>;
  getActiveId(): string | null;
  getSettings(): ServerSettings;
  setSettings(s: Partial<ServerSettings>): Promise<void>;
  /** Resolves once the plugin has loaded the active page. */
  whenReady(): Promise<void>;
  /** The underlying store (e.g. for a CMS integration). */
  store: PageStore;
  /** Programmatic sync without the dialog: `plan()` then `apply(plan)`. */
  syncService: SyncService;
}
