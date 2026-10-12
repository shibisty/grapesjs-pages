import type { Editor } from 'grapesjs';
import type { PagesManager } from '../core/PagesManager';
import { EVENTS } from '../events';
import { getLocale, isRtlLocale, type Translator } from '../i18n';
import type { SyncService } from '../sync/SyncService';
import type { PageRecord } from '../types';
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
  private readonly btn: Record<'undo' | 'redo' | 'create' | 'sync' | 'settings' | 'close', HTMLButtonElement>;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private renderQueued = false;
  private readonly offs: Array<() => void> = [];

  constructor(
    private readonly editor: Editor,
    private readonly manager: PagesManager,
    private readonly sync: SyncService,
    private readonly t: Translator,
    private readonly actions: SidebarActions
  ) {
    const tool = (text: string, onclick: () => void): HTMLButtonElement =>
      h('button', { class: 'gjsp-btn', type: 'button', onclick: () => onclick() }, text);
    this.btn = {
      undo: tool('↶', () => actions.undo()),
      redo: tool('↷', () => actions.redo()),
      create: tool('+', () => actions.create()),
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
      h('div', { class: 'gjsp-head' }, this.title, h('div', { class: 'gjsp-tools' }, ...Object.values(this.btn))),
      this.status,
      this.list
    );
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
      sync: t('sync'),
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
    const time = this.formatDate(r.updatedAt);
    if (!this.sync.configured) return time;
    const state = r.remote ? (r.dirty ? this.t('notSent') : this.t('onServer')) : this.t('localOnly');
    return `${time} · ${state}`;
  }

  private row(r: PageRecord): HTMLLIElement {
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
    return h(
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
      h('span', { class: 'gjsp-dot' + (r.dirty ? ' is-dirty' : ''), title: t('unsynced') }, '●'),
      h(
        'div',
        { class: 'gjsp-main' },
        h('div', { class: 'gjsp-name', title: r.name }, r.name),
        h('div', { class: 'gjsp-sub' }, this.subtitle(r))
      ),
      h(
        'div',
        { class: 'gjsp-acts' },
        act('✎', t('rename'), () => a.rename(r.id)),
        act('⧉', t('duplicate'), () => a.duplicate(r.id)),
        act('✕', t('remove'), () => a.remove(r.id))
      )
    );
  }

  async render(): Promise<void> {
    const rows = await this.manager.list();
    this.list.replaceChildren(...rows.map((r) => this.row(r)));
    this.renderStatus();
    this.updateHistory();
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
