import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/sync/plan';
import type { PageRecord } from '../src/types';

const rec = (id: string, p: Partial<PageRecord> = {}): PageRecord => ({
  id,
  name: id.toUpperCase(),
  data: {} as any,
  createdAt: 1,
  updatedAt: 1,
  dirty: false,
  deleted: false,
  remote: null,
  ...p,
});
const meta = (id: string, version: number | string, name = id.toUpperCase()) => ({ id, name, version });
const kinds = (plan: ReturnType<typeof buildPlan>) => Object.fromEntries(plan.map((p) => [p.id, p.kind]));

describe('buildPlan', () => {
  it('covers every combination of local/remote state', () => {
    const plan = buildPlan(
      [
        rec('new', { dirty: true }), // never synced → push
        rec('edited', { dirty: true, remote: { version: 1 } }), // push
        rec('clean', { remote: { version: 1 } }), // same
        rec('srvchanged', { remote: { version: 1 } }), // pull
        rec('both', { dirty: true, remote: { version: 1 } }), // conflict
        rec('gone', { remote: { version: 1 } }), // missing on server → push again
        rec('tomb', { deleted: true, remote: { version: 1 } }), // del
        rec('tombgone', { deleted: true, remote: { version: 1 } }), // purge
        rec('tombchanged', { deleted: true, remote: { version: 1 } }), // restored → pull
      ],
      [
        meta('edited', 1),
        meta('clean', 1),
        meta('srvchanged', 2, 'Renamed on server'),
        meta('both', 2),
        meta('tomb', 1),
        meta('tombchanged', 5),
        meta('onlyremote', 1),
      ]
    );
    expect(kinds(plan)).toEqual({
      new: 'push',
      edited: 'push',
      clean: 'same',
      srvchanged: 'pull',
      both: 'conflict',
      gone: 'push',
      tomb: 'del',
      tombgone: 'purge',
      tombchanged: 'pull',
      onlyremote: 'pull',
    });
    const by = Object.fromEntries(plan.map((p) => [p.id, p]));
    expect(by.gone.note).toBe('missingOnServer');
    expect(by.new.note).toBeUndefined();
    expect(by.tombchanged.note).toBe('restored');
    expect(by.srvchanged.name).toBe('Renamed on server');
    expect(by.onlyremote.local).toBeNull();
  });

  it('sorts conflicts first, then push, pull, del, purge, same', () => {
    const plan = buildPlan(
      [
        rec('s', { remote: { version: 1 } }),
        rec('p', { dirty: true }),
        rec('c', { dirty: true, remote: { version: 1 } }),
        rec('d', { deleted: true, remote: { version: 1 } }),
      ],
      [meta('s', 1), meta('c', 2), meta('d', 1), meta('l', 1)]
    );
    expect(plan.map((p) => p.kind)).toEqual(['conflict', 'push', 'pull', 'del', 'same']);
  });

  it('compares versions as strings (1 == "1")', () => {
    const plan = buildPlan([rec('a', { remote: { version: 1 } })], [meta('a', '1')]);
    expect(plan[0].kind).toBe('same');
  });
});
