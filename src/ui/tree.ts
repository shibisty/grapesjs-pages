import type { PageRecord } from '../types';

/** Where a dragged page goes relative to the page it is dropped on. */
export type DropWhere = 'before' | 'inside' | 'after';

/** A page's new place: what `update(id, { parentId, position })` gets. */
export interface TreeMove {
  id: string;
  parentId: string | null;
  position: number;
}

export interface TreeRow {
  rec: PageRecord;
  depth: number;
  /** Has children (shown or not). */
  parent: boolean;
}

/** Sibling order: position, then the home page, then the name. */
export const siblingOrder = (a: PageRecord, b: PageRecord): number =>
  (a.position ?? 0) - (b.position ?? 0) || (a.slug === '/' ? -1 : b.slug === '/' ? 1 : 0) || a.name.localeCompare(b.name);

/** A page's parent, when that parent is among the pages (else top level). */
const parentOf = (p: PageRecord, ids: Set<string>): string | null =>
  p.parentId && ids.has(p.parentId) && p.parentId !== p.id ? p.parentId : null;

function childrenMap(pages: PageRecord[]): Map<string | null, PageRecord[]> {
  const ids = new Set(pages.map((p) => p.id));
  const kids = new Map<string | null, PageRecord[]>();
  pages.forEach((p) => {
    const parent = parentOf(p, ids);
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent)!.push(p);
  });
  kids.forEach((list) => list.sort(siblingOrder));
  return kids;
}

/**
 * Pages in tree order (parent before children, siblings by position, the
 * home page, name) with their depth. Children of `collapsed` pages are
 * left out; pages caught in a parent cycle come last, at the top level.
 */
export function pageTree(pages: PageRecord[], collapsed: ReadonlySet<string> = new Set()): TreeRow[] {
  const kids = childrenMap(pages);
  const out: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number, hidden: boolean): void => {
    (kids.get(parent) || []).forEach((p) => {
      if (seen.has(p.id)) return; // a cycle
      seen.add(p.id);
      if (!hidden) out.push({ rec: p, depth, parent: (kids.get(p.id) || []).length > 0 });
      walk(p.id, depth + 1, hidden || collapsed.has(p.id));
    });
  };
  walk(null, 0, false);
  pages.filter((p) => !seen.has(p.id)).forEach((p) => out.push({ rec: p, depth: 0, parent: false }));
  return out;
}

/** The page and every page below it. */
export function subtree(pages: PageRecord[], id: string): Set<string> {
  const kids = childrenMap(pages);
  const out = new Set<string>([id]);
  const walk = (pid: string): void =>
    (kids.get(pid) || []).forEach((p) => {
      if (out.has(p.id)) return;
      out.add(p.id);
      walk(p.id);
    });
  walk(id);
  return out;
}

/**
 * Moves page `id` before, after or inside `targetId` and returns what has
 * to change: the moved page's parent and the positions of its new
 * siblings (renumbered 0, 1, 2… in their new order; only the pages whose
 * parent or position actually changes). Empty when the move is not
 * possible (onto itself, into its own subtree, an unknown page).
 */
export function moveInTree(pages: PageRecord[], id: string, targetId: string, where: DropWhere): TreeMove[] {
  const ids = new Set(pages.map((p) => p.id));
  const moving = pages.find((p) => p.id === id);
  const target = pages.find((p) => p.id === targetId);
  if (!moving || !target || id === targetId || subtree(pages, id).has(targetId)) return [];
  const parent = where === 'inside' ? targetId : parentOf(target, ids);
  const siblings = (childrenMap(pages).get(parent) || []).filter((p) => p.id !== id);
  let at = siblings.length;
  if (where !== 'inside') {
    const i = siblings.findIndex((p) => p.id === targetId);
    at = where === 'before' ? i : i + 1;
  }
  siblings.splice(at, 0, moving);
  const changes: TreeMove[] = [];
  siblings.forEach((p, position) => {
    const was = parentOf(p, ids);
    const parentId = p.id === id ? parent : was;
    if (parentId !== was || (p.position ?? 0) !== position) changes.push({ id: p.id, parentId, position });
  });
  return changes;
}

/**
 * The keyboard moves of a page row: Alt+↑/↓ swap with the previous/next
 * sibling, Alt+→ makes it the last child of the previous sibling, Alt+←
 * puts it after its parent. Null when there is nowhere to go.
 */
export function keyboardMove(pages: PageRecord[], id: string, key: 'up' | 'down' | 'in' | 'out'): { targetId: string; where: DropWhere } | null {
  const ids = new Set(pages.map((p) => p.id));
  const me = pages.find((p) => p.id === id);
  if (!me) return null;
  const parent = parentOf(me, ids);
  const siblings = childrenMap(pages).get(parent) || [];
  const i = siblings.findIndex((p) => p.id === id);
  switch (key) {
    case 'up':
      return i > 0 ? { targetId: siblings[i - 1].id, where: 'before' } : null;
    case 'down':
      return i < siblings.length - 1 ? { targetId: siblings[i + 1].id, where: 'after' } : null;
    case 'in':
      return i > 0 ? { targetId: siblings[i - 1].id, where: 'inside' } : null;
    case 'out':
      return parent ? { targetId: parent, where: 'after' } : null;
  }
}

/** Lower case without diacritics, for searching. */
export const fold = (s: string): string =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Does the record match a search (name or slug, any part, any case)? */
export const matches = (r: PageRecord, query: string): boolean => {
  const q = fold(query.trim());
  return !q || fold(r.name).includes(q) || fold(r.slug || '').includes(q);
};

/**
 * The pages a search shows: the matches and their ancestors (so a match
 * keeps its place in the tree). Null when there is no query.
 */
export function searchTree(pages: PageRecord[], query: string): Set<string> | null {
  if (!query.trim()) return null;
  const byId = new Map(pages.map((p) => [p.id, p]));
  const out = new Set<string>();
  pages.forEach((p) => {
    if (!matches(p, query)) return;
    let cur: PageRecord | undefined = p;
    const guard = new Set<string>();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      out.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  });
  return out;
}
