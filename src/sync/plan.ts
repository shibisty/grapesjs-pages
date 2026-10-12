import type { PageRecord } from '../types';
import type { RemotePageMeta } from './RestClient';

/**
 * - `push`     — local changes, upload (with `If-Match`)
 * - `pull`     — server changes (or a page only the server has), download
 * - `conflict` — changed on both sides, the user picks a `ConflictChoice`
 * - `del`      — deleted locally, delete on the server
 * - `purge`    — deleted locally and already gone on the server: drop the tombstone
 * - `same`     — nothing to do
 */
export type SyncKind = 'push' | 'pull' | 'conflict' | 'del' | 'purge' | 'same';

export type ConflictChoice = 'local' | 'remote' | 'both';

export interface SyncPlanItem {
  id: string;
  name: string;
  kind: SyncKind;
  local: PageRecord | null;
  remote: RemotePageMeta | undefined;
  /** Why the item is there when it is not obvious (see `notes`). */
  note?: 'missingOnServer' | 'restored';
  /** Selected in the dialog. */
  enabled?: boolean;
  /** For `conflict` only. */
  choice?: ConflictChoice;
}

const ORDER: Record<SyncKind, number> = { conflict: 0, push: 1, pull: 2, del: 3, purge: 4, same: 5 };

/**
 * Pure three-way decision for every page, based on the version the page had
 * when it was last synced (`local.remote.version`) vs. the server's current
 * version, and on the local `dirty` flag. Conflicts first.
 */
export function buildPlan(locals: PageRecord[], listing: RemotePageMeta[]): SyncPlanItem[] {
  const remote = new Map(listing.map((r) => [r.id, r]));
  const known = new Set(locals.map((l) => l.id));
  const plan: SyncPlanItem[] = [];

  locals.forEach((l) => {
    const r = remote.get(l.id);
    const remoteChanged = !!r && (!l.remote || String(l.remote.version) !== String(r.version));
    const base = { id: l.id, name: l.name, local: l, remote: r };
    if (l.deleted) {
      if (!r) plan.push({ ...base, kind: 'purge' });
      else if (remoteChanged) plan.push({ ...base, kind: 'pull', name: r.name, note: 'restored' });
      else plan.push({ ...base, kind: 'del' });
    } else if (!r) {
      plan.push({ ...base, kind: 'push', note: l.remote ? 'missingOnServer' : undefined });
    } else if (remoteChanged && l.dirty) {
      plan.push({ ...base, kind: 'conflict' });
    } else if (remoteChanged) {
      plan.push({ ...base, kind: 'pull', name: r.name });
    } else if (l.dirty) {
      plan.push({ ...base, kind: 'push' });
    } else {
      plan.push({ ...base, kind: 'same' });
    }
  });
  listing.forEach((r) => {
    if (!known.has(r.id)) plan.push({ id: r.id, name: r.name, kind: 'pull', local: null, remote: r });
  });
  return plan.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}
