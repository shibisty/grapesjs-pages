import { describe, expect, it } from 'vitest';
import { SnapshotHistory } from '../src/core/SnapshotHistory';

describe('SnapshotHistory', () => {
  it('push/step/canUndo/canRedo', () => {
    const h = new SnapshotHistory('0');
    expect(h.canUndo()).toBe(false);
    expect(h.push('0')).toBe(false); // unchanged
    expect(h.push('1')).toBe(true);
    h.push('2');
    expect(h.step(-1)).toBe('1');
    expect(h.canRedo()).toBe(true);
    expect(h.step(-1)).toBe('0');
    expect(h.step(-1)).toBeNull();
    expect(h.step(1)).toBe('1');
    h.push('x'); // drops '2'
    expect(h.canRedo()).toBe(false);
    expect(h.size).toBe(3);
  });

  it('caps the stack at the limit', () => {
    const h = new SnapshotHistory('0', 3);
    ['1', '2', '3', '4'].forEach((s) => h.push(s));
    expect(h.size).toBe(3);
    expect(h.current).toBe('4');
    expect(h.step(-1)).toBe('3');
    expect(h.step(-1)).toBe('2');
    expect(h.step(-1)).toBeNull();
  });

  it('replaceCurrent swaps the snapshot in place', () => {
    const h = new SnapshotHistory('a');
    h.replaceCurrent('A');
    expect(h.current).toBe('A');
    expect(h.push('A')).toBe(false);
  });
});
