import type { Editor } from 'grapesjs';
import type { PagesManager } from '../core/PagesManager';
import { EVENTS } from '../events';
import type { PageRecord } from '../types';
import { report } from '../utils';
import { PAGE_ICON_HTML } from '../ui/dom';

/**
 * Pages as document tabs of the grapesjs-sidebar-tools workspace (2.2+).
 *
 * Only the parts of `editor.SidebarTools.workspace` this file needs are
 * typed here, so the plugin has no dependency on sidebar-tools: without
 * it (vanilla GrapesJS) nothing happens.
 *
 * - every opened record gets a "canvas" tab; switching tabs opens the page,
 * - closing a tab only closes the tab (the page stays),
 * - renamed / deleted records update / lose their tab,
 * - tabs of the last session come back after a reload.
 */
export interface WorkspaceLike {
  open(
    doc: {
      id: string;
      title: string;
      icon?: string;
      tooltip?: string;
      kind?: 'canvas' | 'element';
      onActivate?(): void;
    },
    opts?: { activate?: boolean; notify?: boolean },
  ): void;
  update(id: string, patch: { title?: string; tooltip?: string; dirty?: boolean }): void;
  close(id: string, opts?: { force?: boolean; notify?: boolean }): boolean;
  has(id: string): boolean;
  list(): Array<{ id: string }>;
  remembered(prefix: string): string[];
}

interface SidebarToolsLike {
  workspace: WorkspaceLike | null;
  onReady(cb: (ws: WorkspaceLike) => void): void;
}

export const DOC_PREFIX = 'page:';
export const docId = (recordId: string) => `${DOC_PREFIX}${recordId}`;

/** The workspace once grapesjs-sidebar-tools is ready, or never (no sidebar-tools). */
export function onWorkspace(editor: Editor, cb: (ws: WorkspaceLike) => void): void {
  const tools = (editor as unknown as { SidebarTools?: SidebarToolsLike }).SidebarTools;
  if (tools && typeof tools.onReady === 'function') {
    tools.onReady(cb);
    return;
  }
  // sidebar-tools may come later in the plugin list
  const once = (data?: { workspace?: WorkspaceLike }) => {
    editor.off('sidebar-tools:ready', once);
    if (data?.workspace) cb(data.workspace);
  };
  editor.on('sidebar-tools:ready', once);
}

/** Connects the pages to the workspace; returns a cleanup. */
export function connectWorkspace(editor: Editor, manager: PagesManager): () => void {
  let ws: WorkspaceLike | null = null;
  let disposed = false;
  const offs: Array<() => void> = [];
  const on = (ev: string, fn: (...a: any[]) => void) => {
    editor.on(ev, fn);
    offs.push(() => editor.off(ev, fn));
  };

  const tabOf = (rec: PageRecord) => ({
    id: docId(rec.id),
    title: rec.name,
    tooltip: rec.slug ? `${rec.name} — ${rec.slug}` : rec.name,
    icon: PAGE_ICON_HTML(14),
    kind: 'canvas' as const,
    // a tab of a page that is not open: open it
    onActivate: () => {
      if (manager.activeId !== rec.id) manager.open(rec.id).catch(report);
    },
  });

  /** The page that is open now gets / shows its tab (it is already loaded: no notify). */
  const showActive = (rec?: PageRecord | null) => {
    if (!ws || !rec) return;
    ws.open(tabOf(rec), { activate: true, notify: false });
  };

  /** Titles of open tabs; tabs of records that are gone. */
  const sync = async () => {
    if (!ws || disposed) return;
    const records = await manager.list();
    const byId = new Map(records.map((r) => [docId(r.id), r]));
    ws.list()
      .filter((d) => d.id.startsWith(DOC_PREFIX))
      .forEach((d) => {
        const rec = byId.get(d.id);
        if (!rec) ws!.close(d.id, { force: true, notify: false });
        else ws!.update(d.id, { title: rec.name, tooltip: rec.slug ? `${rec.name} — ${rec.slug}` : rec.name, dirty: false });
      });
  };

  const attach = async (workspace: WorkspaceLike) => {
    if (disposed) return;
    ws = workspace;
    await manager.whenReady().catch(() => undefined);
    if (disposed) return;
    const records = await manager.list();
    const byId = new Map(records.map((r) => [docId(r.id), r]));
    // tabs of the last session (in the background), then the open page
    workspace.remembered(DOC_PREFIX).forEach((id) => {
      const rec = byId.get(id);
      if (rec && rec.id !== manager.activeId) workspace.open(tabOf(rec), { activate: false, notify: false });
    });
    const active = manager.activeId ? byId.get(docId(manager.activeId)) : null;
    showActive(active);
  };

  on(EVENTS.open, (rec: PageRecord) => showActive(rec));
  on(EVENTS.change, () => void sync().catch(report));
  onWorkspace(editor, (w) => void attach(w).catch(report));

  return () => {
    disposed = true;
    offs.splice(0).forEach((f) => f());
  };
}
