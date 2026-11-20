import type { Component, Editor } from 'grapesjs';
import { serializeComponent } from '../clipboard/ComponentClipboard';
import { isEditorAlive, type PagesManager } from '../core/PagesManager';
import { COMMANDS, EVENTS } from '../events';
import type { Translator } from '../i18n';
import type { PageRecord, ProjectData } from '../types';
import { fmt, report, uid } from '../utils';
import {
  buildInstance,
  componentProject,
  detachJson,
  expandProject,
  INSTANCE_ATTR,
  INSTANCE_TYPE,
  type Master,
  masterOf,
  ruleKey,
  RULE_INSTANCE,
  RULE_TAG,
} from './expand';

type Json = Record<string, any>;

/** Block Manager category of the components. */
export const BLOCK_CATEGORY = 'gjsp-components';
export const BLOCK_PREFIX = 'gjsp-component-';

const ICON =
  '<svg viewBox="0 0 24 24" width="40" height="40"><path fill="currentColor" d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm11.5 0 4.5 3.5-4.5 3.5z"/></svg>';
const TOOLBAR_EDIT =
  '<svg viewBox="0 0 24 24" style="display:inline-block;vertical-align:middle;width:16px;height:16px"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75zm17.7-10.2a1 1 0 0 0 0-1.42l-2.33-2.33a1 1 0 0 0-1.42 0l-1.83 1.83 3.75 3.75z"/></svg>';

/** The instance a component belongs to (itself, or the closest instance around it). */
export function instanceOf(c: Component | null | undefined): Component | null {
  for (let p: Component | null | undefined = c; p; p = p.parent()) if (p.get('type') === INSTANCE_TYPE) return p;
  return null;
}

/** A component inside an instance (not the instance itself): read-only content. */
const insideInstance = (c: Component): boolean => !!c.parent() && !!instanceOf(c.parent());

/**
 * Where a new component can start from, offered by another plugin
 * (grapesjs-blueprints: its component types). `build` gives the GrapesJS
 * component definition the new component holds.
 */
export interface ComponentSource {
  id: string;
  label: string;
  list(): Array<{ id: string; name: string }>;
  build(itemId: string): Json | Json[];
}

export interface ComponentsApi {
  /** The components (masters), oldest first. */
  list(): Master[];
  /**
   * Creates a component: empty, or from a source's item (`{ source, item }`).
   * Opens it unless `open: false`.
   */
  create(name: string, from?: { source: string; item: string } | null, opts?: { open?: boolean }): Promise<PageRecord>;
  /** Offers another plugin's items as starting points of new components; returns the remover. */
  addSource(source: ComponentSource): () => void;
  /** Registered sources. */
  sources(): ComponentSource[];
  /** Saves a component of the page as a new linked component and puts an instance in its place. */
  save(component?: Component | null, name?: string): Promise<PageRecord | null>;
  /** Opens the component of an instance (or by id) for editing. */
  edit(target?: Component | string | null): Promise<void>;
  /** Turns an instance into a plain copy. Returns the copy. */
  detach(instance?: Component | null): Component | null;
  /** Adds an instance of a component into `target` (default: after the selection or at the end of the page). */
  insert(id: string, target?: Component | null, at?: number): Component | null;
  /** Is this component an instance of a linked component? */
  isInstance(c: Component | null | undefined): boolean;
}

/**
 * Linked components: records of kind `component`, offered as blocks (and so
 * in grapesjs-context-menu's "Add element"), inserted as read-only
 * instances that are rebuilt from the component every time a page is
 * opened. Editing the component = opening its record; "detach" turns an
 * instance into a plain copy.
 */
export class ComponentsFeature implements ComponentsApi {
  private masters = new Map<string, Master>();
  private order: string[] = [];
  /** The page to go back to after editing a component. */
  private returnTo: string | null = null;
  private bar: HTMLDivElement | null = null;
  private readonly offs: Array<() => void> = [];
  private reloadQueued = false;
  private readonly sourceList: ComponentSource[] = [];

  constructor(
    private readonly editor: Editor,
    private readonly manager: PagesManager,
    private readonly t: Translator,
    private readonly flash: (text: string) => void = () => undefined
  ) {
    this.registerType();
    manager.setPrepare((data, rec) => this.prepare(data, rec));
    const on = (ev: string, fn: (...a: any[]) => void): void => {
      editor.on(ev, fn);
      this.offs.push(() => editor.off(ev, fn));
    };
    on(EVENTS.change, () => this.reloadSoon());
    on(EVENTS.open, () => {
      this.syncBlocks();
      this.renderBar();
    });
    on('i18n:locale i18n:update', () => setTimeout(() => (this.syncBlocks(true), this.renderBar()), 0));
    // grapesjs-context-menu asks every plugin for extra items.
    on('context-menu:items', (p: { items: Json[]; ctx: { component: Component } }) => this.menuItems(p));

    editor.Commands.add(COMMANDS.saveComponent, {
      run: (_ed: Editor, _s: unknown, o: { component?: Component; name?: string } = {}) => void this.save(o.component, o.name).catch(report),
    });
    editor.Commands.add(COMMANDS.editComponent, {
      run: (_ed: Editor, _s: unknown, o: { component?: Component } = {}) => void this.edit(o.component).catch(report),
    });
    editor.Commands.add(COMMANDS.detachComponent, {
      run: (_ed: Editor, _s: unknown, o: { component?: Component } = {}) => this.detach(o.component),
    });
  }

  /* ------------------------------------------------------------------ */
  /* Library                                                            */
  /* ------------------------------------------------------------------ */

  list(): Master[] {
    return this.order.map((id) => this.masters.get(id)!).filter(Boolean);
  }

  isInstance(c: Component | null | undefined): boolean {
    return !!c && c.get('type') === INSTANCE_TYPE;
  }

  /** Reads the component records from the store. */
  async reload(): Promise<void> {
    const recs = (await this.manager.list()).filter((r) => r.kind === 'component');
    const next = new Map<string, Master>();
    recs.forEach((r) => next.set(r.id, masterOf(r)));
    const before = JSON.stringify(this.list().map((m) => [m.id, m.name]));
    this.masters = next;
    this.order = recs.map((r) => r.id);
    if (!isEditorAlive(this.editor)) return;
    const after = JSON.stringify(this.list().map((m) => [m.id, m.name]));
    if (before !== after) {
      this.syncBlocks();
      this.renderBar();
      this.editor.trigger(EVENTS.components, this.list());
    }
  }

  private reloadSoon(): void {
    if (this.reloadQueued) return;
    this.reloadQueued = true;
    setTimeout(() => {
      this.reloadQueued = false;
      if (isEditorAlive(this.editor)) void this.reload().catch(report);
    }, 0);
  }

  /** PagesManager hook: instances of the record being opened are rebuilt from their components. */
  private async prepare(data: ProjectData, rec: PageRecord): Promise<ProjectData> {
    await this.reload();
    if (!this.masters.size && !JSON.stringify(data).includes(INSTANCE_TYPE)) return data;
    return expandProject(data, this.masters, rec.kind === 'component' ? rec.id : undefined).data;
  }

  /* ------------------------------------------------------------------ */
  /* The instance type                                                  */
  /* ------------------------------------------------------------------ */

  private registerType(): void {
    const dc = this.editor.DomComponents;
    if (dc.getType(INSTANCE_TYPE)) return;
    const feature = this;
    dc.addType(INSTANCE_TYPE, {
      isComponent: (el: HTMLElement) =>
        el?.getAttribute && el.getAttribute(INSTANCE_ATTR) ? { type: INSTANCE_TYPE } : false,
      model: {
        defaults: {
          tagName: 'div',
          name: 'Component',
          droppable: false,
          editable: false,
          traits: [],
        },
        init(this: Component) {
          feature.initInstance(this);
        },
      },
      view: {
        events: { dblclick: 'onDblClick' } as any,
        onDblClick(this: { model: Component }, e: Event) {
          e.stopPropagation();
          void feature.edit(this.model).catch(report);
        },
      },
    } as any);
  }

  /**
   * A new instance (from a block, the context menu, the API): give it a key
   * and its content. Instances loaded with a page already have both.
   */
  private initInstance(inst: Component): void {
    const target = inst.getAttributes()[INSTANCE_ATTR];
    const m = target ? this.masters.get(target) : undefined;
    if (m) inst.set('name', m.name);
    this.addToolbarButton(inst);
    if (inst.components().length || !m) return;
    let key = inst.getAttributes().id as string | undefined;
    if (!key) {
      key = uid('c').replace(/-/g, '').slice(0, 10);
      inst.addAttributes({ id: key });
    }
    // Inside the component being edited, an instance of itself stays empty.
    const self = this.activeComponentId();
    const b = buildInstance(m, key, this.masters, new Set(self ? [self] : []));
    if (self === m.id) return;
    const css = this.editor.Css as any;
    // A class/tag rule of the component replaces a page rule with the same
    // selector (as on the next load); id rules are the instance's own.
    const byKey = new Map<string, any>();
    (css.getAll().models as any[]).forEach((r) => byKey.set(ruleKey(JSON.parse(JSON.stringify(r))), r));
    const toAdd: Json[] = [...b.scoped];
    b.shared.forEach((rule) => {
      const cur = byKey.get(ruleKey(rule));
      if (!cur) return toAdd.push(rule);
      if (cur.get(RULE_TAG) === m.id) return;
      cur.setStyle({ ...rule.style });
      cur.set(RULE_TAG, m.id);
    });
    if (toAdd.length) css.addCollection(toAdd);
    inst.components(b.components as any);
  }

  private addToolbarButton(inst: Component): void {
    const add = (): void => {
      const tb = (inst.get('toolbar') as Json[] | undefined) || [];
      if (!tb.length || tb.some((b) => b.command === COMMANDS.editComponent)) return;
      (inst as any).set('toolbar', [
        { label: TOOLBAR_EDIT, command: COMMANDS.editComponent, attributes: { title: this.t('editComponent') } },
        ...tb,
      ]);
    };
    // The default toolbar is built after init.
    setTimeout(add, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Blocks                                                             */
  /* ------------------------------------------------------------------ */

  private activeComponentId(): string | null {
    const id = this.manager.activeId;
    return id && this.masters.has(id) ? id : null;
  }

  /**
   * One block per component in the "Components" category; the component
   * being edited is left out (it cannot contain itself).
   */
  syncBlocks(relabel = false): void {
    if (!isEditorAlive(this.editor)) return;
    const bm = this.editor.Blocks as any;
    const self = this.activeComponentId();
    const want = new Set(this.list().filter((m) => m.id !== self).map((m) => BLOCK_PREFIX + m.id));
    (bm.getAll().models as any[])
      .filter((b) => String(b.id).startsWith(BLOCK_PREFIX) && (!want.has(b.id) || relabel))
      .forEach((b) => bm.remove(b.id));
    const category = { id: BLOCK_CATEGORY, label: this.t('components') };
    this.list().forEach((m) => {
      const id = BLOCK_PREFIX + m.id;
      if (!want.has(id)) return;
      const cur = bm.get(id);
      if (cur) {
        if (cur.get('label') !== m.name) cur.set('label', m.name);
        return;
      }
      bm.add(id, {
        label: m.name,
        category,
        media: ICON,
        content: { type: INSTANCE_TYPE, attributes: { [INSTANCE_ATTR]: m.id } },
        attributes: { title: m.name },
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                            */
  /* ------------------------------------------------------------------ */

  addSource(source: ComponentSource): () => void {
    const i = this.sourceList.findIndex((s) => s.id === source.id);
    if (i >= 0) this.sourceList.splice(i, 1, source);
    else this.sourceList.push(source);
    return () => {
      const j = this.sourceList.indexOf(source);
      if (j >= 0) this.sourceList.splice(j, 1);
    };
  }

  sources(): ComponentSource[] {
    return [...this.sourceList];
  }

  async create(name: string, from?: { source: string; item: string } | null, opts: { open?: boolean } = {}): Promise<PageRecord> {
    let content: Json[] = [];
    if (from) {
      const src = this.sourceList.find((s) => s.id === from.source);
      if (!src) throw new Error(`grapesjs-pages: no component source "${from.source}"`);
      const built = src.build(from.item);
      content = (Array.isArray(built) ? built : [built]).filter(Boolean);
    }
    const title = (name || '').trim() || `${this.t('componentName')} ${this.list().length + 1}`;
    const rec = this.manager.newRecord(title, componentProject(content, []), { kind: 'component' });
    await this.manager.add(rec);
    this.masters.set(rec.id, masterOf(rec));
    this.order.push(rec.id);
    this.syncBlocks();
    this.editor.trigger(EVENTS.components, this.list());
    if (opts.open !== false) await this.manager.open(rec.id);
    return rec;
  }

  async save(component?: Component | null, name?: string): Promise<PageRecord | null> {
    const c = component || this.editor.getSelected();
    if (!c || !c.parent() || insideInstance(c) || this.isInstance(c)) return null;
    let title = name;
    if (title == null) {
      const n = this.list().length + 1;
      const suggestion = c.getName?.() && c.getName() !== 'Box' ? c.getName() : `${this.t('componentName')} ${n}`;
      title = window.prompt(this.t('promptComponentName'), suggestion) ?? '';
    }
    title = title.trim();
    if (!title) return null;

    // The rules about the component and its descendants go with it.
    const rules = this.rulesOf(c);
    const css = (this.editor.getCss({ component: c, avoidProtected: true } as any) as string) || '';
    const json = serializeComponent(c, css);
    // toJSON() of a rule is shallow (selectors stay a live collection): a plain deep copy.
    const ruleJson = JSON.parse(JSON.stringify(rules)) as Json[];
    const rec = this.manager.newRecord(title, componentProject([json], ruleJson), { kind: 'component' });
    await this.manager.add(rec);
    this.masters.set(rec.id, masterOf(rec));
    this.order.push(rec.id);
    this.syncBlocks();
    this.editor.trigger(EVENTS.components, this.list());

    // The original becomes an instance of the new component.
    const parent = c.parent()!;
    const at = c.index();
    const added = parent.components().add({ type: INSTANCE_TYPE, attributes: { [INSTANCE_ATTR]: rec.id } } as any, { at }) as unknown as Component;
    c.remove();
    // The id rules now live in the component (its instance has its own copies).
    const ids = new Set(this.subtree(c).map((x) => x.getId()));
    rules.filter((r) => this.ruleIds(r).some((id) => ids.has(id)) && !r.get(RULE_TAG)).forEach((r) => (this.editor.Css as any).remove(r));
    this.editor.select(added);
    this.flash(fmt(this.t('componentSaved'), title));
    return rec;
  }

  async edit(target?: Component | string | null): Promise<void> {
    let id: string | undefined;
    if (typeof target === 'string') id = target;
    else {
      const inst = instanceOf(target || this.editor.getSelected());
      id = inst?.getAttributes()[INSTANCE_ATTR];
    }
    if (!id || !this.masters.has(id)) return;
    const from = this.manager.activeId;
    if (from && from !== id && !this.masters.has(from)) this.returnTo = from;
    await this.manager.open(id);
  }

  detach(instance?: Component | null): Component | null {
    const inst = instanceOf(instance || this.editor.getSelected());
    if (!inst || !inst.parent()) return null;
    const json = detachJson(JSON.parse(JSON.stringify(inst)) as Json);
    const key = inst.getAttributes().id;
    const master = inst.getAttributes()[INSTANCE_ATTR];
    // Its rules stay on the page as ordinary rules.
    ((this.editor.Css as any).getAll().models as any[]).forEach((r) => {
      if ((key && r.get(RULE_INSTANCE) === key) || (!r.get(RULE_INSTANCE) && r.get(RULE_TAG) === master)) {
        r.unset(RULE_TAG);
        r.unset(RULE_INSTANCE);
      }
    });
    const parent = inst.parent()!;
    const at = inst.index();
    // GrapesJS drops the #id rules of a removed component: the copy keeps the same ids.
    inst.remove({ keepIds: this.subtree(inst).map((x) => x.getId()) } as any);
    const copy = parent.components().add(json as any, { at }) as unknown as Component;
    this.editor.select(copy);
    return copy;
  }

  insert(id: string, target?: Component | null, at?: number): Component | null {
    if (!this.masters.has(id) || this.activeComponentId() === id) return null;
    let parent = target || null;
    let index = at;
    if (!parent) {
      const sel = this.editor.getSelected();
      if (sel && sel.parent() && !insideInstance(sel)) {
        parent = sel.parent()!;
        index = sel.index() + 1;
      } else parent = this.editor.getWrapper() || null;
    }
    if (!parent) return null;
    const added = parent.components().add(
      { type: INSTANCE_TYPE, attributes: { [INSTANCE_ATTR]: id } } as any,
      index !== undefined ? { at: index } : {}
    ) as unknown as Component;
    this.editor.select(added);
    return added;
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */

  private subtree(c: Component): Component[] {
    const out: Component[] = [];
    const walk = (x: Component): void => {
      if (x.get('type') === 'textnode') return;
      out.push(x);
      x.components().forEach(walk);
    };
    walk(c);
    return out;
  }

  private ruleIds(rule: any): string[] {
    const sels = (rule.get('selectors')?.models || []) as any[];
    return sels.filter((s) => s.get('type') === 2).map((s) => s.get('name'));
  }

  /** CSS rules whose selectors match the component or a descendant (by id and classes). */
  private rulesOf(c: Component): any[] {
    const nodes = this.subtree(c).map((x) => ({
      id: x.getId(),
      classes: new Set<string>(x.getClasses() as string[]),
    }));
    return ((this.editor.Css as any).getAll().models as any[]).filter((r) => {
      if (r.get('selectorsAdd') || r.get(RULE_TAG)) return false;
      const sels = (r.get('selectors')?.models || []) as any[];
      if (!sels.length) return false;
      return nodes.some((n) =>
        sels.every((s) => (s.get('type') === 2 ? s.get('name') === n.id : n.classes.has(s.get('name'))))
      );
    });
  }

  /** Items for grapesjs-context-menu (`context-menu:items`). */
  private menuItems({ items, ctx }: { items: Json[]; ctx: { component: Component } }): void {
    const c = ctx?.component;
    if (!c || !Array.isArray(items)) return;
    const inst = instanceOf(c);
    if (inst) {
      items.push(
        { id: 'gjsp-edit-component', icon: '✎', label: this.t('editComponent'), separator: true, run: () => void this.edit(inst).catch(report) },
        { id: 'gjsp-detach-component', icon: '⛓', label: this.t('detachComponent'), run: () => this.detach(inst) }
      );
    } else if (c.parent()) {
      items.push({ id: 'gjsp-save-component', icon: '❖', label: this.t('saveAsComponent'), separator: true, run: () => void this.save(c).catch(report) });
    }
  }

  /* ------------------------------------------------------------------ */
  /* "Editing a component" bar over the canvas                          */
  /* ------------------------------------------------------------------ */

  renderBar(): void {
    if (!isEditorAlive(this.editor)) return;
    const id = this.activeComponentId();
    if (!id) {
      this.bar?.remove();
      this.bar = null;
      const active = this.manager.activeId;
      if (active && this.returnTo === active) this.returnTo = null;
      return;
    }
    let host: HTMLElement | null = null;
    try {
      host = (this.editor.Canvas as any).getElement?.() || null;
    } catch {
      host = null;
    }
    host = host || (this.editor.getContainer() as HTMLElement | null);
    if (!host) return;
    if (!this.bar) {
      this.bar = document.createElement('div');
      this.bar.className = 'gjsp-component-bar';
    }
    if (this.bar.parentElement !== host) host.appendChild(this.bar);
    const label = document.createElement('span');
    label.textContent = fmt(this.t('editingComponent'), this.masters.get(id)!.name);
    const kids: Node[] = [label];
    const back = this.returnTo;
    if (back) {
      void this.manager.store
        .get(back)
        .then((rec) => {
          if (!rec || rec.deleted || !this.bar || this.returnTo !== back) return;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'gjsp-component-back';
          btn.textContent = fmt(this.t('backTo'), rec.name);
          btn.addEventListener('click', () => void this.manager.open(back).catch(report));
          this.bar.querySelector('.gjsp-component-back')?.remove();
          this.bar.appendChild(btn);
        })
        .catch(report);
    }
    this.bar.replaceChildren(...kids);
  }

  destroy(): void {
    this.offs.splice(0).forEach((off) => off());
    this.manager.setPrepare(null);
    this.bar?.remove();
    this.bar = null;
  }
}
