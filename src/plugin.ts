import type { Editor } from 'grapesjs';
import { ComponentClipboard } from './clipboard/ComponentClipboard';
import { isEditorAlive, PagesManager } from './core/PagesManager';
import { SHARED_META, SiteSharedBackend } from './core/SharedData';
import { COMMANDS, EVENTS } from './events';
import { createTranslator, getLocale, registerMessages } from './i18n';
import { META, publicOptions, resolveOptions } from './options';
import { definePlugin, registerControl } from './contract';
import { RemoteClient, SITE_ID } from './remote/RemoteClient';
import { type MarkupHook, RemoteEditor } from './remote/RemoteEditor';
import { RemotePageStore } from './remote/RemotePageStore';
import { registerSlot, toggleSlotBlock } from './remote/slot';
import { IndexedDbPageStore } from './store/IndexedDbPageStore';
import type { PageStore } from './store/types';
import { SyncService } from './sync/SyncService';
import type { PageRecord, PagesManagerApi, PagesOptions, RecordKind, RecordPatch } from './types';
import { fmt, report } from './utils';
import { h, PAGE_ICON_HTML, pageIcon } from './ui/dom';
import { findHostPanel, findSidebarHost } from './ui/host';
import { openComponentFromModal, openSettingsModal, openSyncModal } from './ui/modals';
import { BREADCRUMBS_TYPE, registerBreadcrumbs } from './components/breadcrumbs';
import { formSections, openConflictModal, openCreatePageModal, openPropertiesModal, openRevisionsModal, propertiesForm, openSectionsModal } from './ui/remoteModals';
import { registerPageSettings } from './ui/settings';
import { Board, type BoardDevice, type BoardState } from './board/Board';
import { BoardRenderer } from './board/render';
import { LiveCanvas } from './board/live';
import type { BoardItem, BoardSection } from './board/layout';

const BOARD_META = 'board';
import { INSTANCE_ATTR, INSTANCE_TYPE } from './components/expand';
import { pageSeoSections, siteSeoSections, type SeoMedia } from './ui/seoForm';
import { mediaSources, pickMedia } from './ui/media';
import { seoHead, seoJsonLd, SITE_SHARED_KEY, type SeoPage } from './seo/head';
import { Sidebar } from './ui/Sidebar';
import { createdOrder, type DropWhere, moveInTree } from './ui/tree';
import { injectCss } from './ui/styles';
import { connectWorkspace, workspaceOf } from './integration/workspace';
import { ArchiveService, type ExportOptions, type ImportOptions, type ImportReport } from './archive/ArchiveService';
import { openExportModal, openImportModal, type ArchiveActions } from './ui/archiveModals';
import { ComponentsFeature } from './components/ComponentsFeature';

export const PANEL_BUTTON_ID = 'pages-manager';

/** A short stable hash of a string (the cache database name per server). */
const hash = (s: string): string => {
  let x = 5381;
  for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0;
  return (x >>> 0).toString(36);
};

type EditorWithPages = Editor & { PagesManager?: PagesManagerApi; __gjspCleanup?: () => void };

/** The plugin API of an editor (`undefined` if the plugin is not loaded). */
export function getPagesManager(editor: Editor): PagesManagerApi | undefined {
  return (editor as EditorWithPages).PagesManager;
}

/**
 * grapesjs-pages: a "Pages" sidebar backed by IndexedDB (or any `PageStore`),
 * per-page undo/redo, copy/paste of components between pages and manual
 * REST sync.
 */
function pagesPlugin(editor: Editor, userOpts: PagesOptions = {}): void {
  const ed = editor as EditorWithPages;
  ed.__gjspCleanup?.(); // applied twice to the same editor: replace the old instance

  const opts = resolveOptions(userOpts);
  const offControl = registerControl(editor, META, () => publicOptions(opts), () => undefined);
  registerMessages(editor);
  const t = createTranslator(editor, opts.labels);
  // Remote mode: the server first, an IndexedDB cache (one per server URL).
  let rstore: RemotePageStore | null = null;
  let store: PageStore;
  if (opts.remote) {
    const ro = opts.remote;
    const client = new RemoteClient({
      url: ro.url,
      headers: ro.headers ?? opts.headers,
      credentials: ro.credentials,
      fetch: ro.fetch,
      conflictMessage: () => t('conflictErr'),
    });
    const cache = ro.cache || new IndexedDbPageStore(ro.cacheDbName || `${opts.dbName}-remote-${hash(client.base)}`);
    rstore = new RemotePageStore(
      cache,
      client,
      {
        onChange: () => {
          if (!isEditorAlive(editor)) return;
          // A first refresh brings the site record (with the shared keys) after the start.
          void manager.reloadShared().catch(report);
          editor.trigger(EVENTS.change);
          editor.trigger(EVENTS.remote, rstore!.state);
        },
        onRemote: (rec) => {
          if (rec.id === manager.activeId) void manager.replaceRecord(rec).catch(report);
          // The site carries the shared project keys: another editor may have changed them.
          if (rec.id === SITE_ID) void manager.reloadShared().catch(report);
        },
        onRemoved: (id) => void forget(id).catch(report),
        onConflict: (rec) => isEditorAlive(editor) && editor.trigger(EVENTS.conflict, rec),
      },
      { retryDelay: ro.retryDelay }
    );
    store = rstore;
  } else {
    store = opts.store || new IndexedDbPageStore(opts.dbName);
  }
  const manager = new PagesManager(editor, store, opts, t);
  if (rstore) manager.setSharedBackend(new SiteSharedBackend(rstore, SITE_ID));
  const remote = rstore
    ? new RemoteEditor(editor, manager, rstore, t, () => new IndexedDbPageStore(opts.dbName), opts.remote?.markup || null)
    : null;
  const needRemote = (): RemoteEditor => {
    if (!remote) throw new Error('grapesjs-pages: remote mode only (the `remote` option)');
    return remote;
  };
  /** A record the server dropped: if it was open, open another one. */
  const forget = async (id: string): Promise<void> => {
    if (id !== manager.activeId) return;
    const rest = (await manager.list()).filter((r) => (r.kind || 'page') === 'page' && !r.templateId);
    if (rest.length) await manager.open(rest[0].id, { force: true, skipFlush: true });
    else await manager.create();
  };
  const clipboard = new ComponentClipboard(editor, store, () => manager.activeId);
  // Linked components: blocks, read-only instances rebuilt on every open.
  const components = new ComponentsFeature(editor, manager, t, (text) => sidebar?.flash(text));
  // With grapesjs-sidebar-tools 2.2+: every opened page is a tab of its workspace.
  // While the board is the shown tab, pages opened on it get their tabs without being shown.
  let boardShown = false;
  const disconnectWorkspace = opts.workspaceTabs ? connectWorkspace(editor, manager, () => boardShown) : Object.assign(() => undefined, { show: async () => undefined });
  const sync = new SyncService(editor, manager, store, opts, t);
  let sidebar: Sidebar | null = null;
  let toggleBtn: HTMLButtonElement | null = null;
  let wantOpen = false;
  let disposed = false;
  const offs: Array<() => void> = [];
  const on = (ev: string, fn: (...a: any[]) => void): void => {
    editor.on(ev, fn);
    offs.push(() => editor.off(ev, fn));
  };

  /* ---------------- dialogs & actions ---------------- */

  const rename = async (id: string, name?: string): Promise<void> => {
    let next = name;
    if (next == null) {
      const rec = await store.get(id);
      if (!rec) return;
      next = window.prompt(t('promptName'), rec.name) ?? '';
    }
    await manager.rename(id, next);
  };

  const remove = async (id: string, { confirm = true } = {}): Promise<void> => {
    if (confirm) {
      const rec = await store.get(id);
      if (!rec || rec.deleted) return;
      const msg = rec.kind === 'component' ? t('confirmRemoveComponent') : t('confirmRemove');
      if (!window.confirm(fmt(msg, rec.name))) return;
    }
    await manager.remove(id);
  };

  const copy = (): boolean => {
    const n = clipboard.copy();
    if (n) editor.trigger(EVENTS.copy, { count: n });
    return n > 0;
  };

  const paste = (): boolean => {
    const added = clipboard.paste();
    if (!added.length && !clipboard.data?.items.length) return false;
    editor.trigger(EVENTS.paste, { count: added.length, components: added });
    return true;
  };

  const refresh = async (): Promise<void> => {
    const r = needRemote();
    await r.store.refresh();
    sidebar?.setLocalCount((await r.localPages()).length);
  };

  /** Publishes, then flashes the result (or the error) in the sidebar. */
  const publish = async (id?: string): Promise<PageRecord> => {
    const r = needRemote();
    try {
      const rec = await r.publish(id);
      sidebar?.flash(fmt(t('publishedMsg'), rec.kind === 'site' ? t('site') : rec.name));
      return rec;
    } catch (e) {
      sidebar?.flash(fmt(t('saveError'), (e as Error).message));
      throw e;
    }
  };

  /** Moves a page before, after or inside another one; resolves to how many pages changed. */
  const movePage = async (id: string, targetId: string, where: DropWhere): Promise<number> => {
    const pages = (await manager.list()).filter((p) => (p.kind || 'page') === 'page' && !p.templateId);
    const changes = moveInTree(pages, id, targetId, where, remote ? undefined : createdOrder);
    for (const c of changes) await update(c.id, { parentId: c.parentId, position: c.position });
    return changes.length;
  };

  /** Header fields in either mode. */
  const update = (id: string, patch: RecordPatch): Promise<PageRecord | undefined> =>
    remote ? remote.update(id, patch) : manager.updateMeta(id, patch);

  /** The page and its ancestors, root first. */
  const pathOf = async (id: string): Promise<PageRecord[]> => {
    const all = await manager.list();
    const byId = new Map(all.map((r) => [r.id, r]));
    const out: PageRecord[] = [];
    let cur = byId.get(id);
    while (cur && out.length < 32 && !out.includes(cur)) {
      out.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out;
  };

  /* ------------------------ SEO, Open Graph, Schema.org ------------------------ */

  const mediaLabels = () => ({ assets: t('fromAssets'), cloud: t('fromCloud'), choose: t('pickChoose'), chooseN: t('pickChooseN'), cancel: t('cancel') });
  const seoMedia: SeoMedia = {
    sources: () => mediaSources(editor, mediaLabels()),
    pick: (source) => {
      if (opts.injectCss) injectCss();
      return pickMedia(editor, source, { kind: 'image', labels: mediaLabels(), pfx: 'gjsp', title: source === 'assets' ? t('fromAssets') : undefined });
    },
  };
  /** The site's values: the site record's in remote mode (when there is one), else the shared key of the store's meta. */
  const siteValues = async (): Promise<Record<string, unknown>> => {
    if (remote) {
      const rec = await store.get('site');
      if (rec && !rec.deleted) return { ...(rec.values || {}) };
    }
    const all = (await store.getMeta<Record<string, unknown>>(SHARED_META)) || {};
    const v = all[SITE_SHARED_KEY];
    return v && typeof v === 'object' ? { ...(v as Record<string, unknown>) } : {};
  };
  const setSiteValues = async (patch: Record<string, unknown>): Promise<void> => {
    if (remote && (await store.get('site'))) {
      await remote.update('site', { values: patch });
      return;
    }
    const all = (await store.getMeta<Record<string, unknown>>(SHARED_META)) || {};
    const cur = { ...((all[SITE_SHARED_KEY] as Record<string, unknown>) || {}) };
    Object.entries(patch).forEach(([k, v]) => (v === null || v === undefined || v === '' ? delete cur[k] : (cur[k] = v)));
    await store.setMeta(SHARED_META, { ...all, [SITE_SHARED_KEY]: cur });
    editor.trigger(EVENTS.change);
  };
  const seoPages = async (): Promise<SeoPage[]> => (await store.all()).filter((r) => !r.deleted && (r.kind || 'page') === 'page' && !r.templateId);
  const seoDeps = { t, media: seoMedia, site: siteValues, pages: seoPages, language: getLocale(editor) };
  const headInput = async (id?: string) => {
    const rid = id || manager.activeId || '';
    const rec = rid ? await store.get(rid) : undefined;
    if (!rec || rec.deleted) throw new Error(`grapesjs-pages: no record ${rid}`);
    return { page: rec, site: await siteValues(), pages: await seoPages() };
  };
  if (remote) remote.headFor = async (rec) => seoHead({ page: rec, site: await siteValues(), pages: await seoPages() }, { title: true });
  const openSiteSeo = (): void => {
    void (async () => {
      if (opts.injectCss) injectCss();
      // Remote mode with a site record: its properties (name + the SEO tabs).
      if (remote && (await store.get('site'))) return openProperties('site');
      const sections = siteSeoSections(await siteValues(), seoDeps);
      openSectionsModal(editor, t, t('siteSeo'), sections, (values) => setSiteValues(values));
    })().catch(report);
  };

  const propsDeps = {
    store,
    update,
    remote: !!remote,
    ownSections: (rec: PageRecord) => {
      const kind = rec.kind || 'page';
      if (kind === 'site') return siteSeoSections(rec.values || {}, seoDeps);
      if (kind === 'page' && !rec.templateId) return pageSeoSections(rec, seoDeps);
      return [];
    },
  };
  const openProperties = (id: string): void => void openPropertiesModal(editor, propsDeps, t, id).catch(report);

  // Component settings: the body — the open page's properties; a linked component — Edit / Detach.
  offs.push(
    registerPageSettings(editor, {
      t,
      activeId: () => manager.activeId,
      form: async (id, onSaved) => (await propertiesForm(editor, propsDeps, t, id, { onSaved, className: 'gjsp-props gjsp-props--trait' }))?.form || null,
      instance: (c) => {
        if (c.get('type') !== INSTANCE_TYPE) return null;
        const m = components.list().find((x) => x.id === c.getAttributes()[INSTANCE_ATTR]);
        return { name: m?.name || String(c.get('name') || '') };
      },
      edit: (c) => void components.edit(c).catch(report),
      detach: (c) => void components.detach(c),
      css: () => opts.injectCss && injectCss(),
    })
  );

  /**
   * A new page. When other plugins add sections to the dialog (e.g.
   * grapesjs-storage's template), the "new page" dialog asks first;
   * otherwise the page is made right away.
   */
  const createPage = async (parentId: string | null = null): Promise<PageRecord | null> => {
    const sections = formSections(editor, { mode: 'create', record: null, parentId });
    const base = remote ? { kind: 'page' as const } : {};
    if (!sections.length) {
      if (!remote) return manager.create(parentId ? { parentId } : {});
      const n = (await manager.list()).filter((r) => (r.kind || 'page') === 'page').length + 1;
      return manager.create({ ...base, name: `${t('defaultName')} ${n}`, ...(parentId ? { parentId } : {}) });
    }
    return openCreatePageModal(editor, t, {
      all: await manager.list(),
      name: await manager.nextName(),
      parentId,
      sections,
      create: ({ name, parentId: p, values }) =>
        manager.create({ ...base, name, ...(p ? { parentId: p } : {}), ...(Object.keys(values).length ? { values } : {}) }),
    });
  };

  /**
   * A new page, layout, template or component, named "<Kind> <n>". A
   * component asks what it starts from when other plugins offer sources
   * (`components.addSource`); null when that dialog is closed.
   */
  const createKind = async (kind: RecordKind): Promise<PageRecord | null> => {
    const base =
      kind === 'layout' ? t('layout') : kind === 'template' ? t('newTemplate') : kind === 'component' ? t('componentName') : t('defaultName');
    const taken = new Set((await manager.list()).map((r) => r.name));
    let n = (await manager.list()).filter((r) => (r.kind || 'page') === kind).length + 1;
    while (taken.has(`${base} ${n}`)) n++;
    const name = `${base} ${n}`;
    if (kind === 'component') {
      const sources = components
        .sources()
        .map((s) => ({ id: s.id, label: s.label, items: s.list() }))
        .filter((s) => s.items.length);
      if (sources.length) {
        const res = await openComponentFromModal(editor, t, sources, name);
        return res ? components.create(res.name, res.from) : null;
      }
    }
    if (kind === 'page') return createPage();
    return manager.create({ kind, name });
  };

  const importLocal = async (): Promise<number> => {
    const n = await needRemote().importLocal();
    sidebar?.setLocalCount(0);
    sidebar?.flash(fmt(t('imported'), n));
    return n;
  };

  /* ---------------- site archive ---------------- */

  // Publish hooks of other plugins (`hooks.onPublish`): remote publishes and archive markup in both modes.
  const markupHooks: MarkupHook[] = remote ? remote.markupHooks : [];
  const archive = new ArchiveService(editor, manager, store, remote, markupHooks);

  /* ----------------------------- the board ----------------------------- */

  const renderer = new BoardRenderer(editor, manager, () => markupHooks, { get: (k) => store.getMeta(k), set: (k, v) => store.setMeta(k, v) });
  let board: Board | null = null;
  let boardBack: string | null = null;
  const boardItems = async (): Promise<BoardItem[]> =>
    (await manager.list())
      .filter((r) => !r.deleted && (r.kind || 'page') !== 'site')
      .map((r) => {
        const kind = r.kind || 'page';
        const section: BoardSection = kind === 'page' ? (r.dataOf ? 'data' : 'page') : (kind as BoardSection);
        return { id: r.id, name: r.name, section };
      });
  const canvasHead = (): string => {
    const cfg = (editor.getConfig() as any).canvas || {};
    const esc = (v: string) => v.replace(/"/g, '&quot;');
    return (Array.isArray(cfg.styles) ? cfg.styles : [])
      .map((x: unknown) => (typeof x === 'string' ? x : (x as { href?: string })?.href))
      .filter(Boolean)
      .map((href: string) => `<link rel="stylesheet" href="${esc(href)}">`)
      .join('');
  };
  let live: LiveCanvas | null = null;
  /** Live board: the record being edited (the renderer may hold another one in the canvas meanwhile). */
  let editing: string | null = null;
  let snapTimer: ReturnType<typeof setTimeout> | null = null;
  const closeBoard = (target: string | null): void => {
    if (!board) return;
    // A board tab: leave it for the tab of the record being edited (the board tab stays).
    if (boardTab && live && target === null) {
      const back = editing;
      boardShown = false;
      stopBoard(null);
      if (back) void disconnectWorkspace.show(back).catch(report);
      return;
    }
    stopBoard(target);
  };
  const stopBoard = (target: string | null): void => {
    if (!board) return;
    boardShown = false;
    board.destroy();
    board = null;
    if (snapTimer) clearTimeout(snapTimer);
    editor.trigger(EVENTS.board, { open: false });
    if (live) {
      // Live: the record being edited stays open.
      const l = live;
      live = null;
      editing = null;
      renderer.live = null;
      void renderer
        .idle()
        .then(() => l.exit())
        .catch(report);
      return;
    }
    void renderer.finish(target, boardBack).catch(report);
  };
  /**
   * With grapesjs-sidebar-tools' workspace the board is a tab of its own
   * (a canvas document): showing it enters the board, showing another
   * canvas tab leaves it; ▦ opens / shows that tab.
   */
  const BOARD_DOC = 'pages:board';
  let boardTab = false;
  const toggleBoard = (): void => {
    const ws = opts.boardLive && opts.workspaceTabs ? workspaceOf(editor) : null;
    if (ws) {
      boardTab = true;
      if (board) return closeBoard(null);
      if (ws.has(BOARD_DOC)) ws.activate?.(BOARD_DOC);
      else
        ws.open(
          {
            id: BOARD_DOC,
            title: t('board'),
            icon: '<span style="font-size:13px;line-height:1">▦</span>',
            kind: 'canvas',
            onActivate: () => {
              if (!board) startBoard();
            },
            onClosed: () => stopBoard(null),
          },
          { activate: true }
        );
      return;
    }
    boardTab = false;
    if (board) return closeBoard(null);
    startBoard();
  };
  const startBoard = (): void => {
    if (board) return;
    if (opts.injectCss) injectCss();
    boardBack = manager.activeId;
    const canvasEl = (editor.Canvas as any).getElement?.() as HTMLElement | undefined;
    const useLive = opts.boardLive && !!canvasEl;
    const host = useLive ? canvasEl! : (editor.getContainer() as HTMLElement);
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    if (useLive) {
      live = new LiveCanvas(editor, opts.boardWidth, {
        onHeight: (h) => {
          if (editing && editing === manager.activeId) board?.setHeight(editing, h);
        },
        onWheel: (e, sx, sy) => board?.wheel(e, sx, sy),
      });
      editing = manager.activeId;
      renderer.live = {
        home: () => editing,
        busy: (b) => live?.setBusy(b),
        restored: () => board?.update(),
      };
    }
    /** The editor's devices, offered above every frame. */
    const boardDevices = (): BoardDevice[] =>
      ((editor.Devices as any)?.getAll?.()?.models || []).map((d: any) => {
        const w = parseInt(String(d.get('width') || ''), 10);
        return { id: String(d.id ?? d.get('id') ?? d.get('name')), name: String(d.get('name') || d.id), width: Number.isFinite(w) && w > 0 ? w : null };
      });
    /** The editor shows the record in the canvas as its frame's device (styles go to that media). */
    const showAs = (device: BoardDevice | null, width: number): void => {
      const all = boardDevices();
      const target = device || all.find((d) => !d.width);
      try {
        if (target && (editor as any).getDevice?.() !== target.id) (editor as any).setDevice?.(target.id);
      } catch (e) {
        report(e);
      }
      live?.setWidth(width);
    };
    const activate = (id: string): void => {
      void (async () => {
        await renderer.idle();
        if (!board || id === editing) return;
        // The page left keeps its last look.
        const snap = await renderer.snapshotNow();
        if (snap) board?.setSnapshot(snap.id, snap.snap);
        editing = id;
        board?.update();
        await manager.open(id);
        if (board) showAs(board.deviceOf(id), board.widthOf(id));
        board?.update();
      })().catch(report);
    };
    board = new Board({
      t,
      host,
      width: opts.boardWidth,
      items: boardItems,
      activeId: () => boardBack,
      render: (id, force) => renderer.render(id, force),
      head: canvasHead,
      open: (id) => closeBoard(id),
      close: () => closeBoard(null),
      load: () => store.getMeta<BoardState>(BOARD_META).then((v) => v || null),
      save: (st) => void store.setMeta(BOARD_META, st).catch(report),
      devices: boardDevices,
      ...(useLive ? { live: { activeId: () => editing, activate, place: (p) => live?.place(p), device: showAs } } : {}),
    });
    live?.enter();
    void board
      .show()
      .then(() => {
        const cur = editing;
        if (live && board && cur) showAs(board.deviceOf(cur), board.widthOf(cur));
      })
      .catch(report);
    boardShown = !!live;
    editor.trigger(EVENTS.board, { open: true, live: !!live });
  };
  // Another canvas tab shown: the board tab is left.
  on('sidebar-tools:workspace', (e: { type?: string; id?: string }) => {
    if (!board || !boardTab || e?.type !== 'activate' || !e.id || e.id === BOARD_DOC) return;
    const doc = workspaceOf(editor)?.list().find((d) => d.id === e.id);
    if (!doc || doc.kind === 'canvas') stopBoard(null);
  });
  // Live: the editor's device chosen elsewhere (a device toolbar) — the frame on the board follows.
  on('change:device', () => {
    const id = editing;
    if (!board || !live || !id || renderer.busy) return;
    const devId = String((editor as any).getDevice?.() || '');
    const dev = ((editor.Devices as any)?.getAll?.()?.models || []).find((d: any) => String(d.id) === devId || d.get('name') === devId);
    const w = parseInt(String(dev?.get('width') || ''), 10);
    const want = Number.isFinite(w) && w > 0 ? { id: String(dev.id), name: String(dev.get('name') || dev.id), width: w } : null;
    if ((board.deviceOf(id)?.id || null) !== (want?.id || null)) board.setDevice(id, want);
  });
  // Live: the frame of the record being edited follows its changes.
  on('update', () => {
    if (!board || !live) return;
    if (snapTimer) clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      void renderer
        .snapshotNow()
        .then((s) => s && board?.setSnapshot(s.id, s.snap))
        .catch(report);
    }, 1200);
  });
  on(EVENTS.change, () => void board?.reload().catch(report));
  offs.push(() => {
    renderer.dispose();
    board?.destroy();
    board = null;
  });

  const exportArchive = async (o?: ExportOptions): Promise<Uint8Array> => {
    const bytes = await archive.exportBytes(o);
    editor.trigger(EVENTS.exported, { bytes });
    return bytes;
  };

  const archiveFileName = async (): Promise<string> => {
    const n = opts.archiveName;
    const given = typeof n === 'function' ? n() : n;
    if (given) return `${given}.zip`;
    const site = (await store.get('site'))?.name;
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    const base = (site || 'site').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'site';
    return `${base}-${stamp}.zip`;
  };

  const downloadArchive = async (o?: ExportOptions): Promise<void> => {
    const bytes = await exportArchive(o);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = await archiveFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const importArchive = async (file: Blob | ArrayBuffer | Uint8Array, o?: ImportOptions): Promise<ImportReport> => {
    const r = await archive.import(file, o);
    editor.trigger(EVENTS.imported, r);
    sidebar?.flash(fmt(t('importDone'), r.created, r.updated));
    return r;
  };

  const archiveActions: ArchiveActions = {
    isRemote: !!remote,
    download: (o) => downloadArchive(o),
    import: (f, o) => importArchive(f, o),
  };

  const api: PagesManagerApi = {
    list: () => manager.list(),
    open: (id, o) => manager.open(id, o),
    create: (init) => manager.create(init),
    duplicate: (id) => manager.duplicate(id),
    rename,
    remove,
    undo: () => manager.undo(),
    redo: () => manager.redo(),
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    flush: () => manager.flush(),
    detach: () => manager.detach(),
    copy,
    paste,
    sync: async () => {
      if (remote) await refresh();
      else await openSyncModal(editor, sync, t);
    },
    getActiveId: () => manager.activeId,
    getSettings: () => ({ ...sync.settings }),
    setSettings: (s) => sync.setSettings(s),
    whenReady: () => manager.whenReady(),
    store,
    syncService: sync,
    isRemote: () => !!remote,
    update: (id, patch) => update(id, patch),
    designOf: async (id) => manager.designOwner(await store.get(id)),
    pathOf: (id) => pathOf(id),
    publish: (id) => publish(id),
    unpublish: (id) => needRemote().unpublish(id),
    revisions: (id) => needRemote().revisions(id),
    restore: (id, rev) => needRemote().restore(id, rev),
    refresh: () => refresh(),
    resolve: (id, choice) => needRemote().resolve(id, choice),
    importLocal: () => importLocal(),
    move: (id, targetId, where) => movePage(id, targetId, where),
    exportArchive: (o) => exportArchive(o),
    downloadArchive: (o) => downloadArchive(o),
    importArchive: (f, o) => importArchive(f, o),
    components,
    shared: {
      register: (key) => manager.shareKey(key),
      keys: () => manager.sharedKeysList(),
      get: (key) => manager.getShared(key),
      set: (key, value) => manager.setShared(key, value),
    },
    seo: {
      head: async (id, o) => seoHead(await headInput(id), o),
      jsonLd: async (id) => seoJsonLd(await headInput(id)),
      site: () => siteValues(),
      setSite: (values) => setSiteValues(values),
      openSite: () => openSiteSeo(),
    },
    hooks: {
      onLoad: (fn) => manager.addLoadHook(fn),
      onSave: (fn) => manager.addSaveHook(fn),
      onPublish: (fn) => {
        markupHooks.push(fn);
        return () => {
          const i = markupHooks.indexOf(fn);
          if (i >= 0) markupHooks.splice(i, 1);
        };
      },
    },
  };
  ed.PagesManager = api;

  /* ---------------- panel button & commands ---------------- */

  const hostPanel = findHostPanel(editor, opts.panelId);
  const panelButtons = hostPanel?.get('buttons');
  if (panelButtons) {
    (panelButtons as any).add({
      id: PANEL_BUTTON_ID,
      label: PAGE_ICON_HTML(22),
      command: COMMANDS.open,
      togglable: false,
      // Follow run:/stop: of the command, so opening the sidebar from code
      // also highlights the button and deactivates the other views.
      listen: true,
      attributes: { title: t('pages') },
    });
  }

  /**
   * Our panel button, unless another plugin manages it: a docking plugin
   * (grapesjs-sidebar-tools) gives each view a context of its own, keeps
   * the buttons idle and shows the views itself; following the command
   * with the button there would stop the view again.
   */
  const ownButton = (): any => {
    const b = panelButtons?.get(PANEL_BUTTON_ID);
    return b && !b.get('context') ? b : null;
  };
  editor.Commands.add(COMMANDS.open, {
    run() {
      wantOpen = true;
      if (!sidebar) return;
      // Our view replaces the other views of the switcher panel that share
      // its context (a docking plugin gives each view a context of its own,
      // so they can all be visible).
      if (ownButton()) {
        panelButtons?.forEach((b: any) => b.id !== PANEL_BUTTON_ID && b.get('active') && !b.get('context') && b.set('active', false));
      }
      sidebar.show();
      // `listen` follows the command in GrapesJS 0.21, not in 0.23: keep the
      // button in step ourselves (the command is already active, so the
      // button's own run is a no-op) — unless a layout plugin manages it.
      const ours = ownButton();
      if (ours && !ours.get('active')) ours.set('active', true);
    },
    stop() {
      wantOpen = false;
      sidebar?.hide();
      const ours = ownButton();
      if (ours?.get('active')) ours.set('active', false);
    },
  });
  editor.Commands.add(COMMANDS.toggle, {
    run(ed: Editor) {
      if (sidebar?.isOpen) ed.stopCommand(COMMANDS.open);
      else ed.runCommand(COMMANDS.open);
    },
  });
  editor.Commands.add(COMMANDS.copy, { run: () => copy() });
  editor.Commands.add(COMMANDS.paste, { run: () => paste() });
  editor.Commands.add(COMMANDS.sync, { run: () => void openSyncModal(editor, sync, t) });
  editor.Commands.add(COMMANDS.settings, { run: () => void openSettingsModal(editor, sync, t) });
  editor.Commands.add(COMMANDS.publish, { run: () => void publish().catch(report) });
  editor.Commands.add(COMMANDS.refresh, { run: () => void refresh().catch(report) });
  editor.Commands.add(COMMANDS.exportArchive, { run: () => void openExportModal(editor, t, archiveActions) });
  editor.Commands.add(COMMANDS.importArchive, { run: () => void openImportModal(editor, t, archiveActions) });
  editor.Commands.add(COMMANDS.revisions, {
    run: (_ed: Editor, _s: unknown, o: { id?: string } = {}) => {
      const id = o.id || manager.activeId;
      if (remote && id) void openRevisionsModal(editor, remote, t, id).catch(report);
    },
  });
  editor.Commands.add(COMMANDS.siteSeo, { run: () => openSiteSeo() });
  editor.Commands.add(COMMANDS.board, { run: () => toggleBoard() });
  editor.Commands.add(COMMANDS.properties, {
    run: (_ed: Editor, _s: unknown, o: { id?: string } = {}) => {
      const id = o.id || manager.activeId;
      if (id) openProperties(id);
    },
  });

  // Breadcrumbs: drawn from the path of the open record in the page tree.
  let crumbPath: PageRecord[] = [];
  const crumbs = registerBreadcrumbs(editor, {
    path: () => crumbPath,
    label: () => t('breadcrumbs'),
    category: () => t('pages'),
    labels: () => ({ separator: t('bcSeparator'), home: t('bcHome'), current: t('bcCurrent'), designs: t('bcDesigns') }),
  });
  const refreshCrumbs = (): void => {
    const id = manager.activeId;
    void (id ? pathOf(id) : Promise.resolve([] as PageRecord[]))
      .then((p) => {
        const key = (x: PageRecord[]) => x.map((r) => `${r.id}\u0000${r.name}\u0000${r.slug || ''}`).join('|');
        if (key(p) === key(crumbPath)) return;
        crumbPath = p;
        crumbs.refresh();
      })
      .catch(report);
  };
  on(EVENTS.open, refreshCrumbs);
  on(EVENTS.change, refreshCrumbs);
  on('component:add', (c: any) => c?.get?.('type') === BREADCRUMBS_TYPE && setTimeout(() => crumbs.refresh()));
  offs.push(() => crumbs.destroy());

  // Layouts mark where the page goes; the block is offered while one is open.
  registerSlot(editor, opts.slotTag, () => t('slotLabel'));
  on(EVENTS.open, (rec: PageRecord) => toggleSlotBlock(editor, opts.slotTag, rec?.kind === 'layout', t('slotBlock')));

  // The panel undo/redo buttons and the keymaps use the per-page history.
  editor.Commands.add('core:undo', { run: () => void manager.undo() });
  editor.Commands.add('core:redo', { run: () => void manager.redo() });

  /**
   * Keymaps are set up in onReady: GrapesJS adds its default keymaps
   * (`Keymaps.onLoad`) AFTER the plugins ran, which would silently bring
   * back core:copy/core:paste (double paste) and reset the undo/redo keys.
   */
  const setupKeymaps = (): void => {
    const km = editor.Keymaps;
    km.add('core:undo', opts.keys.undo, 'core:undo', { prevent: true });
    km.add('core:redo', opts.keys.redo, 'core:redo', { prevent: true });
    if (opts.takeOverCopyPaste) {
      km.remove('core:copy');
      km.remove('core:paste');
      // GrapesJS does not run keymaps while a text is edited or an input is
      // focused, so the native text copy/paste keeps working there.
      km.add(COMMANDS.copy, opts.keys.copy, (_ed: Editor, _s: unknown, o?: { event?: Event }) => {
        if (copy()) o?.event?.preventDefault();
      });
      km.add(COMMANDS.paste, opts.keys.paste, (_ed: Editor, _s: unknown, o?: { event?: Event }) => {
        if (paste()) o?.event?.preventDefault();
      });
    }
  };

  on('update change:changesCount', manager.schedule);

  /* ---------------- lifecycle ---------------- */

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    offControl();
    disconnectWorkspace();
    components.destroy();
    manager.destroy();
    rstore?.close();
    if (refreshTimer) clearInterval(refreshTimer);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('focus', onOnline);
    sidebar?.destroy();
    toggleBtn?.remove();
    offs.splice(0).forEach((off) => off());
    window.removeEventListener('beforeunload', onUnload);
    if (ed.__gjspCleanup === cleanup) delete ed.__gjspCleanup;
  };
  ed.__gjspCleanup = cleanup;

  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let lastRefresh = 0;
  /** Back online or back to the tab: send what waits, read what changed. */
  function onOnline(): void {
    if (!rstore || !isEditorAlive(editor)) return;
    rstore.wake();
    if (Date.now() - lastRefresh > 5000) {
      lastRefresh = Date.now();
      void rstore.refresh().catch(report);
    }
  }

  function onUnload(): void {
    if (!isEditorAlive(editor)) return cleanup();
    manager.flushOnUnload();
  }
  window.addEventListener('beforeunload', onUnload);
  on('destroy', cleanup); // newer GrapesJS versions emit it

  // Labels that live outside the sidebar.
  on('i18n:locale i18n:update', () =>
    setTimeout(() => {
      const btn = panelButtons?.get(PANEL_BUTTON_ID);
      btn?.set('attributes', { ...(btn.get('attributes') || {}), title: t('pages') });
      if (toggleBtn) toggleBtn.title = t('pages');
    }, 0)
  );

  const mountUi = (): void => {
    if (opts.injectCss) injectCss();
    sidebar = new Sidebar(editor, manager, sync, t, {
      open: (id) => void manager.open(id).catch(report),
      create: () => void createPage().catch(report),
      rename: (id) => void rename(id).catch(report),
      duplicate: (id) => void manager.duplicate(id).catch(report),
      remove: (id) => void remove(id).catch(report),
      undo: () => void manager.undo(),
      redo: () => void manager.redo(),
      sync: () => void (remote ? refresh() : openSyncModal(editor, sync, t)).catch(report),
      settings: () => void openSettingsModal(editor, sync, t),
      close: () => editor.stopCommand(COMMANDS.open),
      createKind: (kind) => void createKind(kind).catch(report),
      properties: (id) => openProperties(id),
      siteSeo: () => openSiteSeo(),
      publish: () => void publish().catch(report),
      revisions: (id) => remote && void openRevisionsModal(editor, remote, t, id).catch(report),
      resolve: (id) => remote && void openConflictModal(editor, remote, t, id).catch(report),
      importLocal: () => void importLocal().catch(report),
      move: (id, targetId, where) => void movePage(id, targetId, where).catch(report),
      exportArchive: () => void openExportModal(editor, t, archiveActions),
      importArchive: () => void openImportModal(editor, t, archiveActions),
      ...(opts.board ? { board: () => toggleBoard() } : {}),
    }, remote);

    const container = editor.getContainer() as HTMLElement;
    const { el, mode } = findSidebarHost(editor, opts.sidebarContainer);
    if (mode === 'floating') {
      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
      sidebar.root.classList.add('gjsp-floating');
      const topPanel = container.querySelector('.gjs-pn-commands, .gjs-pn-options, .panel__top');
      if (topPanel) sidebar.root.style.top = `${topPanel.getBoundingClientRect().height}px`;
    } else {
      sidebar.root.classList.add('gjsp-inline');
    }
    el.appendChild(sidebar.root);

    if (panelButtons) {
      const ours = panelButtons.get(PANEL_BUTTON_ID);
      // Another view was activated (by a click, or by a preset — e.g.
      // preset-webpage opens the Style Manager on select): hide ours, even
      // if it was opened from code and its button is not active.
      const onActive = (b: any): void => {
        if (b.id === PANEL_BUTTON_ID || !b.get('active')) return;
        // A view in another context (e.g. docked by grapesjs-sidebar-tools)
        // is shown next to ours, not instead of it.
        if (b.get('context') !== ours?.get('context')) return;
        if (ours?.get('active')) ours.set('active', false);
        if (sidebar?.isOpen) editor.stopCommand(COMMANDS.open);
      };
      panelButtons.on('change:active', onActive);
      offs.push(() => panelButtons.off('change:active', onActive));
    } else {
      // No switcher panel: our own toggle button.
      toggleBtn = h('button', {
        class: 'gjsp-toggle',
        type: 'button',
        title: t('pages'),
        onclick: () => editor.runCommand(COMMANDS.toggle),
      });
      const groups = container.querySelectorAll('.gjs-pn-buttons');
      const domHost = groups[groups.length - 1];
      if (domHost) {
        toggleBtn.classList.add('gjs-pn-btn', 'gjsp-btn-inline');
        toggleBtn.appendChild(pageIcon(18));
        domHost.appendChild(toggleBtn);
      } else {
        toggleBtn.append(pageIcon(14));
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
        container.appendChild(toggleBtn);
      }
    }
    // The command ran before the sidebar existed (a layout plugin runs every
    // view's command at start): GrapesJS counts it as active and would skip
    // a second run, so show the sidebar directly.
    if (wantOpen) {
      if (editor.Commands.isActive(COMMANDS.open)) sidebar.show();
      else editor.runCommand(COMMANDS.open);
    }
  };

  const start = async (): Promise<void> => {
    if (disposed || !isEditorAlive(editor)) return;
    mountUi();
    await sync.restore();
    await clipboard.restore();
    if (rstore) {
      // The server's lists first; offline, the cache is used as it is.
      await rstore.refresh().catch(report);
      lastRefresh = Date.now();
      window.addEventListener('online', onOnline);
      window.addEventListener('focus', onOnline);
      const every = opts.remote?.refreshInterval ?? 30_000;
      if (every > 0) refreshTimer = setInterval(onOnline, every);
    }
    await components.reload();
    await manager.start();
    await sidebar?.render();
    if (remote) sidebar?.setLocalCount((await remote.localPages()).length);
  };

  editor.onReady(() => {
    if (disposed) return;
    setupKeymaps();
    start().catch(report);
  });
}

definePlugin(pagesPlugin, META);

export default pagesPlugin;
