import type { Editor } from 'grapesjs';
import { ComponentClipboard } from './clipboard/ComponentClipboard';
import { isEditorAlive, PagesManager } from './core/PagesManager';
import { COMMANDS, EVENTS } from './events';
import { createTranslator, registerMessages } from './i18n';
import { resolveOptions } from './options';
import { RemoteClient } from './remote/RemoteClient';
import { RemoteEditor } from './remote/RemoteEditor';
import { RemotePageStore } from './remote/RemotePageStore';
import { registerSlot, toggleSlotBlock } from './remote/slot';
import { IndexedDbPageStore } from './store/IndexedDbPageStore';
import type { PageStore } from './store/types';
import { SyncService } from './sync/SyncService';
import type { PageRecord, PagesManagerApi, PagesOptions, RecordKind } from './types';
import { fmt, report } from './utils';
import { h, PAGE_ICON_HTML, pageIcon } from './ui/dom';
import { findHostPanel, findSidebarHost } from './ui/host';
import { openSettingsModal, openSyncModal } from './ui/modals';
import { openConflictModal, openPropertiesModal, openRevisionsModal } from './ui/remoteModals';
import { Sidebar } from './ui/Sidebar';
import { type DropWhere, moveInTree } from './ui/tree';
import { injectCss } from './ui/styles';
import { connectWorkspace } from './integration/workspace';

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
export default function pagesPlugin(editor: Editor, userOpts: PagesOptions = {}): void {
  const ed = editor as EditorWithPages;
  ed.__gjspCleanup?.(); // applied twice to the same editor: replace the old instance

  const opts = resolveOptions(userOpts);
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
          editor.trigger(EVENTS.change);
          editor.trigger(EVENTS.remote, rstore!.state);
        },
        onRemote: (rec) => {
          if (rec.id === manager.activeId) void manager.replaceRecord(rec).catch(report);
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
  // With grapesjs-sidebar-tools 2.2+: every opened page is a tab of its workspace.
  const disconnectWorkspace = opts.workspaceTabs ? connectWorkspace(editor, manager) : () => undefined;
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
      if (!window.confirm(fmt(t('confirmRemove'), rec.name))) return;
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
    const r = needRemote();
    const pages = (await manager.list()).filter((p) => (p.kind || 'page') === 'page' && !p.templateId);
    const changes = moveInTree(pages, id, targetId, where);
    for (const c of changes) await r.update(c.id, { parentId: c.parentId, position: c.position });
    return changes.length;
  };

  /** A new page, layout or template, named "<Kind> <n>". */
  const createKind = async (kind: RecordKind): Promise<PageRecord> => {
    const base = kind === 'layout' ? t('layout') : kind === 'template' ? t('newTemplate') : t('defaultName');
    const taken = new Set((await manager.list()).map((r) => r.name));
    let n = (await manager.list()).filter((r) => (r.kind || 'page') === kind).length + 1;
    while (taken.has(`${base} ${n}`)) n++;
    return manager.create({ kind, name: `${base} ${n}` });
  };

  const importLocal = async (): Promise<number> => {
    const n = await needRemote().importLocal();
    sidebar?.setLocalCount(0);
    sidebar?.flash(fmt(t('imported'), n));
    return n;
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
    update: (id, patch) => needRemote().update(id, patch),
    publish: (id) => publish(id),
    unpublish: (id) => needRemote().unpublish(id),
    revisions: (id) => needRemote().revisions(id),
    restore: (id, rev) => needRemote().restore(id, rev),
    refresh: () => refresh(),
    resolve: (id, choice) => needRemote().resolve(id, choice),
    importLocal: () => importLocal(),
    move: (id, targetId, where) => movePage(id, targetId, where),
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
  editor.Commands.add(COMMANDS.revisions, {
    run: (_ed: Editor, _s: unknown, o: { id?: string } = {}) => {
      const id = o.id || manager.activeId;
      if (remote && id) void openRevisionsModal(editor, remote, t, id).catch(report);
    },
  });
  editor.Commands.add(COMMANDS.properties, {
    run: (_ed: Editor, _s: unknown, o: { id?: string } = {}) => {
      const id = o.id || manager.activeId;
      if (remote && id) void openPropertiesModal(editor, remote, t, id).catch(report);
    },
  });

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
    disconnectWorkspace();
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
      create: () => void manager.create().catch(report),
      rename: (id) => void rename(id).catch(report),
      duplicate: (id) => void manager.duplicate(id).catch(report),
      remove: (id) => void remove(id).catch(report),
      undo: () => void manager.undo(),
      redo: () => void manager.redo(),
      sync: () => void (remote ? refresh() : openSyncModal(editor, sync, t)).catch(report),
      settings: () => void openSettingsModal(editor, sync, t),
      close: () => editor.stopCommand(COMMANDS.open),
      createKind: (kind) => void createKind(kind).catch(report),
      properties: (id) => remote && void openPropertiesModal(editor, remote, t, id).catch(report),
      publish: () => void publish().catch(report),
      revisions: (id) => remote && void openRevisionsModal(editor, remote, t, id).catch(report),
      resolve: (id) => remote && void openConflictModal(editor, remote, t, id).catch(report),
      importLocal: () => void importLocal().catch(report),
      move: (id, targetId, where) => void movePage(id, targetId, where).catch(report),
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
