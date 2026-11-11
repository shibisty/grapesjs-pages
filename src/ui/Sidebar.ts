import type { Editor } from 'grapesjs';
import type { PagesManager } from '../core/PagesManager';
import { EVENTS } from '../events';
import { getLocale, isRtlLocale, type Translator } from '../i18n';
import type { SyncService } from '../sync/SyncService';
import type { RemoteEditor } from '../remote/RemoteEditor';
import type { PageRecord, RecordKind } from '../types';
import { fmt, report } from '../utils';
import { h } from './dom';
import { type DropWhere, keyboardMove, matches, pageTree, searchTree, subtree } from './tree';

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
  /** Moves a page in the tree (drag and drop, Alt+arrows). */
  move?(id: string, targetId: string, where: DropWhere): void;
}

/** Meta key of the collapsed pages of the tree (remote mode). */
export const COLLAPSED_META = 'collapsed';

export { pageTree } from './tree';

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
  private readonly search: HTMLInputElement;
  private query = '';
  private collapsed = new Set<string>();
  private dragId: string | null = null;
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
    this.search = h('input', {
      class: 'gjsp-search',
      type: 'search',
      autocomplete: 'off',
      spellcheck: 'false',
      oninput: () => {
        this.query = this.search.value;
        this.renderSoon();
      },
      onkeydown: (e: Event) => {
        const k = (e as KeyboardEvent).key;
        if (k === 'Escape' && this.search.value) {
          e.stopPropagation();
          this.search.value = '';
          this.query = '';
          this.renderSoon();
        } else if (k === 'Enter') {
          // Open the first match.
          const first = this.list.querySelector<HTMLElement>('.gjsp-item.is-match, .gjsp-item:not(.is-context)');
          if (first?.dataset.id) actions.open(first.dataset.id);
        } else if (k === 'ArrowDown') {
          e.preventDefault();
          this.list.querySelector<HTMLElement>('.gjsp-item')?.focus();
        }
      },
    });
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
      h('div', { class: 'gjsp-searchbox' }, this.search),
      this.list
    );
    if (remote) {
      this.root.classList.add('gjsp-remote');
      void manager.store
        .getMeta<string[]>(COLLAPSED_META)
        .then((ids) => {
          if (ids?.length) {
            this.collapsed = new Set(ids);
            this.renderSoon();
          }
        })
        .catch(report);
    }
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
    this.search.placeholder = t('search');
    this.search.setAttribute('aria-label', t('search'));
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

  private row(r: PageRecord, depth = 0, tree?: { parent: boolean; open: boolean; pages: PageRecord[] }): HTMLLIElement {
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
          const ev = e as KeyboardEvent;
          const k = ev.key;
          if (k === 'Enter' || k === ' ') {
            e.preventDefault();
            a.open(r.id);
          } else if (tree && ev.altKey && a.move && k.startsWith('Arrow')) {
            // Alt+arrows move the page in the tree.
            const keys: Record<string, 'up' | 'down' | 'in' | 'out'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowRight: 'in', ArrowLeft: 'out' };
            const dir = keys[k];
            const rtl = this.root.getAttribute('dir') === 'rtl';
            const m = dir && keyboardMove(tree.pages, r.id, rtl && dir === 'in' ? 'out' : rtl && dir === 'out' ? 'in' : dir);
            e.preventDefault();
            if (m) a.move(r.id, m.targetId, m.where);
          } else if (k === 'ArrowDown' || k === 'ArrowUp') {
            e.preventDefault();
            const items = [...this.list.querySelectorAll<HTMLElement>('.gjsp-item')];
            const i = items.indexOf(e.currentTarget as HTMLElement);
            items[i + (k === 'ArrowDown' ? 1 : -1)]?.focus();
          } else if (tree?.parent && (k === 'ArrowRight' || k === 'ArrowLeft')) {
            e.preventDefault();
            this.toggle(r.id, k === (this.root.getAttribute('dir') === 'rtl' ? 'ArrowLeft' : 'ArrowRight'));
          }
        },
      },
      tree
        ? h(
            'button',
            {
              class: 'gjsp-twisty',
              type: 'button',
              tabindex: '-1',
              'aria-hidden': tree.parent ? false : 'true',
              title: tree.parent ? (tree.open ? t('collapse') : t('expand')) : false,
              disabled: !tree.parent,
              onclick: (e: Event) => {
                e.stopPropagation();
                this.toggle(r.id, !tree.open);
              },
            },
            tree.parent ? (tree.open ? '▾' : '▸') : ''
          )
        : null,
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
    if (tree && a.move) this.draggable(li, r.id, tree.pages);
    return li;
  }

  /** Expands or collapses a page of the tree (kept in the store's meta). */
  toggle(id: string, open: boolean): void {
    if (open) this.collapsed.delete(id);
    else this.collapsed.add(id);
    void this.manager.store.setMeta(COLLAPSED_META, [...this.collapsed]).catch(report);
    this.renderSoon();
  }

  /**
   * Drag and drop of a page row: the upper quarter of a row drops before
   * it, the lower quarter after it, the middle inside it (as its last
   * child). A page cannot go into its own subtree.
   */
  private draggable(li: HTMLLIElement, id: string, pages: PageRecord[]): void {
    li.draggable = true;
    const zone = (e: Event): DropWhere => {
      const rect = li.getBoundingClientRect();
      const y = (e as MouseEvent).clientY - rect.top;
      if (!rect.height) return 'inside';
      return y < rect.height / 4 ? 'before' : y > (rect.height * 3) / 4 ? 'after' : 'inside';
    };
    const clear = (): void => li.classList.remove('drop-before', 'drop-inside', 'drop-after');
    li.addEventListener('dragstart', (e) => {
      this.dragId = id;
      li.classList.add('is-dragging');
      const dt = (e as DragEvent).dataTransfer;
      if (dt) {
        dt.effectAllowed = 'move';
        dt.setData('text/plain', id);
      }
    });
    li.addEventListener('dragend', () => {
      this.dragId = null;
      li.classList.remove('is-dragging');
      this.list.querySelectorAll('.drop-before, .drop-inside, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-inside', 'drop-after'));
    });
    li.addEventListener('dragover', (e) => {
      const from = this.dragId;
      if (!from || from === id) return;
      const where = zone(e);
      // Not a page of this tree, or into its own subtree: no drop here.
      if (!pages.some((p) => p.id === from) || subtree(pages, from).has(id)) return;
      e.preventDefault();
      clear();
      li.classList.add(`drop-${where}`);
    });
    li.addEventListener('dragleave', clear);
    li.addEventListener('drop', (e) => {
      const from = this.dragId;
      clear();
      if (!from || from === id) return;
      e.preventDefault();
      const where = zone(e);
      this.dragId = null;
      if (where === 'inside') this.collapsed.delete(id); // show where it went
      this.actions.move?.(from, id, where);
    });
  }

  async render(): Promise<void> {
    const rows = await this.manager.list();
    if (this.remote) this.renderRemote(rows);
    else {
      const shown = rows.filter((r) => matches(r, this.query));
      this.list.replaceChildren(...(shown.length || !rows.length ? shown.map((r) => this.row(r)) : [this.nothing()]));
    }
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
    // A search shows the matches with their ancestors, everything expanded.
    const visible = searchTree(pages, this.query);
    const tree = pageTree(pages, visible ? new Set() : this.collapsed).filter((row) => !visible || visible.has(row.rec.id));
    const pageRows = tree.map(({ rec, depth, parent }) => {
      const li = this.row(rec, depth, { parent, open: !!visible || !this.collapsed.has(rec.id), pages });
      if (visible) li.classList.add(matches(rec, this.query) ? 'is-match' : 'is-context');
      return li;
    });
    const plain = (k: RecordKind) => of(k).filter((r) => matches(r, this.query));
    const site = of('site').filter((r) => matches({ ...r, name: t('site') }, this.query));
    const items: HTMLLIElement[] = [head(t('pages'), 'page', t('newPage')), ...pageRows];
    items.push(head(t('layouts'), 'layout', t('newLayout')), ...plain('layout').map((r) => this.row(r)));
    items.push(head(t('templates'), 'template', t('newTemplate')), ...plain('template').map((r) => this.row(r)));
    if (of('site').length && (!this.query || site.length)) items.push(head(t('site'), null, ''), ...site.map((r) => this.row({ ...r, name: t('site') })));
    if (this.query && !pageRows.length && !plain('layout').length && !plain('template').length && !site.length) items.push(this.nothing());
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

  private nothing(): HTMLLIElement {
    return h('li', { class: 'gjsp-empty', role: 'presentation' }, this.t('noMatches'));
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
