import type { PageRecord, ProjectData } from '../types';
import { clone } from '../utils';

type Json = Record<string, any>;

/** Component type of a linked copy (an "instance") of a component record. */
export const INSTANCE_TYPE = 'gjsp-component';
/** Attribute that names the component record an instance shows. */
export const INSTANCE_ATTR = 'data-gjsp-component';
/** Marks CSS rules that come from a component (regenerated on every load). */
export const RULE_TAG = 'gjspc';
/** Marks CSS rules that belong to one instance (its scoped `#id` rules). */
export const RULE_INSTANCE = 'gjspi';

/**
 * What makes the content of an instance read-only: it can only be changed in
 * the component itself. `locked` lets clicks go through to the instance, so
 * the instance is what gets selected.
 */
const LOCK: Json = {
  locked: true,
  selectable: false,
  hoverable: false,
  highlightable: false,
  badgable: false,
  layerable: false,
  draggable: false,
  droppable: false,
  editable: false,
  removable: false,
  copyable: false,
  stylable: false,
};
const LOCK_KEYS = Object.keys(LOCK);

/** The content and the styles of one component record. */
export interface Master {
  id: string;
  name: string;
  components: Json[];
  styles: Json[];
}

export type Library = ReadonlyMap<string, Master>;

/** The top-level components of a project (its first page's wrapper). */
export function wrapperOf(data: ProjectData | null | undefined): Json | null {
  const d = data as Json | null | undefined;
  const frame = d?.pages?.[0]?.frames?.[0];
  const comp = frame?.component;
  return comp && typeof comp === 'object' ? comp : null;
}

/** A component record as a master: its wrapper's children and its CSS rules. */
export function masterOf(rec: PageRecord): Master {
  const w = wrapperOf(rec.data);
  const comps = Array.isArray(w?.components) ? (w!.components as Json[]) : [];
  const styles = Array.isArray((rec.data as Json | null)?.styles) ? ((rec.data as Json).styles as Json[]) : [];
  return { id: rec.id, name: rec.name, components: comps, styles };
}

/** Project data of a new component holding `components` and `styles`. */
export function componentProject(components: Json[], styles: Json[]): ProjectData {
  return {
    assets: [],
    styles,
    pages: [{ frames: [{ component: { type: 'wrapper', components } }] }],
  } as unknown as ProjectData;
}

const isInstance = (j: Json): boolean => !!j && j.type === INSTANCE_TYPE;
const instanceTarget = (j: Json): string | undefined => j?.attributes?.[INSTANCE_ATTR];

/** Every `#id` a selector list mentions. */
const idsIn = (s: string): string[] => [...s.matchAll(/#([\w-]+)/g)].map((m) => m[1]);

/** Selector strings of a rule JSON (`'#a'`, `'box'`; objects in some versions). */
function selectorNames(rule: Json): string[] {
  const sels: unknown[] = Array.isArray(rule.selectors) ? rule.selectors : [];
  return sels.map((s) => {
    if (typeof s === 'string') return s;
    const o = s as Json;
    // type 2 = id selector in GrapesJS' Selector model
    return o.type === 2 || o.type === 'id' ? `#${o.name}` : String(o.name ?? '');
  });
}

/** Identity of a rule for "the component's rule replaces the page's one". */
export function ruleKey(rule: Json): string {
  return JSON.stringify([
    selectorNames(rule).slice().sort(),
    rule.selectorsAdd || '',
    rule.state || '',
    rule.mediaText || '',
    rule.atRuleType || '',
  ]);
}

const renameIds = (s: string, map: Record<string, string>): string =>
  s.replace(/#([\w-]+)/g, (m, id: string) => (map[id] ? `#${map[id]}` : m));

/**
 * A copy of master content for the instance `key`: every explicit id `x`
 * becomes `x-key` (unique on the page, the same on every load), all nodes
 * are locked, nested instances are expanded too (`seen` stops cycles).
 */
function copyContent(nodes: Json[], key: string, map: Record<string, string>, nested: Json[]): Json[] {
  const walk = (j: Json): Json => {
    if (!j || typeof j !== 'object') return j;
    const out: Json = { ...j };
    if (out.attributes?.id) {
      const nid = `${out.attributes.id}-${key}`;
      map[out.attributes.id] = nid;
      out.attributes = { ...out.attributes, id: nid };
    }
    if (isInstance(out)) {
      // A component inside the component: expanded from its own master.
      Object.assign(out, LOCK);
      nested.push(out);
      return out;
    }
    if (out.type !== 'textnode') Object.assign(out, LOCK);
    if (Array.isArray(out.components)) out.components = out.components.map(walk);
    return out;
  };
  return clone(nodes).map(walk);
}

export interface Built {
  components: Json[];
  /** Rules scoped to this instance (renamed `#id`s), tagged with the instance. */
  scoped: Json[];
  /** Class/tag rules of the master (and of nested masters), tagged with it. */
  shared: Json[];
}

/**
 * Builds the content of an instance of `master` with the key `key` (the
 * instance's own id). Rules of the master that target its content by id are
 * copied with the renamed ids; rules by class or tag are shared by all the
 * instances of the master; rules about anything else (the body, the
 * wrapper) are left out.
 */
export function buildInstance(master: Master, key: string, lib: Library, seen: Set<string> = new Set()): Built {
  const map: Record<string, string> = {};
  const nested: Json[] = [];
  const components = copyContent(master.components, key, map, nested);
  const scoped: Json[] = [];
  const shared: Json[] = [];
  master.styles.forEach((rule) => {
    if (!rule || typeof rule !== 'object') return;
    const names = selectorNames(rule);
    const add = String(rule.selectorsAdd || '');
    const ids = [...names.flatMap(idsIn), ...idsIn(add)];
    if (!names.length && !add) return;
    if (/(^|[\s,>+~])(body|html)\b|#wrapper\b/.test(add) || names.includes('#wrapper')) return;
    if (ids.length) {
      if (!ids.every((id) => map[id])) return; // targets something outside the content
      const r = clone(rule);
      r.selectors = (r.selectors || []).map((s: unknown) => (typeof s === 'string' ? renameIds(s, map) : { ...(s as Json), name: map[(s as Json).name] || (s as Json).name }));
      if (r.selectorsAdd) r.selectorsAdd = renameIds(r.selectorsAdd, map);
      r[RULE_TAG] = master.id;
      r[RULE_INSTANCE] = key;
      scoped.push(r);
    } else {
      shared.push({ ...clone(rule), [RULE_TAG]: master.id });
    }
  });
  // Nested instances: their content and rules, with a cycle guard.
  const inner = new Set(seen).add(master.id);
  nested.forEach((n) => {
    const target = instanceTarget(n);
    const m = target ? lib.get(target) : undefined;
    const nkey = n.attributes?.id || `${key}-n`;
    if (!m || inner.has(m.id)) {
      n.components = [];
      return;
    }
    const b = buildInstance(m, nkey, lib, inner);
    n.name = m.name;
    n.components = b.components;
    scoped.push(...b.scoped);
    shared.push(...b.shared);
  });
  return { components, scoped, shared };
}

/** Removes the lock and the instance marks from a node tree (in place). */
export function unlock(j: Json): Json {
  if (!j || typeof j !== 'object') return j;
  LOCK_KEYS.forEach((k) => delete j[k]);
  if (Array.isArray(j.components)) j.components.forEach(unlock);
  return j;
}

/**
 * An instance as a plain copy: an ordinary `div` (or its tag) with the
 * same content, unlocked. Nested instances stay linked.
 */
export function detachJson(inst: Json): Json {
  const out = clone(inst);
  delete out.type;
  delete out.name;
  if (out.attributes) {
    const { [INSTANCE_ATTR]: _drop, ...rest } = out.attributes;
    void _drop;
    out.attributes = rest;
  }
  LOCK_KEYS.forEach((k) => delete out[k]);
  delete out.droppable;
  delete out.editable;
  const walk = (j: Json): void => {
    if (!j || typeof j !== 'object') return;
    if (isInstance(j)) {
      LOCK_KEYS.forEach((k) => delete j[k]);
      return; // still a linked instance, now directly on the page
    }
    unlock(j);
    if (Array.isArray(j.components)) j.components.forEach(walk);
  };
  (out.components || []).forEach(walk);
  return out;
}

export interface ExpandResult {
  data: ProjectData;
  /** Ids of the components used on the page. */
  used: string[];
  changed: boolean;
}

/**
 * Brings every instance of a project up to date with its component: the
 * content is rebuilt from the master, the rules the components contributed
 * last time are dropped and generated again (a component's rule replaces a
 * page rule with the same selector). An instance whose component is gone
 * becomes a plain copy. `self` is the component being edited: an instance
 * of it inside itself is emptied.
 */
export function expandProject(data: ProjectData, lib: Library, self?: string): ExpandResult {
  const out = clone(data) as Json;
  const wrapper = wrapperOf(out as ProjectData);
  const used = new Set<string>();
  if (!wrapper) return { data, used: [], changed: false };
  const scoped: Json[] = [];
  const shared: Json[] = [];
  const seenMasters = new Set<string>();
  const seen = new Set<string>(self ? [self] : []);

  const walk = (nodes: Json[]): Json[] =>
    nodes.map((j) => {
      if (!j || typeof j !== 'object') return j;
      if (isInstance(j)) {
        const target = instanceTarget(j);
        const m = target ? lib.get(target) : undefined;
        if (!m) return detachJson(j); // the component was deleted
        if (seen.has(m.id)) return { ...j, components: [] };
        used.add(m.id);
        const key = j.attributes?.id || target!;
        const b = buildInstance(m, key, lib, seen);
        scoped.push(...b.scoped);
        if (!seenMasters.has(m.id)) shared.push(...b.shared);
        b.shared.forEach((r) => seenMasters.add(r[RULE_TAG]));
        seenMasters.add(m.id);
        return {
          ...j,
          name: m.name,
          attributes: { ...j.attributes, id: key },
          components: b.components,
        };
      }
      if (Array.isArray(j.components)) return { ...j, components: walk(j.components) };
      return j;
    });

  const before = JSON.stringify(out);
  wrapper.components = Array.isArray(wrapper.components) ? walk(wrapper.components) : wrapper.components;
  if (Array.isArray(out.styles)) {
    // Shared rules once per key (a nested master may repeat them).
    const sharedByKey = new Map<string, Json>();
    shared.forEach((r) => sharedByKey.set(ruleKey(r), r));
    const own = (out.styles as Json[]).filter((r) => !(r && r[RULE_TAG]) && !sharedByKey.has(ruleKey(r)));
    out.styles = [...own, ...sharedByKey.values(), ...scoped];
  }
  return { data: out as ProjectData, used: [...used], changed: JSON.stringify(out) !== before };
}
