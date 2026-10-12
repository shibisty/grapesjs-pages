import { describe, expect, it, vi } from 'vitest';
import { HttpError, RestClient } from '../src/sync/RestClient';
import type { ServerSettings } from '../src/types';

const make = (settings: ServerSettings, fetchImpl: any, headers?: () => Record<string, string>) =>
  new RestClient({
    getSettings: () => settings,
    headers,
    messages: { noServer: () => 'NO SERVER', conflict: () => 'CONFLICT' },
    fetch: fetchImpl,
  });

const ok = (body: unknown, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status });

describe('RestClient', () => {
  it('throws the noServer message without a URL', async () => {
    const f = vi.fn();
    await expect(make({ url: '', token: '' }, f).listPages()).rejects.toThrow('NO SERVER');
    expect(f).not.toHaveBeenCalled();
  });

  it('sends auth, custom headers and JSON body', async () => {
    const f = vi.fn(async () => ok({ id: 'a', name: 'A', version: 2 }));
    const c = make({ url: 'https://x.test/api/', token: 'T' }, f, () => ({ 'X-Site': '7' }));
    await c.putPage({ id: 'a b', name: 'A', data: { pages: [] } as any, createdAt: 1, updatedAt: 5, dirty: true, deleted: false, remote: null }, 1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.test/api/pages/a%20b');
    expect(init.method).toBe('PUT');
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer T',
      'X-Site': '7',
      'If-Match': '"1"',
    });
    expect(JSON.parse(String(init.body))).toEqual({ id: 'a b', name: 'A', data: { pages: [] }, updatedAt: 5 });
  });

  it('omits If-Match when forced', async () => {
    const f = vi.fn(async () => ok({ id: 'a', name: 'A', version: 2 }));
    await make({ url: 'https://x.test', token: '' }, f).putPage({ id: 'a' } as any, null);
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['If-Match']).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('accepts both list shapes', async () => {
    const list = [{ id: 'a', name: 'A', version: 1 }];
    expect(await make({ url: 'https://x', token: '' }, async () => ok(list)).listPages()).toEqual(list);
    expect(await make({ url: 'https://x', token: '' }, async () => ok({ items: list })).listPages()).toEqual(list);
    expect(await make({ url: 'https://x', token: '' }, async () => ok({})).listPages()).toEqual([]);
  });

  it('maps 412/409 to a conflict HttpError, other codes to a generic one', async () => {
    const e412 = await make({ url: 'https://x', token: '' }, async () => ok(null, 412)).getPage('a').catch((e) => e);
    expect(e412).toBeInstanceOf(HttpError);
    expect(e412.message).toBe('CONFLICT');
    expect(e412.isConflict).toBe(true);
    const e500 = await make({ url: 'https://x', token: '' }, async () => ok(null, 500)).getPage('a').catch((e) => e);
    expect(e500.message).toBe('GET /pages/a: HTTP 500');
    expect(e500.status).toBe(500);
    expect(e500.isConflict).toBe(false);
  });

  it('handles 204 and empty bodies', async () => {
    const c = make({ url: 'https://x', token: '' }, async () => new Response(null, { status: 204 }));
    await expect(c.deletePage('a', 3)).resolves.toBeUndefined();
  });

  it('uses explicit settings for a connection test', async () => {
    const f = vi.fn(async () => ok([]));
    await make({ url: 'https://saved', token: '' }, f).listPages({ url: 'https://other', token: 'Q' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://other/pages');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer Q');
  });
});
