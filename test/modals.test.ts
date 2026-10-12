import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'grapesjs';
import { COMMANDS } from '../src/events';
import { click, createEditor, destroyEditor, settle, sidebar, tick, type Setup } from './helpers/editor';
import { FakeServer } from './helpers/fakeServer';

let editor: Editor | undefined;
let server: FakeServer;
beforeEach(() => {
  server = new FakeServer();
  vi.stubGlobal('fetch', server.fetch);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await destroyEditor(editor);
  editor = undefined;
});

const modal = () => document.querySelector<HTMLElement>('.gjs-mdl-container')!;
const modalOpen = (ed: Editor) => ed.Modal.isOpen();
const input = (name: string) => document.querySelector<HTMLInputElement>(`.gjsp-settings input[name="${name}"]`)!;
const role = (r: string) => document.querySelector<HTMLButtonElement>(`[data-role="${r}"]`)!;
const until = async (fn: () => boolean, ms = 500) => {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await tick(5);
};

async function setup(url = ''): Promise<Setup> {
  const s = await createEditor({ plugin: { serverUrl: url } });
  editor = s.editor;
  return s;
}

describe('settings dialog', () => {
  it('opens from the sync button when no server is configured', async () => {
    const s = await setup();
    click(sidebar().querySelectorAll('.gjsp-head .gjsp-btn')[3]);
    await tick();
    expect(modalOpen(s.editor)).toBe(true);
    expect(modal().querySelector('.gjsp-settings')).toBeTruthy();
  });

  it('"Test" checks the connection without saving', async () => {
    const s = await setup();
    server.seed('a', 'A', {} as any);
    s.editor.runCommand(COMMANDS.settings);
    input('url').value = server.base + '/';
    click(role('test'));
    const msg = () => document.querySelector('.gjsp-settings .gjsp-msg')!;
    await until(() => msg().textContent!.startsWith('Connected'));
    expect(msg().textContent).toBe('Connected, pages on the server: 1');
    expect(s.api.getSettings().url).toBe('');

    input('url').value = 'https://wrong.test';
    click(role('test'));
    await until(() => msg().classList.contains('gjsp-err'));
    expect(msg().textContent).toContain('Connection error');
  });

  it('"Save" stores the settings and closes', async () => {
    const s = await setup();
    s.editor.runCommand(COMMANDS.settings);
    input('url').value = server.base;
    input('token').value = 'secret';
    click(role('save'));
    await until(() => !modalOpen(s.editor));
    expect(s.api.getSettings()).toEqual({ url: server.base, token: 'secret' });
  });
});

describe('sync dialog', () => {
  it('shows the plan and applies it', async () => {
    const s = await setup(server.base);
    server.seed('r1', 'Remote one', { pages: [] } as any);
    await s.api.sync();
    const rows = [...document.querySelectorAll<HTMLElement>('.gjsp-sync tr')];
    expect(rows.map((r) => r.dataset.kind)).toEqual(['push', 'pull']);
    expect(rows[0].textContent).toContain('Upload to server');
    expect(rows[1].textContent).toContain('Remote one');
    click(role('apply'));
    await until(() => !!document.querySelector('.gjsp-sync .gjsp-msg')!.textContent);
    expect(document.querySelector('.gjsp-sync .gjsp-msg')!.textContent).toBe('Done: 2');
    expect(server.pages.size).toBe(2);
    expect(await s.store.get('r1')).toBeTruthy();
  });

  it('unchecked rows are skipped', async () => {
    const s = await setup(server.base);
    await s.api.sync();
    const box = document.querySelector<HTMLInputElement>('.gjsp-sync input[type=checkbox]')!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    click(role('apply'));
    await until(() => !!document.querySelector('.gjsp-sync .gjsp-msg')!.textContent);
    expect(server.pages.size).toBe(0);
  });

  it('conflict rows offer a choice', async () => {
    const s = await setup(server.base);
    await s.api.syncService.apply(await s.api.syncService.plan());
    const id = s.api.getActiveId()!;
    server.touch(id);
    s.editor.getWrapper()!.append('<p>mine</p>');
    await settle(s.api);
    await s.api.sync();
    const select = document.querySelector<HTMLSelectElement>('.gjsp-sync select')!;
    expect([...select.options].map((o) => o.value)).toEqual(['local', 'remote', 'both']);
    expect(document.querySelector('.gjsp-sync tr')!.textContent).toContain('⚠ Conflict');
    select.value = 'both';
    select.dispatchEvent(new Event('change'));
    click(role('apply'));
    await until(() => !!document.querySelector('.gjsp-sync .gjsp-msg')!.textContent);
    expect((await s.api.list()).map((r) => r.name)).toEqual(['Page 1', 'Page 1 (server)']);
  });

  it('nothing to do', async () => {
    const s = await setup(server.base);
    await s.api.syncService.apply(await s.api.syncService.plan());
    await s.api.sync();
    expect(document.querySelector('.gjsp-sync')!.textContent).toContain('Everything is in sync');
  });

  it('shows errors of the listing request', async () => {
    const s = await setup(server.base);
    server.failWith = 500;
    await s.api.sync();
    expect(document.querySelector('.gjsp-sync .gjsp-err')!.textContent).toBe('Sync failed: GET /pages: HTTP 500');
  });

  it('shows per-item errors and keeps the dialog open', async () => {
    const s = await setup(server.base);
    await s.api.sync();
    server.failWith = 503;
    click(role('apply'));
    await until(() => !!document.querySelector('.gjsp-sync .gjsp-err'));
    expect(document.querySelector('.gjsp-sync')!.textContent).toContain('Errors:');
    await tick(950);
    expect(modalOpen(s.editor)).toBe(true);
  });
});
