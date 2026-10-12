import type { Editor } from 'grapesjs';
import { ComponentClipboard } from './clipboard/ComponentClipboard';
import { isEditorAlive, PagesManager } from './core/PagesManager';
import { COMMANDS, EVENTS } from './events';
import { createTranslator, registerMessages } from './i18n';
import { resolveOptions } from './options';
import { IndexedDbPageStore } from './store/IndexedDbPageStore';
import { SyncService } from './sync/SyncService';
import type { PagesManagerApi, PagesOptions } from './types';
import { fmt, report } from './utils';
import { h, PAGE_ICON_HTML, pageIcon } from './ui/dom';
import { findHostPanel, findSidebarHost } from './ui/host';
import { openSettingsModal, openSyncModal } from './ui/modals';
import { Sidebar } from './ui/Sidebar';
import { injectCss } from './ui/styles';

export const PANEL_BUTTON_ID = 'pages-manager';

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
  const store = opts.store || new IndexedDbPageStore(opts.dbName);
  const manager = new PagesManager(editor, store, opts, t);
  const clipboard = new ComponentClipboard(editor, store, () => manager.activeId);
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
    copy,
    paste,
    sync: async () => {
      await openSyncModal(editor, sync, t);
    },
    getActiveId: () => manager.activeId,
    getSettings: () => ({ ...sync.settings }),
    setSettings: (s) => sync.setSettings(s),
    whenReady: () => manager.whenReady(),
    store,
    syncService: sync,
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

  editor.Commands.add(COMMANDS.open, {
    run() {
      wantOpen = true;
      if (!sidebar) return;
      // Our view replaces the other views of the switcher panel.
      panelButtons?.forEach((b: any) => b.id !== PANEL_BUTTON_ID && b.get('active') && b.set('active', false));
      sidebar.show();
    },
    stop() {
      wantOpen = false;
      sidebar?.hide();
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
    manager.destroy();
    sidebar?.destroy();
    toggleBtn?.remove();
    offs.splice(0).forEach((off) => off());
    window.removeEventListener('beforeunload', onUnload);
    if (ed.__gjspCleanup === cleanup) delete ed.__gjspCleanup;
  };
  ed.__gjspCleanup = cleanup;

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
      sync: () => void openSyncModal(editor, sync, t).catch(report),
      settings: () => void openSettingsModal(editor, sync, t),
      close: () => editor.stopCommand(COMMANDS.open),
    });

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
    if (wantOpen) editor.runCommand(COMMANDS.open);
  };

  const start = async (): Promise<void> => {
    if (disposed || !isEditorAlive(editor)) return;
    mountUi();
    await sync.restore();
    await clipboard.restore();
    await manager.start();
    await sidebar?.render();
  };

  editor.onReady(() => {
    if (disposed) return;
    setupKeymaps();
    start().catch(report);
  });
}
