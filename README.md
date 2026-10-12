# grapesjs-pages

A GrapesJS plugin that turns the editor into a small multi-page site editor:

- **Pages sidebar** — create, rename, duplicate, delete and switch pages.
- **Local storage** — every page is kept in IndexedDB (or any custom `PageStore`) and autosaved.
- **Per-page undo/redo** — `Ctrl+Z` / `Ctrl+Y` (`Ctrl+Shift+Z`) work on the history of the page you are on.
- **Copy/paste between pages** — `Ctrl+C` / `Ctrl+V` copy whole components *with their styles* from one page to another.
- **Manual REST sync** — compare local pages with a server, review the plan (upload / download / delete / resolve conflicts) and apply it. The contract is in [`openapi.yaml`](./openapi.yaml).
- **23 languages** (the GrapesJS core locales + Ukrainian), RTL for ar/he/fa.

Each page is a whole GrapesJS project (`editor.getProjectData()`): switching a
page is `loadProjectData()` of another record. See [ARCHITECTURE.md](./ARCHITECTURE.md)
for the design and the roadmap towards a CMS.

## Installation

```bash
npm install grapesjs-pages
```

```js
import grapesjs from 'grapesjs';
import pages from 'grapesjs-pages';

grapesjs.init({
  container: '#gjs',
  storageManager: false, // the plugin stores the pages itself
  plugins: [pages],
  pluginsOpts: {
    [pages]: { serverUrl: 'https://example.com/api/v1' },
  },
});
```

### Without a bundler

The UMD build registers the global `grapesjsPages` — an object with the plugin
as `default` plus the named exports (stores, sync client…):

```html
<script src="https://unpkg.com/grapesjs"></script>
<script src="https://unpkg.com/grapesjs-pages/dist/grapesjs-pages.umd.cjs"></script>
<script>
  grapesjs.init({
    container: '#gjs',
    storageManager: false,
    plugins: [grapesjsPages.default],
    pluginsOpts: { [grapesjsPages.default]: {} },
  });
</script>
```

The plugin can also be applied to an editor that is already running:
`grapesjsPages.default(editor, { ... })`.

On the first start (empty store) the current editor content — `components`,
`style` or `projectData` given to `grapesjs.init` — becomes "Page 1".

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `dbName` | `string` | `'gjs-pages-manager'` | IndexedDB database name of the default store. |
| `store` | `PageStore` | IndexedDB | Custom storage backend (see below). |
| `serverUrl` | `string` | `''` | Initial REST base URL. The user can change it in the settings dialog; the saved value wins. |
| `autosaveDelay` | `number` | `600` | Autosave debounce, ms. |
| `historyLimit` | `number` | `50` | Undo snapshots kept per page. |
| `settleMs` | `number` | `150` | Editor events ignored after loading a page, ms. |
| `takeOverCopyPaste` | `boolean` | `true` | Replace the `Ctrl+C`/`Ctrl+V` keymaps with the cross-page clipboard. The `core:copy`/`core:paste` commands themselves are not changed. |
| `keys` | `{ undo, redo, copy, paste }` | see `DEFAULT_KEYS` | Keymap strings. |
| `blank` | `ProjectData \| () => ProjectData` | empty page | Project data of a new page (a template). |
| `headers` | `() => Record<string,string>` | `null` | Extra headers for every REST request. |
| `labels` | `Partial<PagesLabels>` | `{}` | Override any UI text (wins over the translations). |
| `panelId` | `string` | auto | Panel that gets the "Pages" button. Auto-detected by its view-switcher buttons. |
| `sidebarContainer` | `string` | auto | CSS selector to mount the sidebar into. Auto: `.gjs-pn-views-container` → `.panel__right` → floating over the editor. |
| `injectCss` | `boolean` | `true` | Inject the plugin CSS into `<head>`. |

## API

`editor.PagesManager` (or `getPagesManager(editor)`):

```ts
list(): Promise<PageRecord[]>             // live pages, oldest first
open(id, { force?, skipFlush? })
create({ name?, data? }): Promise<PageRecord>
duplicate(id)
rename(id, name?)                         // without a name: window.prompt
remove(id, { confirm? = true })           // window.confirm unless confirm: false
undo() / redo(): Promise<boolean>
canUndo() / canRedo()
flush()                                   // write pending changes now
copy() / paste(): boolean
sync()                                    // open the sync dialog
getActiveId()
getSettings() / setSettings({ url?, token? })
whenReady(): Promise<void>
store: PageStore
syncService: SyncService                  // plan() / apply(plan) without the dialog
```

### Events

| `EVENTS.*` | Name | Payload |
| --- | --- | --- |
| `ready` | `pages-manager:ready` | — |
| `open` | `pages-manager:open` | `PageRecord` |
| `change` | `pages-manager:change` | — (list or metadata changed) |
| `history` | `pages-manager:history` | — |
| `copy` | `pages-manager:copied` | `{ count }` |
| `paste` | `pages-manager:pasted` | `{ count, components }` |
| `settings` | `pages-manager:settings` | `ServerSettings` |
| `sync` | `pages-manager:synced` | `{ ok, errors }` |

### Commands

`pages-manager:open`, `pages-manager:toggle`, `pages-manager:copy`,
`pages-manager:paste`, `pages-manager:sync`, `pages-manager:settings`.
`core:undo` / `core:redo` are redefined to use the per-page history, so the
undo/redo buttons of presets keep working.

## Storage

```ts
interface PageStore {
  all(): Promise<PageRecord[]>;           // including tombstones
  get(id): Promise<PageRecord | undefined>;
  put(rec): Promise<void>;
  delete(id): Promise<void>;
  getMeta(key): Promise<unknown>;
  setMeta(key, value): Promise<void>;
  close?(): void;
}
```

`IndexedDbPageStore` (default) and `MemoryPageStore` are exported. The
IndexedDB schema is the one of the original `gjs-pages-manager.js`, so existing
databases are picked up as they are.

## Sync

Sync is manual: the sync button fetches `GET /pages`, builds a plan and shows
it. Nothing is sent before "Apply".

| Local \ Server | unchanged | changed | missing |
| --- | --- | --- | --- |
| clean | — | ↓ download | ↑ upload again |
| edited | ↑ upload (`If-Match`) | ⚠ conflict: keep mine / take theirs / keep both | ↑ upload |
| deleted | ✕ delete on server | ↓ restore | drop the tombstone |
| only on server | | ↓ download | |

Versions are compared with `If-Match`; a `412` means somebody changed the page
in between. See [`openapi.yaml`](./openapi.yaml) for the full contract.

## Localization

Texts are registered in `editor.I18n` under `pagesManager.*` for ar, bs, ca,
de, el, en, es, fa, fr, he, id, it, ko, nb, nl, pl, pt, ru, se (Swedish — the
core's code), tr, uk, vi, zh. The editor locale decides (by default the browser
language); the sidebar relabels on `setLocale()`. Override single texts with
`labels`, or with `editor.I18n.addMessages()` after the plugin is loaded.

## Migrating from `gjs-pages-manager.js`

- Global: `gjsPagesManager` → `grapesjsPages.default`.
- Data, `editor.PagesManager`, command names, CSS classes (`gjsp-*`) and the
  `pages-manager:open` / `pages-manager:ready` events are unchanged.
- The UI language is no longer hard-coded Russian; pass `labels` or set the
  editor locale (`i18n: { locale: 'ru' }`).

## Development

```bash
npm install
npm test           # vitest + jsdom, real grapesjs, fake-indexeddb
npm run typecheck
npm run build      # dist/: ES + UMD + .d.ts
```

## License

MIT
