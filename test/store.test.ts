import { describe, expect, it } from 'vitest';
import { IndexedDbPageStore } from '../src/store/IndexedDbPageStore';
import { MemoryPageStore } from '../src/store/MemoryPageStore';
import type { PageStore } from '../src/store/types';
import type { PageRecord } from '../src/types';

let n = 0;
const dbName = () => `test-db-${++n}-${Date.now()}`;
const rec = (id: string): PageRecord => ({
  id,
  name: id,
  data: { pages: [] } as any,
  createdAt: 1,
  updatedAt: 1,
  dirty: true,
  deleted: false,
  remote: null,
});

const contract = (name: string, make: () => PageStore) =>
  describe(`${name} (PageStore contract)`, () => {
    it('put/get/all/delete', async () => {
      const s = make();
      await s.put(rec('a'));
      await s.put(rec('b'));
      expect((await s.get('a'))!.name).toBe('a');
      expect((await s.all()).map((r) => r.id).sort()).toEqual(['a', 'b']);
      await s.put({ ...rec('a'), name: 'A2' });
      expect((await s.get('a'))!.name).toBe('A2');
      await s.delete('a');
      expect(await s.get('a')).toBeUndefined();
      expect(await s.get('nope')).toBeUndefined();
    });

    it('meta values round-trip', async () => {
      const s = make();
      expect(await s.getMeta('x')).toBeUndefined();
      await s.setMeta('x', { url: 'u', token: 't' });
      expect(await s.getMeta('x')).toEqual({ url: 'u', token: 't' });
      await s.setMeta('n', 5);
      expect(await s.getMeta('n')).toBe(5);
    });

    it('returned records are copies', async () => {
      const s = make();
      await s.put(rec('a'));
      const r = (await s.get('a'))!;
      r.name = 'mutated';
      expect((await s.get('a'))!.name).toBe('a');
    });
  });

contract('MemoryPageStore', () => new MemoryPageStore());
contract('IndexedDbPageStore', () => new IndexedDbPageStore(dbName()));

describe('IndexedDbPageStore', () => {
  it('reads a database created by the old gjs-pages-manager.js', async () => {
    const name = dbName();
    // Exactly what the original plugin did.
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('pages', { keyPath: 'id' });
        r.result.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => {
        const db = r.result;
        const t = db.transaction(['pages', 'meta'], 'readwrite');
        t.objectStore('pages').put(rec('legacy'));
        t.objectStore('meta').put({ key: 'active', value: 'legacy' });
        t.oncomplete = () => {
          db.close();
          resolve();
        };
        t.onerror = () => reject(t.error);
      };
      r.onerror = () => reject(r.error);
    });
    const s = new IndexedDbPageStore(name);
    expect((await s.get('legacy'))!.name).toBe('legacy');
    expect(await s.getMeta('active')).toBe('legacy');
    s.close();
  });

  it('defaults to the original database name', () => {
    expect(new IndexedDbPageStore().dbName).toBe('gjs-pages-manager');
  });

  it('rejects clearly without IndexedDB', async () => {
    const s = new IndexedDbPageStore('x', null as unknown as undefined);
    await expect(s.all()).rejects.toThrow('IndexedDB is not available');
  });

  it('survives close() and reopens lazily', async () => {
    const s = new IndexedDbPageStore(dbName());
    await s.put(rec('a'));
    s.close();
    expect((await s.get('a'))!.id).toBe('a');
  });
});
