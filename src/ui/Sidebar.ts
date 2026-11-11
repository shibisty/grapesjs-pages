import type { Editor } from 'grapesjs';
import type { PagesManager } from '../core/PagesManager';
import { EVENTS } from '../events';
import { getLocale, isRtlLocale, type Translator } from '../i18n';
import type { SyncService } from '../sync/SyncService';
import type { RemoteEditor } from '../remote/RemoteEditor';
import type { PageRecord, RecordKind } from '../types';
import { fmt, report } from '../utils';
import { h } from './dom';

export interface SidebarActions {
  open(id: string): void;
  create(): void;
  rename(id: string): void;
  duplicate(id: string): void;
  remove(id: string): void;
  undo(): void;
  redo(): void;
  sync(): void;
  settings(): void;
  close(): void;
  /* remote mode */
  createKind?(kind: RecordKind): void;
  properties?(id: string): void;
  publish?(): void;
  revisions?(id: string): void;
  resolve?(id: string): void;
  importLocal?(): void;
}

/** Pages in tree order (parent before children, siblings by position, name) with their depth. */
export function pageTree(pages: PageRecord[]): Array<{ rec: PageRecord; depth: number }> {
  const ids = new Set(pages.map((p) => p.id));
  const kids = new Map<string | null, PageRecord[]>();
  pages.forEach((p) => {
    const parent = p.parentId && ids.has(p.parentId) && p.parentId !== p.id ? p.parentId : null;
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent)!.push(p);
  });
  const order = (a: PageRecord, b: PageRecord): number =>
    (a.position ?? 0) - (b.position ?? 0) || (a.slug === '/' ? -1 : b.slug === '/' ? 1 : 0) || a.name.localeCompare(b.name);
  const out: Array<{ rec: PageRecord; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number): void => {
    (kids.get(parent) || []).sort(order).forEach((p) => {
      if (seen.has(p.id)) return; // a cycle
      seen.add(p.id);
      out.push({ rec: p, depth });
      walk(p.id, depth + 1);
    });
  };
  walk(null, 0);
  // Pages caught in a parent cycle: at the top.
  pages.filter((p) => !seen.has(p.id)).forEach((p) => out.push({ rec: p, depth: 0 }));
  return out;
}

const FLASH_MS = 2500;

/**
 * The "Pages" panel: toolbar, status line, page list. Pure view — it
 * re-renders on plugin/i18n events and forwards clicks to `actions`.
 */
export class Sidebar {
  readonly root: HTMLDivElement;
  private readonly title: HTMLSpanElement;
  private readonly status: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private readonly btn: Record<'undo' | 'redo' | 'create' | 'publish' | 'revisions' | 'sync' | 'settings' | 'close', HTMLButtonElement>;
  private localCount = 0;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private renderQueued = false;
  private readonly offs: Array<() => void> = [];

  constructor(
    private readonly editor: Editor,
    private readonly manager: PagesManager,
    private readonly sync: SyncService,
    private readonly t: Translator,
    private readonly actions: SidebarActions,
    private readonly remote: RemoteEditor | null = null
  ) {
    const tool = (text: string, onclick: () => void): HTMLButtonElement =>
      h('button', { class: 'gjsp-btn', type: 'button', onclick: () => onclick() }, text);
    this.btn = {
      undo: tool('↶', () => actions.undo()),
      redo: tool('↷', () => actions.redo()),
      create: tool('+', () => actions.create()),
      publish: tool('▲', () => actions.publish?.()),
      revisions: tool('🕘', () => this.manager.activeId && actions.revisions?.(this.manager.activeId)),
      sync: tool('⟳', () => actions.sync()),
      settings: tool('⚙', () => actions.settings()),
      close: tool('✕', () => actions.close()),
    };
    this.title = h('span', { class: 'gjsp-title' });
    this.status = h('div', { class: 'gjsp-status', 'aria-live': 'polite' });
    this.list = h('ul', { class: 'gjsp-list', role: 'listbox' });
    this.root = h(
      'div',
      { class: 'gjsp gjs-one-bg gjs-two-color', hidden: true },
      h(
        'div',
        { class: 'gjsp-head' },
        this.title,
        h(
          'div',
          { class: 'gjsp-tools' },
          // Local mode: the v1 toolbar; remote mode: publish and revisions,
          // no server settings (the host page sets the server).
          ...(Object.keys(this.btn) as (keyof typeof this.btn)[])
            .filter((k) => (remote ? k !== 'settings' : k !== 'publish' && k !== 'revisions'))
            .map((k) => this.btn[k])
        )
      ),
      this.status,
      this.list
    );
    if (remote) this.root.classList.add('gjsp-remote');
    this.relabel();

    const on = (ev: string, fn: (...a: any[]) => void): void => {
      editor.on(ev, fn);
      this.offs.push(() => editor.off(ev, fn));
    };
    on(EVENTS.change, () => this.renderSoon());
    on(EVENTS.settings, () => this.renderSoon());
    on(EVENTS.history, () => this.updateHistory());
    on(EVENTS.copy, (p: { count: number }) => this.flash(fmt(t('copied'), p.count)));
    on(EVENTS.paste, (p: { count: number }) => this.flash(fmt(t('pasted'), p.count)));
    // GrapesJS 0.21 fires `i18n:locale` before storing the new locale.
    on('i18n:locale i18n:update', () => setTimeout(() => this.relabel(), 0));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Applies the current language to every static text. */
  relabel(): void {
    const t = this.t;
    this.title.textContent = t('pages');
    const titles: Record<keyof typeof this.btn, string> = {
      undo: t('undo'),
      redo: t('redo'),
      create: t('newPage'),
      publish: t('publish'),
      revisions: t('revisions'),
      sync: this.remote ? t('refresh') : t('sync'),
      settings: t('settings'),
      close: t('close'),
    };
    (Object.keys(this.btn) as (keyof typeof this.btn)[]).forEach((k) => {
      this.btn[k].title = titles[k];
      this.btn[k].setAttribute('aria-label', titles[k]);
    });
    this.root.setAttribute('dir', isRtlLocale(getLocale(this.editor)) ? 'rtl' : 'ltr');
    this.renderSoon();
  }

  updateHistory(): void {
    this.btn.undo.disabled = !this.manager.canUndo();
    this.btn.redo.disabled = !this.manager.canRedo();
  }

  flash(text: string): void {
    this.status.textContent = text;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null;
      this.renderStatus();
    }, FLASH_MS);
  }

  private formatDate(ts: number): string {
    const d = new Date(ts);
    try {
      return d.toLocaleString(getLocale(this.editor));
    } catch {
      return d.toLocaleString();
    }
  }

  renderStatus(): void {
    if (this.flashTimer) return; // a flash message is showing
    const t = this.t;
    if (this.remote) {
      const st = this.remote.store;
      const text = { idle: t('saved'), saving: t('saving'), offline: t('offline'), error: '' }[st.state];
      const err = st.state === 'error' ? fmt(t('saveError'), [...st.errors.values()][0] || '') : '';
      this.status.textContent = text || err;
      this.status.classList.toggle('gjsp-err', st.state === 'error');
      this.root.classList.add('has-server');
      return;
    }
    const s = this.sync;
    const parts: string[] = [];
    if (s.configured) {
      parts.push(fmt(t('server'), s.settings.url));
      if (s.lastSync) parts.push(fmt(t('lastSync'), this.formatDate(s.lastSync)));
    } else parts.push(t('noServer'));
    this.status.textContent = parts.join(' · ');
    this.root.classList.toggle('has-server', s.configured);
  }

  private subtitle(r: PageRecord): string {
    if (this.remote) {
      const t = this.t;
      const parts: string[] = [];
      if ((r.kind || 'page') === 'page') {
        if (r.slug) parts.push(r.slug);
        parts.push(r.status === 'published' ? t('published') : t('draft'));
      }
      if (r.conflict) parts.push(t('conflict'));
      else if (r.dirty || r.dirtyMeta || !r.remote) parts.push(t('notSent'));
      return parts.join(' · ') || this.formatDate(r.updatedAt);
    }
    const time = this.formatDate(r.updatedAt);
    if (!this.sync.configured) return time;
    const state = r.remote ? (r.dirty ? this.t('notSent') : this.t('onServer')) : this.t('localOnly');
    return `${time} · ${state}`;
  }

  private row(r: PageRecord, depth = 0): HTMLLIElement {
    const t = this.t;
    const a = this.actions;
    const act = (txt: string, title: string, fn: () => void): HTMLButtonElement =>
      h(
        'button',
        {
          class: 'gjsp-act',
          type: 'button',
          title,
          'aria-label': title,
          onclick: (e: Event) => {
            e.stopPropagation();
            fn();
          },
        },
        txt
      );
    const active = r.id === this.manager.activeId;
    const li = h(
      'li',
      {
        class: 'gjsp-item' + (active ? ' is-active' : ''),
        role: 'option',
        tabindex: '0',
        'aria-selected': active ? 'true' : 'false',
        'data-id': r.id,
        onclick: () => a.open(r.id),
        onkeydown: (e: Event) => {
          const k = (e as KeyboardEvent).key;
          if (k === 'Enter' || k === ' ') {
            e.preventDefault();
            a.open(r.id);
          }
        },
      },
      h('span', { class: 'gjsp-dot' + (r.dirty || r.dirtyMeta || r.conflict ? ' is-dirty' : ''), title: t('unsynced') }, '●'),
      h(
        'div',
        { class: 'gjsp-main' },
        h('div', { class: 'gjsp-name', title: r.name }, r.name),
        h('div', { class: 'gjsp-sub' }, this.subtitle(r))
      ),
      h(
        'div',
        { class: 'gjsp-acts' },
        r.conflict && a.resolve ? act('⚠', t('resolve'), () => a.resolve!(r.id)) : null,
        this.remote && a.properties ? act('✎', t('properties'), () => a.properties!(r.id)) : act('✎', t('rename'), () => a.rename(r.id)),
        r.kind === 'site' ? null : act('⧉', t('duplicate'), () => a.duplicate(r.id)),
        r.kind === 'site' ? null : act('✕', t('remove'), () => a.remove(r.id))
      )
    );
    if (depth) li.style.paddingInlineStart = `${10 + depth * 14}px`;
    if (r.conflict) li.classList.add('has-conflict');
    return li;
  }

  async render(): Promise<void> {
    const rows = await this.manager.list();
    if (this.remote) this.renderRemote(rows);
    else this.list.replaceChildren(...rows.map((r) => this.row(r)));
    this.renderStatus();
    this.updateHistory();
  }

  /** Remote mode: pages as a tree, then layouts, templates and the site. */
  private renderRemote(rows: PageRecord[]): void {
    const t = this.t;
    const a = this.actions;
    const of = (k: RecordKind) => rows.filter((r) => (r.kind || 'page') === k);
    const head = (label: string, kind: RecordKind | null, add: string) =>
      h(
        'li',
        { class: 'gjsp-section', role: 'presentation', 'data-section': kind || 'site' },
        h('span', {}, label),
        kind && a.createKind
          ? h('button', { class: 'gjsp-act', type: 'button', title: add, 'aria-label': add, 'data-create': kind, onclick: () => a.createKind!(kind) }, '+')
          : null
      );
    // Entries (pages of a template) belong to grapesjs-storage's views.
    const pages = of('page').filter((r) => !r.templateId);
    const items: HTMLLIElement[] = [head(t('pages'), 'page', t('newPage')), ...pageTree(pages).map(({ rec, depth }) => this.row(rec, depth))];
    items.push(head(t('layouts'), 'layout', t('newLayout')), ...of('layout').map((r) => this.row(r)));
    items.push(head(t('templates'), 'template', t('newTemplate')), ...of('template').map((r) => this.row(r)));
    const site = of('site');
    if (site.length) items.push(head(t('site'), null, ''), ...site.map((r) => this.row({ ...r, name: t('site') })));
    if (this.localCount && a.importLocal) {
      items.push(
        h(
          'li',
          { class: 'gjsp-import', role: 'presentation' },
          h('button', { class: 'gjsp-secondary', type: 'button', 'data-role': 'import', onclick: () => a.importLocal!() }, fmt(t('importLocal'), this.localCount))
        )
      );
    }
    this.list.replaceChildren(...items);
    const active = rows.find((r) => r.id === this.manager.activeId);
    this.btn.publish.disabled = !active || !!active.conflict;
    this.btn.revisions.disabled = !active;
  }

  /** Remote mode: how many v1 local pages can be imported (0 hides the button). */
  setLocalCount(n: number): void {
    this.localCount = n;
    this.renderSoon();
  }

  /** Coalesces bursts of change events into one render. */
  renderSoon(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    Promise.resolve().then(() => {
      this.renderQueued = false;
      this.render().catch(report);
    });
  }

  destroy(): void {
    this.offs.splice(0).forEach((off) => off());
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.root.remove();
  }
}
