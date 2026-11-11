import { afterAll, describe, expect, it } from 'vitest';
import type { Editor } from 'grapesjs';
import { MemoryPageStore } from '../src/store/MemoryPageStore';
import type { PagesManagerApi } from '../src/types';
import { uuid } from '../src/utils';
import { createEditor, destroyEditor, tick } from './helpers/editor';

/**
 * End to end against a real contract v2 server (openapi.v2.yaml), e.g.
 * luna-pages:
 *
 *   GJSP_E2E_URL=http://127.0.0.1:8082/v1/editor \
 *   GJSP_E2E_HEADERS='{"X-API-Key":"sk_live_…"}' npx vitest run test/e2e.test.ts
 *
 * Skipped without GJSP_E2E_URL. It creates its own records and deletes them.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env || {};
const URL_ = env.GJSP_E2E_URL || '';
const HEADERS: Record<string, string> = env.GJSP_E2E_HEADERS ? JSON.parse(env.GJSP_E2E_HEADERS) : {};

const raw = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
  const res = await fetch(URL_ + path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...HEADERS, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

const until = async (fn: () => boolean | Promise<boolean>, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await tick(20);
  }
};

describe.skipIf(!URL_)('e2e: a real contract v2 server', () => {
  let editor: Editor | undefined;
  let api: PagesManagerApi;
  const made: Array<[string, string]> = [];
  const run = () => (api.store as any).run();

  afterAll(async () => {
    await destroyEditor(editor);
    for (const [coll, id] of made.reverse()) await raw('DELETE', `/${coll}/${id}`);
  });

  it('works through the editor: layout, page, properties, publish, revisions, conflicts', async () => {
    const s = await createEditor({
      html: '<p>e2e</p>',
      css: '',
      plugin: { remote: { url: URL_, headers: () => HEADERS, cache: new MemoryPageStore(), refreshInterval: 0, retryDelay: 20 } },
    });
    editor = s.editor;
    api = s.api;
    const tag = uuid().slice(0, 8);

    // A layout with the slot.
    const layout = await api.create({ kind: 'layout', name: `E2E layout ${tag}` });
    made.push(['layouts', layout.id]);
    s.editor.getWrapper()!.components(`<header>E2E ${tag}</header><page-slot></page-slot><footer>end</footer>`);
    const lrec = await api.publish();
    expect(lrec.kind).toBe('layout');

    // A page in it.
    const page = await api.create({ name: `E2E page ${tag}`, kind: 'page' });
    made.push(['pages', page.id]);
    s.editor.getWrapper()!.components(`<h1 class="e2e">Hello ${tag}</h1><script>alert(1)</script>`);
    s.editor.Css.setRule('.e2e', { color: 'teal' });
    await api.update(page.id, { slug: `/e2e/${tag}`, layoutId: layout.id, values: { 'seo.title': `E2E ${tag}`, in_menu: true } });
    await api.flush();
    await run();
    const onServer = await raw('GET', `/pages/${page.id}`);
    expect(onServer.status).toBe(200);
    expect(onServer.json).toMatchObject({ slug: `/e2e/${tag}`, layout_id: layout.id, values: { 'seo.title': `E2E ${tag}`, in_menu: true } });
    expect(JSON.stringify(onServer.json.data)).toContain(`Hello ${tag}`);

    const published = await api.publish();
    expect(published.status).toBe('published');

    // Edit, publish again: two revisions; restore the first into the draft.
    s.editor.getWrapper()!.components(`<h1 class="e2e">Second ${tag}</h1>`);
    await api.publish();
    const revs = await api.revisions(page.id);
    expect(revs.map((r) => r.live)).toEqual([true, false]);
    await api.restore(page.id, revs[1].revision);
    expect(s.editor.getHtml()).toContain(`Hello ${tag}`);

    // Somebody else changes the page: our next save is a conflict; we take theirs.
    const cur = await raw('GET', `/pages/${page.id}`);
    const theirs = await raw(
      'PUT',
      `/pages/${page.id}`,
      { name: cur.json.name, data: { pages: [{ component: `<p>theirs ${tag}</p>` }] } },
      { 'If-Match': `"${cur.json.version}"` }
    );
    expect(theirs.status).toBe(200);
    s.editor.getWrapper()!.append('<p>mine</p>');
    await api.flush();
    await run();
    await until(async () => !!(await api.store.get(page.id))?.conflict);
    await api.resolve(page.id, 'remote');
    await until(() => s.editor.getHtml().includes(`theirs ${tag}`));

    // And a refresh brings in a clean remote change.
    const v = (await raw('GET', `/layouts/${layout.id}`)).json.version;
    await raw('PUT', `/layouts/${layout.id}`, { name: `E2E layout ${tag} (renamed)` }, { 'If-Match': `"${v}"` });
    await api.refresh();
    expect((await api.store.get(layout.id))!.name).toBe(`E2E layout ${tag} (renamed)`);
  }, 30_000);
});
