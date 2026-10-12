import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYS, DEFAULT_OPTIONS, resolveOptions } from '../src/options';
import { clone, escapeRegExp, fmt, normalizeUrl, uid } from '../src/utils';

describe('resolveOptions', () => {
  it('returns the defaults', () => {
    expect(resolveOptions()).toEqual(DEFAULT_OPTIONS);
    expect(resolveOptions(undefined as any).dbName).toBe('gjs-pages-manager');
  });

  it('merges keys and drops invalid values', () => {
    const o = resolveOptions({
      keys: { undo: 'alt+z', redo: '' },
      autosaveDelay: -1,
      historyLimit: 0,
      settleMs: NaN,
      headers: 'nope' as any,
      takeOverCopyPaste: false,
      labels: { pages: 'P' },
    });
    expect(o.keys).toEqual({ ...DEFAULT_KEYS, undo: 'alt+z' });
    expect(o.autosaveDelay).toBe(DEFAULT_OPTIONS.autosaveDelay);
    expect(o.historyLimit).toBe(DEFAULT_OPTIONS.historyLimit);
    expect(o.settleMs).toBe(DEFAULT_OPTIONS.settleMs);
    expect(o.headers).toBeNull();
    expect(o.takeOverCopyPaste).toBe(false);
    expect(o.labels).toEqual({ pages: 'P' });
  });

  it('does not share the labels object with the caller', () => {
    const labels = { pages: 'P' };
    expect(resolveOptions({ labels }).labels).not.toBe(labels);
  });
});

describe('utils', () => {
  it('fmt fills %s in order', () => {
    expect(fmt('%s of %s', 1, 'two')).toBe('1 of two');
    expect(fmt('no args')).toBe('no args');
  });
  it('normalizeUrl', () => {
    expect(normalizeUrl(' https://a/b/// ')).toBe('https://a/b');
    expect(normalizeUrl(undefined)).toBe('');
  });
  it('escapeRegExp', () => {
    expect(new RegExp(escapeRegExp('a.b*c')).test('a.b*c')).toBe(true);
    expect(new RegExp(escapeRegExp('a.b')).test('axb')).toBe(false);
  });
  it('uid is unique and prefixed', () => {
    const a = uid('p');
    expect(a.startsWith('p')).toBe(true);
    expect(uid()).not.toBe(uid());
  });
  it('clone is deep', () => {
    const o = { a: { b: 1 } };
    const c = clone(o);
    c.a.b = 2;
    expect(o.a.b).toBe(1);
  });
});
