import type { ProjectData } from 'grapesjs';
import type { PagesLabels } from './i18n/types';
import type { PageStore } from './store/types';
import type { SyncService } from './sync/SyncService';
import type { ExportOptions, ImportOptions, ImportReport } from './archive/ArchiveService';
import type { ComponentsApi } from './components/ComponentsFeature';
import type { RecordHook } from './core/PagesManager';

export type { ProjectData };

/** Version info the server returned for the last successful push/pull. */
export interface RemoteInfo {
  version: string | number;
  updatedAt?: number | string;
}

/**
 * What a record is (contract v2). v1 records have no kind: they are pages.
 * - `page`     a page of the site (or, with `templateId`, an entry of a template)
 * - `layout`   the frame pages are put into (header, footer, a slot)
 * - `template` a design whose entries fill its fields (grapesjs-storage)
 * - `site`     the one site record: global styles and settings
 * - `component` a reusable piece (header, footer, a form): pages hold linked
 *              copies of it, refreshed from it whenever a page is opened
 */
export type RecordKind = 'page' | 'layout' | 'template' | 'site' | 'component';

export type PageStatus = 'draft' | 'published' | 'archived';

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

  /* ---- contract v2 (remote mode); all optional, v1 records lack them ---- */

  /** Default `page`. */
  kind?: RecordKind;
  /** A page's address, `/` or `/a/b-c`; the server assigns one from the name when empty. */
  slug?: string;
  parentId?: string | null;
  /** Order among siblings. */
  position?: number;
  layoutId?: string | null;
  /** Set: the page is an entry of that template (edited by grapesjs-storage). */
  templateId?: string | null;
  /**
   * Set: a data record of that page (grapesjs-storage). It has no design of
   * its own: it opens with the design of that page (followed up to a page
   * that is not a data record), and design edits made while it is open are
   * saved to that page. Its own content is its values (in grapesjs-storage).
   */
  dataOf?: string | null;
  status?: PageStatus;
  publishedAt?: string | null;
  /**
   * A page's values (`seo.title`, `seo.description`, `in_menu`, the
   * site's own keys). Only the keys changed since the last push are sent
   * (`dirtyValues`); `null` deletes a key on the server.
   */
  values?: Record<string, unknown>;
  dirtyValues?: string[];
  /** The server changed the record while it had local edits. */
  conflict?: boolean;
  /** Header fields changed locally (name, slug, parent…) — pushed without the project. */
  dirtyMeta?: boolean;
}

/** Remote mode: the plugin works against a contract v2 server (openapi.v2.yaml). */
export interface RemoteOptions {
  /** Base URL of the v2 API, e.g. `https://example.com/api/editor` (no trailing slash). */
  url: string;
  /** Extra headers for every request (an API key, a CSRF token). */
  headers?: (() => Record<string, string>) | null;
  /** `fetch` credentials, e.g. `include` for a cookie session on another origin. */
  credentials?: RequestCredentials;
  /** How often the record lists are refreshed from the server, ms (0: only on focus and after saves). */
  refreshInterval?: number;
  /** Retry delay after a failed save, ms (doubles up to 60 s). */
  retryDelay?: number;
  /** IndexedDB database of the local cache. Default `<dbName>-remote`. */
  cacheDbName?: string;
  /** Your own cache store instead of IndexedDB (e.g. `MemoryPageStore` in tests). */
  cache?: PageStore | null;
  /** `fetch` implementation (tests). */
  fetch?: typeof fetch;
  /**
   * Changes what a publish sends: gets the HTML and CSS of the open record
   * (the site: its CSS) and returns them changed, or nothing to keep them.
   * May be async. E.g. add the tags of another plugin's scripts.
   */
  markup?: ((out: PublishMarkup) => PublishMarkup | void | Promise<PublishMarkup | void>) | null;
}

/** What a publish sends; the argument and the result of `RemoteOptions.markup`. */
export interface PublishMarkup {
  html: string;
  css: string;
  /** The record being published (read-only). */
  record: PageRecord;
  kind: RecordKind;
}

/** A button another plugin adds to a record in the sidebar (`pages-manager:record-actions`). */
export interface RecordAction {
  id: string;
  label: string;
  /** A short text or symbol shown on the button. */
  icon?: string;
  run(record: PageRecord): void;
}

/**
 * A part of the "new page" and "properties" dialogs another plugin adds
 * (`pages-manager:record-form`): e.g. grapesjs-storage's template choice and
 * the page's data. On create the dialog is shown only when some plugin adds
 * a section.
 */
export interface RecordFormSection {
  id: string;
  label: string;
  /** Shown as a tab of its own (properties); else under the main fields. */
  tab?: boolean;
  el: HTMLElement;
  /** Values the record gets (merged into `values`; `null` deletes a key). */
  values?(): Record<string, unknown>;
  /** Runs after the record was created or saved (e.g. to write the plugin's own data). */
  save?(record: PageRecord): void | Promise<void>;
  /** A message stops the save and is shown. */
  validate?(): string | null | undefined;
}

/** Payload of `pages-manager:record-form`. */
export interface RecordFormRequest {
  mode: 'create' | 'edit';
  /** Edit: the record; create: null. */
  record: PageRecord | null;
  /** Create: the parent chosen so far. */
  parentId?: string | null;
  sections: RecordFormSection[];
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
  /**
   * With grapesjs-sidebar-tools 2.2+: show every opened page as a tab of
   * its workspace (switch tabs = open the page). Default `true`; without
   * sidebar-tools it does nothing.
   */
  workspaceTabs?: boolean;
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
  container?: string | null;
  /** Older name of `container`. */
  sidebarContainer?: string | null;
  /** Inject the plugin CSS into `document.head`. */
  injectCss?: boolean;
  /**
   * Remote mode (contract v2): the server is the source of truth, IndexedDB
   * a cache and an offline queue; layouts, templates, the page tree,
   * publishing and revisions. Without it the plugin is the v1 local editor
   * with manual sync.
   */
  remote?: RemoteOptions | null;
  /** The element a layout marks the page's place with. */
  slotTag?: string;
  /**
   * File name of a downloaded site archive, without `.zip` (or a function
   * returning it). Default: the site's name (or `site`) and the date.
   */
  archiveName?: string | (() => string);
}

export interface ResolvedOptions extends Required<Omit<PagesOptions, 'keys' | 'labels' | 'remote' | 'container'>> {
  remote: RemoteOptions | null;
  keys: KeyBindings;
  labels: Partial<PagesLabels>;
}

export interface OpenOptions {
  force?: boolean;
  skipFlush?: boolean;
  /** No `open` event (no tab, no reaction of other plugins): a passing load, e.g. to render an export. */
  silent?: boolean;
}

export interface RemoveOptions {
  confirm?: boolean;
}

/** What a new record starts with. */
export interface CreateInit {
  name?: string;
  data?: ProjectData;
  kind?: RecordKind;
  slug?: string;
  parentId?: string | null;
  layoutId?: string | null;
  position?: number;
  /** A data record of that page (see `PageRecord.dataOf`). */
  dataOf?: string | null;
  /** Initial values (`values` of the record). */
  values?: Record<string, unknown>;
}

/** Header fields of a record, as the properties dialog edits them. */
export interface RecordPatch {
  name?: string;
  slug?: string;
  parentId?: string | null;
  layoutId?: string | null;
  position?: number;
  /** Values to set; `null` deletes a key. */
  values?: Record<string, unknown>;
}

/** One published revision (remote mode). */
export interface Revision {
  revision: number;
  createdAt: string;
  createdBy: string;
  live: boolean;
}

/** Public API, available as `editor.PagesManager` and via `getPagesManager(editor)`. */
export interface PagesManagerApi {
  list(): Promise<PageRecord[]>;
  open(id: string, opts?: OpenOptions): Promise<void>;
  create(init?: CreateInit): Promise<PageRecord>;
  duplicate(id: string): Promise<PageRecord | undefined>;
  rename(id: string, name?: string): Promise<void>;
  remove(id: string, opts?: RemoveOptions): Promise<void>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Writes pending changes of the active page to the store. */
  flush(): Promise<void>;
  /**
   * Saves, then lets go of the canvas: nothing is open and editor changes
   * are not saved until the next `open()` (for a plugin that shows its own
   * content, e.g. grapesjs-storage's entries).
   */
  detach(): Promise<void>;
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

  /** Changes header fields (name, slug, parent, layout, position, values) — both modes. */
  update(id: string, patch: RecordPatch): Promise<PageRecord | undefined>;
  /**
   * Moves a page before, after or inside another one (what drag and drop
   * and Alt+arrows do); siblings are renumbered. Resolves to how many
   * pages changed (0: not possible, e.g. into its own subtree). Both modes.
   */
  move(id: string, targetId: string, where: 'before' | 'inside' | 'after'): Promise<number>;
  /** The record whose design a record shows: itself, or for a data record the page it belongs to. */
  designOf(id: string): Promise<PageRecord | undefined>;
  /** The page and its ancestors, root first (for breadcrumbs). */
  pathOf(id: string): Promise<PageRecord[]>;

  /* ---- remote mode (contract v2); they reject in local mode ---- */

  /** Is the plugin in remote mode? */
  isRemote(): boolean;
  /** Makes the record live: saves, then sends its HTML and CSS (an entry: its values). */
  publish(id?: string): Promise<PageRecord>;
  /** Takes a page off the site. */
  unpublish(id: string): Promise<PageRecord>;
  revisions(id: string): Promise<Revision[]>;
  /** The revision's project becomes the draft (not published) and is reopened. */
  restore(id: string, revision: number): Promise<void>;
  /** Reads the server's lists now. */
  refresh(): Promise<void>;
  /** Resolves a conflict: keep mine, take the server's, or keep both. */
  resolve(id: string, choice: 'local' | 'remote' | 'both'): Promise<void>;
  /** Uploads the pages of the v1 local database as new pages; resolves to how many. */
  importLocal(): Promise<number>;

  /* ---- site archive (both modes) ---- */

  /**
   * The site as a ZIP (`manifest.json`, a folder per record with its
   * project, HTML and CSS): pages; in remote mode also layouts, templates
   * with their fields, and the site. No entries, no field values.
   */
  exportArchive(opts?: ExportOptions): Promise<Uint8Array>;
  /** `exportArchive()` saved as a file by the browser. */
  downloadArchive(opts?: ExportOptions): Promise<void>;
  /** Writes an archive's records here (see `ImportOptions`). */
  importArchive(file: Blob | ArrayBuffer | Uint8Array, opts?: ImportOptions): Promise<ImportReport>;
  /** Linked components (both modes): list, save the selection as one, edit, detach, insert. */
  components: ComponentsApi;

  /* ---- for other plugins ---- */

  /**
   * Site-wide project keys. Every record is a whole GrapesJS project, so a
   * key another plugin keeps in the project data (its storable) would be
   * copied into each page. A registered key is kept once: taken out of a
   * record when it is saved, put into every record that is opened. Local
   * mode: the store's meta area; remote mode: the site record's project.
   * The first record opened that still has its own copy gives the value
   * (migration from per-page copies).
   */
  shared: {
    register(key: string): Promise<void>;
    keys(): string[];
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown): Promise<void>;
  };
  /** Hooks on records' projects and on published markup. Each returns its remover. */
  hooks: {
    /** Before a record's project is loaded into the editor (add things to it). */
    onLoad(fn: RecordHook): () => void;
    /** Before the editor's project is stored as a record (take them out again). */
    onSave(fn: RecordHook): () => void;
    /** Changes what a publish (and an archive's `body.html`/`style.css`) gets, after the `remote.markup` option. */
    onPublish(fn: (out: PublishMarkup) => PublishMarkup | void | Promise<PublishMarkup | void>): () => void;
  };
}
