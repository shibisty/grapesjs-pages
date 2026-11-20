# grapesjs-site-pages

(The repository is `grapesjs-pages`; on npm that name belongs to another package, so this one is published as `grapesjs-site-pages`. The build files keep their names: `grapesjs-pages.js`, `grapesjs-pages.umd.cjs`, global `grapesjsPages`.)

A GrapesJS plugin that turns the editor into a small multi-page site editor:

- **Pages sidebar** — a page tree in both modes: create, edit the properties (name, address, parent, SEO), duplicate, delete and switch pages, drag them into place; a quick search by name or address (any case, accents ignored; matches keep their place in the tree, Enter opens the first, Esc clears).
- **SEO, Open Graph, Schema.org** — a page's properties have tabs for the search snippet (title, description, keywords, canonical, noindex/nofollow), social cards (title, description, image from the Asset Manager or the cloud, type, X card) and Schema.org (a type with its fields, FAQ, breadcrumbs, extra JSON-LD); *SEO of the site* keeps the defaults, the title template and the organization. The `<head>` tags and one JSON-LD graph go with a publish (`head`) and into the archive.
- **Breadcrumbs** — a block that draws the path of the open page in the tree (in the canvas and in the published HTML).
- **Data records** (with [grapesjs-storage](https://www.npmjs.com/package/grapesjs-storage)) — a page picks a storage template; records under it show its design with their own data.
- **Local storage** — every page is kept in IndexedDB (or any custom `PageStore`) and autosaved.
- **Per-page undo/redo** — `Ctrl+Z` / `Ctrl+Y` (`Ctrl+Shift+Z`) work on the history of the page you are on.
- **Copy/paste between pages** — `Ctrl+C` / `Ctrl+V` copy whole components *with their styles* from one page to another.
- **Linked components** — save a header, a footer or a form once and put it on any page from the *Components* blocks (or the context menu); edit it once and every page shows the change.
- **Manual REST sync** — compare local pages with a server, review the plan (upload / download / delete / resolve conflicts) and apply it. The contract is in [`openapi.yaml`](./openapi.yaml).
- **Remote mode (v2)** — the server is the source of truth and IndexedDB a cache and offline queue: layouts, templates and the site besides pages, a page tree with addresses and SEO, Publish and revisions. The contract is in [`openapi.v2.yaml`](./openapi.v2.yaml).
- **23 languages** (the GrapesJS core locales + Ukrainian), RTL for ar/he/fa.

Each page is a whole GrapesJS project (`editor.getProjectData()`): switching a
page is `loadProjectData()` of another record. See [ARCHITECTURE.md](./ARCHITECTURE.md)
for the design and the roadmap towards a CMS.

## Installation

```bash
npm install grapesjs-site-pages
```

```js
import grapesjs from 'grapesjs';
import pages from 'grapesjs-site-pages';

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
| `remote` | `RemoteOptions` | `null` | Remote mode (contract v2), see below. Without it the plugin is the local editor with manual sync. |
| `slotTag` | `string` | `'page-slot'` | The element a layout marks the page's place with. |
| `archiveName` | `string \| () => string` | site name + date | File name (without `.zip`) of a downloaded site archive. |
| `workspaceTabs` | `boolean` | `true` | With [grapesjs-sidebar-tools](https://www.npmjs.com/package/grapesjs-sidebar-tools) 2.2+: every opened page gets a tab in its document tab bar (see below). |

## Component settings

GrapesJS's **Component settings** (Trait Manager) get:

- **the body** — the open record's properties: name, address, parent, menu, the SEO / Open Graph / Schema.org tabs and the sections of other plugins (e.g. grapesjs-storage's template), with Save. The properties dialog stays;
- **breadcrumbs** — separator, the first item's text (e.g. "Home"), show the current page, show the design page of data records (off: a data record's trail skips the page it takes its design from — that page is a template, not a level of the site); kept with the component;
- **a linked component** — what it is linked to, *Edit component*, *Detach*.

## The board

The **▦** button of the pages sidebar (or the command `pages-manager:board`) covers the editor with a Figma-like board: every page, data record, layout, template and component as a frame on an endless plane, in sections (the chips on top show / hide them; data records are hidden at first).

- Move: drag the background, the middle button, Space + drag, wheel / trackpad. Zoom: Ctrl / ⌘ + wheel or pinch, `+` / `−`, `Shift+1` fits all, `Shift+0` is 100%.
- Frames are drawn only when in view (at most 24 live at once, the nearest first; the others wait as named boxes) as static iframes — no scripts — and take their content's height. Drag a frame by its title to place it; the places, the heights and the view are kept (store meta `board`).
- The board shows **templates**: pages, layouts, templates and components — not the data records of grapesjs-storage; their fields are drawn as placeholders. A frame is what a publish would send: the record is opened in the editor silently, other plugins get `pages-manager:rendering` (`{ record, waitFor(promise), placeholders, inPlace }` — grapesjs-storage loads the record's template and draws its fields as placeholders) and `pages-manager:rendered` after; the publish hooks run between. The result is kept per record by its `updatedAt` (its design's, and the newest linked component's); **⟳** draws everything again.
- While frames are drawn, and while a page is being opened for editing, a veil with a progress bar covers the board: what is shown is what has finished loading (no jumping frames).
- **Editing on the board** (`boardLive`, default `true`): the board is drawn inside the canvas, the editor's panels stay. Click a frame and that record is opened in the canvas, which sits on its frame and scales with the board — select, drag blocks, style and edit as usual, then click another frame. The record left keeps its look (its frame is redrawn from it); the one being edited is redrawn after each change. While other frames are rendered the canvas holds them in turn, so the edited frame is hidden for that moment and its selection comes back after.
- **Above every frame**: the editor's devices (desktop / tablet / mobile from the Device Manager) — the frame takes that width; on the frame being edited the editor switches to that device too, so styles go to its media query — and zoom to this frame (⤢ fits its width, 1:1 is 100%). Choosing a device in the editor's own toolbar changes the frame being edited too.
- **With grapesjs-sidebar-tools' workspace the board is a tab of its own** («▦ Board», a canvas document): ▦ opens / shows it; showing it enters the board, showing a page's tab leaves it (the page tabs are a normal canvas). Pages edited on the board get their tabs without being shown. The tab's × closes it.
- Esc / ✕ leaves the board; the record being edited stays open, the canvas gets back its zoom and size. With `boardLive: false` the board covers the whole editor and double click (or Enter) opens a record and leaves it. Options: `board` (default `true`), `boardLive` (default `true`), `boardWidth` (default `1280`).

## Page tabs (grapesjs-sidebar-tools)

When [grapesjs-sidebar-tools](https://www.npmjs.com/package/grapesjs-sidebar-tools) 2.2+ is installed (before or after this plugin), every page you open gets a tab in its document tab bar above the canvas:

- clicking a tab opens that page (saved as usual, with its own undo history);
- `×` closes the tab only — the page stays in the list;
- closing the tab of the page that is open opens the neighbour tab's page;
- renamed pages update their tab, deleted pages lose it;
- the tabs come back after a reload.

There is no dependency on sidebar-tools: without it nothing changes. `workspaceTabs: false` turns the tabs off.

## Linked components

Parts that repeat across pages (a header, a footer, a sign-up form) are
*components*: records of their own, listed in the sidebar's **Components**
section, offered as blocks in the **Components** category of the Block
Manager — so they can be dragged onto any page, and with
[grapesjs-context-menu](https://www.npmjs.com/package/grapesjs-context-menu)
1.2+ they are also in its *Add element ▸ Components* submenu.

- **Make one**: right-click an element ▸ *Save as component* (or the command
  `pages-manager:component-save`, or `components.save()`), or `+` in the
  Components section for an empty one. The element is replaced by a linked
  copy; its styles go with it.
- **Edit in place**: the content of a linked copy is edited right on the
  page — select, type, drag blocks in, style — and every change is written
  back to the component (its content, the `#id` rules of its elements and the
  class rules they use) after a short pause; the other copies on the page
  follow at once, every other page the next time it is opened (and the board
  draws them again). The copy itself — its place, its own outer styles — is
  the page's. Event: `pages-manager:component-saved` `{ id, record }`.
- **Open the component** as a record of its own: *Edit component* in the
  context menu or in Component settings; a bar over the canvas leads back.
- **Detach**: *Detach from component* turns a copy into ordinary, editable
  elements that no longer follow the component.
- **Delete** a component: where it was used it stays as a plain copy.

How it works: a copy is an element `<div data-gjsp-component="<id>">`. Each
time a page is opened its copies are rebuilt from their components (ids are
made unique per copy — `x` becomes `x-<copy id>` — and so are the `#id` rules;
a component's class rules replace page rules with the same selector). The
saved page and its published HTML contain the copies as they were then; in
remote mode a server can swap in the component's latest published HTML (see
`openapi.v2.yaml`). Components are synced like pages: v1 sends `kind:
"component"`, remote mode uses `/components` (a server without it answers
`404` and the components stay in the local cache).

## For other plugins: shared keys and hooks

Every record is a whole GrapesJS project, so whatever another plugin keeps
in the project data (its storable) would be copied into each page. These
APIs let such a plugin work site-wide (grapesjs-blueprints uses them):

```js
const pm = editor.PagesManager;

// A key of the project data kept once per site, put into every opened record.
await pm.shared.register('scripts');   // local: the store's meta; remote: the site record
pm.shared.get('scripts');               // current value (a copy)
await pm.shared.set('scripts', value);  // also given to the open record's storable
editor.on('pages-manager:shared', ({ key, value }) => {});

// Add things to a record's project when it is loaded, take them out on save.
const offLoad = pm.hooks.onLoad((data, record) => ({ ...data, styles: [...data.styles, siteRule] }));
const offSave = pm.hooks.onSave((data, record) => ({ ...data, styles: data.styles.filter((r) => !r.mine) }));

// Change what a publish sends (and an archive's body.html / style.css).
const offPub = pm.hooks.onPublish(({ html, css, kind, record }) => ({ html: html + tags, css }));
```

- **Migration.** The first record opened that still has its own copy of a
  registered key gives the shared value; later per-page copies are ignored.
  When the editor starts empty, an existing shared value (e.g. the site's
  from the server) wins over the initial content.
- **Undo** is per page and does not undo a shared value.
- The open record's plugin gets a changed value through its storable
  (`load({ [key]: value })`) without reloading the page.
- **Hooks** run on open, undo/redo and every save, and must be pure and
  idempotent. A hook that throws is reported and skipped. Remove a pair
  in this order: `offLoad()`, reopen the record, then `offSave()`.
- **Archive.** Local mode writes `shared.json`; remote mode keeps the keys
  in the site's project. Import in `copy` mode keeps the values that exist.
- Publish hooks run after the `remote.markup` option, each on the previous
  result.

### Component sources and record actions

Another plugin can offer starting points for new components. When a
source has items, the "+" of the Components section asks for a name and
what to start from (empty or one of the items):

```js
const pages = editor.PagesManager;
const off = pages.components.addSource({
  id: 'blueprints',
  label: 'Blueprints',
  list: () => [{ id: 'card', name: 'Card' }],
  build: (id) => ({ type: 'my-card' }), // a GrapesJS component definition (or an array)
});
await pages.components.create('Card', { source: 'blueprints', item: 'card' });
```

### Sections of the page dialogs

The *New page* and *Properties* dialogs take parts from other plugins through
`pages-manager:record-form` (payload `{ mode: 'create' | 'edit', record, sections }`).
A section is `{ id, label, el, tab?, values?(), validate?(), save?(record) }`: `values()` are
merged into the record's `values`, `validate()` may return a message that stops the save,
`save(record)` runs after the record was created or saved. With `tab: true` it is a tab of the
properties dialog. On create the dialog is shown only when a plugin added a section; otherwise
**+** makes the page right away. grapesjs-storage adds its template choice and the *Data* tab.

### Data records

A page with `dataOf` set is a data record of that page: it has no design of its own (`data` is
`null`). It opens with the design of that page (followed through data records), and design edits
made while it is open are saved to that page — one design, many records. Its own content is its
data (grapesjs-storage). Deleting a page deletes its data records. They are left out of site
archives and of the v1 sync; in remote mode `dataOf` travels as `data_of`.

```js
await editor.PagesManager.create({ name: 'News 1', parentId: newsId, dataOf: newsId });
await editor.PagesManager.designOf(id);   // the record whose design it shows
await editor.PagesManager.pathOf(id);     // the page and its ancestors, root first
```

### SEO, Open Graph and Schema.org

A page's properties (✎) have three tabs besides *General*:

- **SEO** — title (with a counter and a search snippet preview), description, keywords, canonical
  address, *noindex* / *nofollow*.
- **Open Graph** — title and description for social networks (default: the SEO ones), the image
  (picked from the editor's **Asset Manager**, from the **cloud** with
  [grapesjs-cloud-assets](https://www.npmjs.com/package/grapesjs-cloud-assets) 0.11+, or typed), its
  description, `og:type`, the X (Twitter) card; a card preview. A temporary cloud link (Dropbox,
  OneDrive, S3) is taken with a warning.
- **Schema.org** — the type of the page's node (WebPage, AboutPage, ContactPage, CollectionPage,
  Article, BlogPosting, NewsArticle, Product, Service, Event, FAQPage, LocalBusiness, Organization,
  Person, or none) with the fields of that type (author and date; brand, SKU, price, currency,
  availability; dates, place and address; questions and answers; address, phone, hours; profiles),
  breadcrumbs from the page tree, extra JSON-LD (an object is merged into the node, an array adds
  nodes) and the resulting graph.

**SEO of the site** (🔍 in the sidebar; remote mode: the site record's properties) keeps the site's
address (for absolute links), name and language, the title template (`%s | Shop`), the default
description and image, the X account, and the organization (name, logo, profiles) — the WebSite and
Organization nodes of every page.

The values are flat keys of `PageRecord.values` (`seo.title`, `og.image`, `schema.type`,
`schema.props`…; the site's: `site.url`, `seo.title_template`, `org.name`… — remote mode: the site
record's `settings`, local mode: the shared key `pages.site`). The full list is in
[`src/seo/head.ts`](./src/seo/head.ts).

What a page gets in `<head>` — `<title>`, `description`, `keywords`, `robots`, `canonical`, `og:*`,
`twitter:*` and one `<script type="application/ld+json">` with an `@graph` — is:

- sent with a publish as `head` (remote mode, `openapi.v2.yaml`): the server puts it into the page's
  `<head>` (or builds its own from the same values);
- in the archive's `index.html` of each page;
- `await editor.PagesManager.seo.head(id?)` / `seo.jsonLd(id?)`; `seoHead()` and `seoJsonLd()` are
  exported for servers (no DOM).

### Breadcrumbs

The *Breadcrumbs* block (`page-breadcrumbs`) is a `<nav class="gjsp-breadcrumbs">` with the path
of the open page: ancestors link to their address (`#` without one), the page itself is the last
item (`aria-current="page"`). Its content is not stored — it is drawn from the tree on every open
and change, and `getHtml()` (so a publish) has the trail of the page being published. Style it with
your own rules for `.gjsp-breadcrumbs`.

### Buttons on records

Buttons on records in the sidebar come from the
`pages-manager:record-actions` event; push `{ id, label, icon?, run(record) }`
into `actions`:

```js
editor.on('pages-manager:record-actions', ({ record, actions }) => {
  actions.push({ id: 'scripts', label: 'Scripts & styles', icon: '{}', run: (r) => openFor(r.id) });
});
```

## Remote mode (contract v2)

```js
pages(editor, {
  remote: {
    url: '/admin/cms',                                    // your backend, which adds the credentials
    headers: () => ({ 'X-CSRF-Token': csrfToken }),
    // credentials: 'include', refreshInterval: 30000, retryDelay: 2000,
  },
});
```

| `remote.*` | Default | |
| --- | --- | --- |
| `url` | — | Base URL of a server that implements [`openapi.v2.yaml`](./openapi.v2.yaml). |
| `headers` | the `headers` option | Extra headers for every request. |
| `credentials` | — | `fetch` credentials (`include` for a cookie session on another origin). |
| `refreshInterval` | `30000` | How often the lists are read again, ms (`0`: only on focus, `online` and `refresh()`). |
| `retryDelay` | `2000` | First retry after a failed save, ms; doubles up to 60 s. |
| `cacheDbName` | `<dbName>-remote-<hash of url>` | IndexedDB database of the cache. |
| `cache` | IndexedDB | Your own `PageStore` as the cache (`MemoryPageStore` in tests). |
| `markup` | — | `({ html, css, kind, record }) => ({ html, css })`, may be async: changes what a publish sends, e.g. adds the tags of another plugin's scripts or fonts. Return nothing to keep it. Plugins add theirs with `hooks.onPublish` (run after this one). |

How it works:

- **Records**: the site (global styles, settings), layouts, templates and pages, each a GrapesJS
  project, keyed by UUIDs the editor makes (also outside secure contexts). Entries of templates
  (pages with `templateId`) are kept but not listed: they belong to grapesjs-storage.
- **Saving**: every change goes to IndexedDB at once and to the server as soon as possible, one
  request per record at a time, with `If-Match`. Offline, changes wait and are retried; the
  status line says *Saving… / All changes saved / Offline*.
- **Conflicts**: a `412` (somebody else saved first) marks the record ⚠ and stops its saves; the
  conflict dialog keeps mine, takes the server's, or keeps both (mine as a copy). Changes made
  elsewhere to records not edited here come in on refresh and reload the open one.
- **Sidebar**: *Pages* as a tree (by `parentId`, then `position`), *Layouts*, *Templates*, *Site
  styles*; each section has its own **+**. Pages are dragged into place: the upper quarter of a
  row drops before it, the lower quarter after it, the middle inside it (never into the page's own
  subtree); the new siblings are renumbered and saved. From the keyboard: Alt+↑/↓ reorder,
  Alt+→ makes the page a child of the one above, Alt+← moves it out of its parent; →/← expand and
  collapse (kept per browser), ↑/↓ move between rows. ✎ opens the properties: name, address (slug), parent,
  layout, SEO title and description, "show in the menu" (`values`: `seo.title`, `seo.description`,
  `in_menu`).
- **Layouts** get a *Page slot* block (`<page-slot>`): the server puts the page there.
- **Publish** (▲) saves, then sends `editor.getHtml()` without `<body>` and `editor.getCss()` (the
  site: its CSS only, with the base rules; an entry: nothing). Components with a script (tabs, a
  countdown…) add `editor.getJs()` as a `<script>` at the end of the HTML; the server decides
  whether to keep it. The server sanitizes and keeps
  revisions; 🕘 lists them, and *Restore* makes one the draft again (not published).
- **Import**: pages of the v1 local database (the same `dbName`) are offered once as new pages.

## API

`editor.PagesManager` (or `getPagesManager(editor)`):

```ts
list(): Promise<PageRecord[]>             // live pages, oldest first
open(id, { force?, skipFlush? })
create({ name?, data?, kind?, slug?, parentId?, layoutId?, position?, dataOf?, values? }): Promise<PageRecord>
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
update(id, { name?, slug?, parentId?, layoutId?, position?, values? })   // values: null deletes a key
move(id, targetId, 'before' | 'inside' | 'after'): Promise<number>   // what drag and drop does
designOf(id): Promise<PageRecord | undefined>   // a data record: its page
pathOf(id): Promise<PageRecord[]>               // root first

// remote mode (they reject in local mode)
isRemote(): boolean
publish(id = active): Promise<PageRecord>
unpublish(id)
revisions(id): Promise<Revision[]>
restore(id, revision)                     // into the draft, reopened
refresh()                                 // read the server's lists now
resolve(id, 'local' | 'remote' | 'both')
importLocal(): Promise<number>

// site archive (both modes)
exportArchive({ html? = true, onProgress? }): Promise<Uint8Array>   // the ZIP
downloadArchive({ html?, onProgress? })                              // saved by the browser
importArchive(file, { mode? = 'replace' | 'copy', site?, onProgress? }): Promise<ImportReport>
// linked components (both modes)
components.list(): Master[]                         // { id, name, components, styles }
components.save(component = selected, name?)        // without a name: window.prompt
components.edit(instanceOrId = selected)
components.detach(instance = selected): Component | null
components.insert(id, target?, at?): Component | null
components.isInstance(component): boolean
// SEO, Open Graph, Schema.org (both modes)
seo.head(id = active, { title?, jsonLd? }): Promise<string>   // the <head> tags
seo.jsonLd(id = active): Promise<object | null>
seo.site(): Promise<Record<string, unknown>>                   // the site's values
seo.setSite(values)                                            // null deletes a key
seo.openSite()                                                 // the "SEO of the site" dialog
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
| `publish` | `pages-manager:published` | `{ record, revision, warnings }` (remote) |
| `conflict` | `pages-manager:conflict` | `PageRecord` (remote) |
| `remote` | `pages-manager:remote` | `'idle' \| 'saving' \| 'offline' \| 'error'` (remote) |
| `exported` | `pages-manager:exported` | `{ bytes }` |
| `imported` | `pages-manager:imported` | `ImportReport` |
| `components` | `pages-manager:components` | `Master[]` — the list of components changed |
| `recordActions` | `pages-manager:record-actions` | `{ record, actions }` — push buttons of a sidebar row |
| `recordForm` | `pages-manager:record-form` | `{ mode, record, parentId?, sections }` — push dialog sections |

### Commands

`pages-manager:open`, `pages-manager:toggle`, `pages-manager:copy`,
`pages-manager:paste`, `pages-manager:sync`, `pages-manager:settings`,
`pages-manager:export`, `pages-manager:import` (the archive dialogs); remote mode:
`pages-manager:publish`, `pages-manager:refresh`, `pages-manager:revisions` and
`pages-manager:properties` (both take `{ id }`, default the open record);
`pages-manager:site-seo` (the site's SEO, both modes);
components: `pages-manager:component-save` (`{ component?, name? }`),
`pages-manager:component-edit` and `pages-manager:component-detach`
(`{ component? }`, default the selection).
`core:undo` / `core:redo` are redefined to use the per-page history, so the
undo/redo buttons of presets keep working.

## Site archive

The sidebar's ⤓ and ⤒ buttons export the site to a ZIP and import one back
(`exportArchive()` / `importArchive()`). It holds the **designs**: pages and
linked components; in remote mode also layouts, templates with their field
lists, and the site's styles and settings. Entries of templates and field values are content and
are not in it.

```
manifest.json            format, version, the records with their header fields
shared.json              local mode: the shared keys of other plugins (`shared.register`)
site/                    project.json, style.css, settings.json
components/<name>/       project.json, body.html, style.css, index.html   (linked components)
layouts/<name>/          project.json, body.html, style.css
templates/<name>/        project.json, body.html, style.css, index.html, fields.json
pages/<address>/         project.json, body.html, style.css, index.html   (/ → pages/index)
```

- `project.json` is the GrapesJS project: what an import reads back.
- `body.html` and `style.css` are what a publish would send (scripts and the
  `remote.markup` hook included); `index.html` is a standalone preview (the
  site's CSS, the page inside its layout). Making them opens every record in
  the editor once; `{ html: false }` exports the projects only.
- Work on them in another tool and import the ZIP back: a `body.html` or
  `style.css` whose hash no longer matches the manifest is taken instead of
  the project (GrapesJS parses it; component settings it cannot see in plain
  HTML are lost). A record with markup and no `project.json` is built the
  same way. A ZIP of the folder (with one top folder) is accepted.
- **Import modes.** `replace` (default): a record that exists (same id; a
  page also by its address, a layout, template or component by its name) is
  overwritten, the rest is created with the archive's ids — importing into
  another site keeps the ids, so a second import updates. `copy`: all new
  ids, references (layout, parent) follow, taken addresses get `-2`, `-3`…;
  the site record is left alone unless `site: true`.
- Components are written first (pages and layouts hold instances of them),
  so the instances are rebuilt from the imported component when a page opens.
- Remote mode writes one record at a time, components, layouts and templates
  before pages, parents before children; a record the server refuses is reported in
  `ImportReport.errors` and the rest goes on.

The format alone (no DOM, no GrapesJS) is `grapesjs-site-pages/archive`
(`packArchive`, `readArchive`, `archiveFiles`, `readArchiveFiles`,
`importOrder`, `compose`), e.g. for a server that keeps a site as that
folder tree.

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

End to end against a real contract v2 server (skipped without the URL):

```bash
GJSP_E2E_URL=http://localhost:8082/v1/editor GJSP_E2E_HEADERS='{"X-API-Key":"sk_live_…"}' npx vitest run test/e2e.test.ts
```


## Using it by name and changing options in the editor

This plugin follows the plugin contract of grapesjs-plugins-manager (its `docs/plugin-contract.md`): with the UMD bundle on the page it registers itself as `grapesjs-site-pages`, so it can be listed like an official plugin —

```js
grapesjs.init({
  plugins: ['grapesjs-site-pages'],
  pluginsOpts: { 'grapesjs-site-pages': { /* options */ } },
});
```

— and grapesjs-plugins-manager shows a form of its options (⚙ in the plugin list). The plugin function carries `meta` (id, version, option schema).

## License

MIT
