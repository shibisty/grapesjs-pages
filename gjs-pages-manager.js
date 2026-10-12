/**
 * gjs-pages-manager — плагин GrapesJS (>= 0.21)
 *
 * Возможности:
 *  1. Боковая панель «Страницы»: список сохранённых шаблонов в IndexedDB,
 *     создание / переименование / дублирование / удаление / переключение.
 *  2. Автосохранение активной страницы в IndexedDB (дебаунс).
 *  3. Ctrl+Z / Ctrl+Y (и Ctrl+Shift+Z) — история снимков отдельно для каждой страницы.
 *  4. Ctrl+C / Ctrl+V — копирование целых компонентов (вместе со стилями) между страницами.
 *     Нативные команды core:copy / core:paste не изменяются, заменяются только
 *     горячие клавиши (см. опцию takeOverCopyPaste).
 *  5. Ручная синхронизация с сервером по REST (см. openapi.yaml): клиент получает
 *     список страниц с сервера, строит план (отправить / скачать / конфликт) и применяет его.
 *
 * Подключение:
 *   grapesjs.init({
 *     container: '#gjs',
 *     storageManager: false,               // хранением занимается плагин
 *     plugins: [gjsPagesManager],          // или ['gjs-pages-manager'] при подключении через <script>
 *     pluginsOpts: { [gjsPagesManager]: { serverUrl: 'https://host/api/v1' } },
 *   });
 *
 * API: editor.PagesManager  (list, open, create, duplicate, rename, remove,
 *      undo, redo, copy, paste, sync, getSettings, setSettings)
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    const p = factory();
    module.exports = p;
    module.exports.default = p;
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.gjsPagesManager = factory();
    if (root.grapesjs) root.grapesjs.plugins.add('gjs-pages-manager', root.gjsPagesManager);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RU = {
    pages: 'Страницы',
    newPage: 'Новая страница',
    sync: 'Синхронизация с сервером',
    settings: 'Настройки сервера',
    undo: 'Отменить (Ctrl+Z)',
    redo: 'Вернуть (Ctrl+Y)',
    rename: 'Переименовать',
    duplicate: 'Дублировать',
    remove: 'Удалить',
    confirmRemove: 'Удалить страницу «%s»?',
    promptName: 'Название страницы',
    defaultName: 'Страница',
    copySuffix: 'копия',
    serverSuffix: 'сервер',
    copied: 'Скопировано компонентов: %s',
    pasted: 'Вставлено компонентов: %s',
    noServer: 'Сервер не настроен',
    server: 'Сервер: %s',
    lastSync: 'синхронизация: %s',
    unsynced: 'Не отправлено на сервер',
    onServer: 'на сервере',
    localOnly: 'только локально',
    notSent: 'не отправлено',
    serverUrl: 'URI сервера (базовый адрес API)',
    token: 'Bearer-токен (необязательно)',
    test: 'Проверить',
    save: 'Сохранить',
    close: 'Закрыть',
    connOk: 'Соединение установлено, страниц на сервере: %s',
    connFail: 'Ошибка соединения: %s',
    syncLoading: 'Получаю список страниц с сервера…',
    syncFail: 'Не удалось синхронизировать',
    allSynced: 'Всё синхронизировано, изменений нет.',
    apply: 'Применить',
    push: '↑ Отправить на сервер',
    pull: '↓ Скачать с сервера',
    del: '✕ Удалить на сервере',
    purge: '✕ Убрать локальную метку удаления',
    choiceLocal: 'Оставить мою (перезаписать сервер)',
    choiceRemote: 'Взять серверную (перезаписать мою)',
    choiceBoth: 'Оставить обе (серверная — копией)',
    conflict: '⚠ Конфликт',
    missingOnServer: 'на сервере не найдена — будет загружена заново',
    restored: 'на сервере изменена — будет восстановлена',
    done: 'Готово: %s',
    errors: 'Ошибки',
    conflictErr: 'Версия на сервере изменилась (412)',
    now: 'сейчас',
  };

  const DEFAULTS = {
    dbName: 'gjs-pages-manager',
    serverUrl: '',
    autosaveDelay: 600,
    historyLimit: 50,
    settleMs: 150, // сколько «глушим» события после loadProjectData
    takeOverCopyPaste: true,
    keys: {
      undo: 'ctrl+z, ⌘+z',
      redo: 'ctrl+y, ctrl+shift+z, ⌘+shift+z, ⌘+y',
      copy: 'ctrl+c, ⌘+c',
      paste: 'ctrl+v, ⌘+v',
    },
    blank: null, // объект или функция, возвращающая project data для новой страницы
    headers: null, // функция () => ({ 'X-Foo': 'bar' }) — доп. заголовки для запросов
    labels: {},
    // Явные подсказки на случай нестандартного шаблона редактора — если заданы,
    // автоопределение не используется вообще:
    panelId: null, // id панели с кнопками-переключателями (например 'panel-switcher')
    sidebarContainer: null, // CSS-селектор контейнера, куда встраивать сайдбар (например '.panel__right')
  };

  const CSS = `
.gjsp{display:flex;flex-direction:column;min-height:100%;font-size:13px}
.gjsp-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid rgba(0,0,0,.25);font-weight:600}
.gjsp-tools{display:flex;gap:2px}
.gjsp-btn{background:none;border:0;color:inherit;cursor:pointer;padding:4px 7px;border-radius:3px;font-size:15px;line-height:1}
.gjsp-btn:hover{background:rgba(255,255,255,.12)}
.gjsp-btn[disabled]{opacity:.3;cursor:default;background:none}
.gjsp-status{padding:6px 10px;font-size:11px;opacity:.7;min-height:16px;word-break:break-all}
.gjsp-list{list-style:none;margin:0;padding:0;overflow:auto}
.gjsp-item{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;border-left:3px solid transparent}
.gjsp-item:hover{background:rgba(255,255,255,.06)}
.gjsp-item.is-active{background:rgba(255,255,255,.1);border-left-color:var(--gjs-quaternary-color,#d278c9)}
.gjsp-dot{font-size:9px;opacity:0;color:var(--gjs-quaternary-color,#d278c9)}
.gjsp-dot.is-dirty{opacity:1}
.gjsp:not(.has-server) .gjsp-dot{display:none}
.gjsp-main{flex:1;min-width:0}
.gjsp-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gjsp-sub{font-size:10px;opacity:.55}
.gjsp-acts{display:none;gap:1px}
.gjsp-item:hover .gjsp-acts{display:flex}
.gjsp-act{background:none;border:0;color:inherit;cursor:pointer;padding:2px 5px;border-radius:3px;font-size:13px}
.gjsp-act:hover{background:rgba(255,255,255,.15)}
.gjsp-modal{font-size:13px}
.gjsp-modal table{width:100%;border-collapse:collapse;margin:8px 0}
.gjsp-modal td{padding:6px 4px;border-bottom:1px solid rgba(255,255,255,.1);vertical-align:middle}
.gjsp-modal small{opacity:.6;display:block}
.gjsp-input,.gjsp-modal select{width:100%;box-sizing:border-box;padding:6px 8px;margin:4px 0 10px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:3px}
.gjsp-modal select{margin:0}
.gjsp-primary,.gjsp-secondary{padding:7px 14px;border-radius:3px;border:0;cursor:pointer;margin-right:6px;color:inherit}
.gjsp-primary{background:var(--gjs-quaternary-color,#d278c9)}
.gjsp-secondary{background:rgba(255,255,255,.15)}
.gjsp-primary[disabled]{opacity:.5}
.gjsp-msg{margin:6px 0;min-height:18px}
.gjsp-err{color:#ff8a80}
.gjsp.gjsp-inline{width:280px;min-width:280px;height:100%;flex:0 0 280px;overflow:hidden;background:var(--gjs-primary-color,#1c2033)}
.gjsp.gjsp-floating{position:absolute;top:0;right:0;bottom:0;width:280px;z-index:50;box-shadow:-2px 0 8px rgba(0,0,0,.35);background:var(--gjs-primary-color,#1c2033)}
.gjsp-toggle{position:absolute;top:8px;right:8px;z-index:60;background:var(--gjs-primary-color,#1c2033);color:var(--gjs-font-color,#ddd);border:1px solid rgba(255,255,255,.2);border-radius:4px;padding:6px 10px;cursor:pointer;font-size:12px;box-shadow:0 1px 4px rgba(0,0,0,.3)}
.gjsp-toggle:hover{background:rgba(255,255,255,.12)}
.gjsp-toggle.gjsp-btn-inline{position:static;box-shadow:none;font-size:0;padding:5px;border:0;border-radius:0;background:transparent}
.gjsp-toggle.gjsp-btn-inline:hover{background:rgba(255,255,255,.12)}
`;

  const fmt = (s, ...a) => a.reduce((r, v) => r.replace('%s', v), s);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const enc = encodeURIComponent;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const uid = (p = '') =>
    p + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v);
    });
    kids.flat().forEach((k) => el.append(k instanceof Node ? k : document.createTextNode(k == null ? '' : k)));
    return el;
  };

  function plugin(editor, userOpts = {}) {
    const opts = {
      ...DEFAULTS,
      ...userOpts,
      keys: { ...DEFAULTS.keys, ...(userOpts.keys || {}) },
    };
    const L = { ...RU, ...opts.labels };

    /* ------------------------------------------------------------------ */
    /* IndexedDB                                                           */
    /* ------------------------------------------------------------------ */
    const db = (() => {
      let dbp;
      const open = () =>
        dbp ||
        (dbp = new Promise((res, rej) => {
          const r = indexedDB.open(opts.dbName, 1);
          r.onupgradeneeded = () => {
            r.result.createObjectStore('pages', { keyPath: 'id' });
            r.result.createObjectStore('meta', { keyPath: 'key' });
          };
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        }));
      const tx = async (store, mode, fn) => {
        const d = await open();
        return new Promise((res, rej) => {
          const t = d.transaction(store, mode);
          const rq = fn(t.objectStore(store));
          t.oncomplete = () => res(rq && rq.result);
          t.onerror = t.onabort = () => rej(t.error);
        });
      };
      return {
        all: (s) => tx(s, 'readonly', (o) => o.getAll()),
        get: (s, k) => tx(s, 'readonly', (o) => o.get(k)),
        put: (s, v) => tx(s, 'readwrite', (o) => o.put(v)),
        del: (s, k) => tx(s, 'readwrite', (o) => o.delete(k)),
      };
    })();
    const getMeta = async (k) => (await db.get('meta', k))?.value;
    const setMeta = (k, value) => db.put('meta', { key: k, value });

    /* ------------------------------------------------------------------ */
    /* Состояние                                                           */
    /* ------------------------------------------------------------------ */
    const st = {
      active: null,
      settings: { url: (opts.serverUrl || '').replace(/\/+$/, ''), token: '' },
      clipboard: null,
      lastSync: null,
    };
    const hist = new Map(); // pageId -> { stack: [jsonString], i }
    let muted = false;
    let ready = false;
    let timer = null;
    let saving = Promise.resolve();
    let queue = Promise.resolve();
    const ui = {};

    const blank = () =>
      typeof opts.blank === 'function'
        ? opts.blank()
        : opts.blank
        ? clone(opts.blank)
        : {
            assets: [],
            styles: [],
            pages: [{ frames: [{ component: { type: 'wrapper', components: [] } }] }],
          };

    /* ------------------------------------------------------------------ */
    /* Загрузка данных в редактор + история                                */
    /* ------------------------------------------------------------------ */
    const load = async (data) => {
      muted = true;
      try {
        editor.loadProjectData(clone(data));
        await sleep(opts.settleMs);
        const d = editor.getProjectData();
        return { data: d, str: JSON.stringify(d) };
      } finally {
        muted = false;
      }
    };

    const persist = async (id, data) => {
      const rec = await db.get('pages', id);
      if (!rec || rec.deleted) return;
      rec.data = data;
      rec.updatedAt = Date.now();
      rec.dirty = true;
      await db.put('pages', rec);
      renderList().catch(console.error);
    };

    const commit = async () => {
      if (muted || !ready || !st.active) return;
      const data = editor.getProjectData();
      const str = JSON.stringify(data);
      const hs = hist.get(st.active);
      if (!hs || hs.stack[hs.i] === str) return; // реального изменения не было
      hs.stack.length = hs.i + 1; // отбрасываем «будущее»
      hs.stack.push(str);
      if (hs.stack.length > opts.historyLimit) hs.stack.shift();
      hs.i = hs.stack.length - 1;
      await persist(st.active, data);
      updateUndoUi();
    };

    const schedule = () => {
      if (muted || !ready) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        saving = saving.then(commit).catch(console.error);
      }, opts.autosaveDelay);
    };

    const flush = async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        saving = saving.then(commit).catch(console.error);
      }
      await saving;
    };

    const step = async (dir) => {
      await flush();
      const hs = hist.get(st.active);
      if (!hs) return false;
      const ni = hs.i + dir;
      if (ni < 0 || ni >= hs.stack.length) return false;
      hs.i = ni;
      const { data, str } = await load(JSON.parse(hs.stack[ni]));
      hs.stack[ni] = str; // нормализованный снимок
      await persist(st.active, data);
      updateUndoUi();
      return true;
    };
    const undo = () => (queue = queue.then(() => step(-1)).catch(console.error));
    const redo = () => (queue = queue.then(() => step(1)).catch(console.error));

    function updateUndoUi() {
      const hs = hist.get(st.active);
      if (!ui.undo) return;
      ui.undo.disabled = !hs || hs.i <= 0;
      ui.redo.disabled = !hs || hs.i >= hs.stack.length - 1;
    }

    /* ------------------------------------------------------------------ */
    /* CRUD страниц                                                        */
    /* ------------------------------------------------------------------ */
    const list = async () =>
      (await db.all('pages')).filter((r) => !r.deleted).sort((a, b) => a.createdAt - b.createdAt);

    const nextName = async () => {
      const names = new Set((await list()).map((r) => r.name));
      let n = names.size + 1;
      while (names.has(`${L.defaultName} ${n}`)) n++;
      return `${L.defaultName} ${n}`;
    };

    const open = async (id, { force = false, skipFlush = false } = {}) => {
      if (id === st.active && !force) return;
      if (!skipFlush) await flush();
      const rec = await db.get('pages', id);
      if (!rec || rec.deleted) return;
      st.active = id;
      await setMeta('active', id);
      const { str } = await load(rec.data);
      const hs = hist.get(id);
      if (hs) hs.stack[hs.i] = str;
      else hist.set(id, { stack: [str], i: 0 });
      updateUndoUi();
      await renderList();
      editor.trigger('pages-manager:open', rec);
    };

    const create = async ({ name, data } = {}) => {
      await flush();
      const now = Date.now();
      const rec = {
        id: uid(),
        name: name || (await nextName()),
        data: data ? clone(data) : blank(),
        createdAt: now,
        updatedAt: now,
        dirty: true,
        deleted: false,
        remote: null,
      };
      await db.put('pages', rec);
      await open(rec.id, { force: true });
      return rec;
    };

    const duplicate = async (id) => {
      await flush();
      const src = await db.get('pages', id);
      if (src) await create({ name: `${src.name} (${L.copySuffix})`, data: src.data });
    };

    const rename = async (id, name) => {
      const rec = await db.get('pages', id);
      if (!rec) return;
      name = (name != null ? name : window.prompt(L.promptName, rec.name) || '').trim();
      if (!name || name === rec.name) return;
      rec.name = name;
      rec.updatedAt = Date.now();
      rec.dirty = true;
      await db.put('pages', rec);
      renderList();
    };

    const remove = async (id, { confirm = true } = {}) => {
      const rec = await db.get('pages', id);
      if (!rec) return;
      if (confirm && !window.confirm(fmt(L.confirmRemove, rec.name))) return;
      if (id === st.active) {
        clearTimeout(timer);
        timer = null;
        await saving;
      }
      if (rec.remote) {
        rec.deleted = true; // «надгробие» — удалим на сервере при синхронизации
        rec.dirty = true;
        await db.put('pages', rec);
      } else {
        await db.del('pages', id);
      }
      hist.delete(id);
      if (id === st.active) {
        st.active = null;
        const rest = await list();
        if (rest.length) await open(rest[0].id, { force: true, skipFlush: true });
        else await create();
      } else {
        renderList();
      }
    };

    /* ------------------------------------------------------------------ */
    /* Копирование / вставка компонентов между страницами                  */
    /* ------------------------------------------------------------------ */
    const serialize = (cmp) => {
      const json = cmp.toJSON();
      const walk = (m, j) => {
        if (m.is && m.is('textnode')) return;
        j.attributes = { ...(j.attributes || {}), id: m.getId() };
        const ms = m.components().models;
        (j.components || []).forEach((cj, i) => ms[i] && walk(ms[i], cj));
      };
      walk(cmp, json);
      return json;
    };

    // Новые id для компонентов + переписывание #id в CSS, чтобы не было коллизий.
    const remapIds = (json, css) => {
      const map = {};
      const walk = (j) => {
        if (j.attributes && j.attributes.id) {
          const nid = uid('c').replace(/-/g, '').slice(0, 10);
          map[j.attributes.id] = nid;
          j.attributes.id = nid;
        }
        (j.components || []).forEach(walk);
      };
      walk(json);
      let out = css || '';
      Object.entries(map).forEach(([o, n]) => {
        out = out.replace(new RegExp('#' + esc(o) + '(?![\\w-])', 'g'), '#' + n);
      });
      return out;
    };

    const copySelection = () => {
      const all = editor.getSelectedAll();
      const sel = all.filter((c) => c.parent() && c.get('copyable') !== false);
      const top = sel.filter((c) => {
        for (let p = c.parent(); p; p = p.parent()) if (sel.includes(p)) return false;
        return true;
      });
      if (!top.length) return false;
      st.clipboard = {
        from: st.active,
        at: Date.now(),
        items: top.map((c) => ({
          json: serialize(c),
          css: editor.getCss({ component: c, avoidProtected: true }),
        })),
      };
      setMeta('clipboard', st.clipboard).catch(() => {});
      flash(fmt(L.copied, top.length));
      return true;
    };

    const pasteClipboard = () => {
      const clip = st.clipboard;
      if (!clip || !clip.items || !clip.items.length) return false;
      const sel = editor.getSelected();
      let target = sel && sel.parent() ? sel.parent() : sel || editor.getWrapper();
      let at = sel && sel.parent() ? sel.index() + 1 : undefined;
      if (target.get('droppable') === false) {
        target = editor.getWrapper();
        at = undefined;
      }
      const added = [];
      clip.items.forEach(({ json, css }) => {
        const j = clone(json);
        const newCss = remapIds(j, css);
        if (newCss.trim()) editor.Css.addCollection(newCss, { avoidUpdateStyle: true });
        const res = target.append(j, at !== undefined ? { at: at++ } : undefined);
        added.push(...(Array.isArray(res) ? res : [res]));
      });
      if (added.length) editor.select(added);
      flash(fmt(L.pasted, added.length));
      return true;
    };

    /* ------------------------------------------------------------------ */
    /* REST-клиент и синхронизация                                         */
    /* ------------------------------------------------------------------ */
    const server = async (method, path, { body, headers } = {}, cfg = st.settings) => {
      const base = (cfg.url || '').replace(/\/+$/, '');
      if (!base) throw new Error(L.noServer);
      const hd = { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) };
      if (cfg.token) hd.Authorization = `Bearer ${cfg.token}`;
      if (typeof opts.headers === 'function') Object.assign(hd, opts.headers());
      Object.assign(hd, headers || {});
      const res = await fetch(base + path, { method, headers: hd, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) {
        const err = new Error(res.status === 412 || res.status === 409 ? L.conflictErr : `${method} ${path}: HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return res.status === 204 ? null : res.json();
    };

    const buildPlan = async () => {
      const res = await server('GET', '/pages');
      const listing = Array.isArray(res) ? res : res.items || [];
      const remote = new Map(listing.map((r) => [r.id, r]));
      const locals = await db.all('pages');
      const known = new Set(locals.map((l) => l.id));
      const plan = [];

      locals.forEach((l) => {
        const r = remote.get(l.id);
        const remoteChanged = !!r && (!l.remote || l.remote.version !== r.version);
        const base = { id: l.id, name: l.name, local: l, remote: r };
        if (l.deleted) {
          if (!r) plan.push({ ...base, kind: 'purge' });
          else if (remoteChanged) plan.push({ ...base, kind: 'pull', name: r.name, note: L.restored });
          else plan.push({ ...base, kind: 'del' });
        } else if (!r) {
          plan.push({ ...base, kind: 'push', note: l.remote ? L.missingOnServer : '' });
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
      const order = { conflict: 0, push: 1, pull: 2, del: 3, purge: 4, same: 5 };
      return plan.sort((a, b) => order[a.kind] - order[b.kind]);
    };

    const pushPage = async (recOld, force) => {
      const rec = (await db.get('pages', recOld.id)) || recOld;
      const headers = {};
      if (!force && rec.remote) headers['If-Match'] = `"${rec.remote.version}"`;
      const meta = await server('PUT', `/pages/${enc(rec.id)}`, {
        headers,
        body: { id: rec.id, name: rec.name, data: rec.data, updatedAt: rec.updatedAt },
      });
      const cur = await db.get('pages', rec.id);
      if (!cur) return;
      cur.remote = { version: meta.version, updatedAt: meta.updatedAt };
      if (cur.updatedAt === rec.updatedAt) cur.dirty = false; // за время запроса правок не было
      await db.put('pages', cur);
    };

    const pullPage = async (id, { asNew = false } = {}) => {
      const p = await server('GET', `/pages/${enc(id)}`);
      const now = Date.now();
      if (asNew) {
        await db.put('pages', {
          id: uid(),
          name: `${p.name} (${L.serverSuffix})`,
          data: p.data,
          createdAt: now,
          updatedAt: now,
          dirty: true,
          deleted: false,
          remote: null,
        });
        return;
      }
      const cur = await db.get('pages', id);
      const rec = {
        ...(cur || {}),
        id,
        name: p.name,
        data: p.data,
        createdAt: (cur && cur.createdAt) || now,
        updatedAt: now,
        dirty: false,
        deleted: false,
        remote: { version: p.version, updatedAt: p.updatedAt },
      };
      const isActive = id === st.active;
      if (isActive) {
        clearTimeout(timer);
        timer = null;
        await saving;
      }
      await db.put('pages', rec);
      hist.delete(id);
      if (isActive) await open(id, { force: true, skipFlush: true });
    };

    const runItem = async (it) => {
      const kind =
        it.kind === 'conflict' ? { local: 'forcePush', remote: 'pull', both: 'both' }[it.choice] : it.kind;
      switch (kind) {
        case 'push':
          return pushPage(it.local, false);
        case 'forcePush':
          return pushPage(it.local, true);
        case 'pull':
          return pullPage(it.id);
        case 'both':
          await pullPage(it.id, { asNew: true });
          return pushPage(it.local, true);
        case 'del':
          try {
            const hd = it.local.remote ? { 'If-Match': `"${it.local.remote.version}"` } : {};
            await server('DELETE', `/pages/${enc(it.id)}`, { headers: hd });
          } catch (e) {
            if (e.status !== 404) throw e;
          }
          return db.del('pages', it.id);
        case 'purge':
          return db.del('pages', it.id);
        default:
      }
    };

    const ACTION_LABEL = () => ({ push: L.push, pull: L.pull, del: L.del, purge: L.purge });

    const renderPlan = (body, plan) => {
      const items = plan.filter((p) => p.kind !== 'same');
      if (!items.length) {
        body.replaceChildren(h('p', {}, L.allSynced), h('button', { class: 'gjsp-secondary', onclick: () => editor.Modal.close() }, L.close));
        return;
      }
      items.forEach((p) => {
        p.enabled = true;
        if (p.kind === 'conflict') p.choice = 'local';
      });
      const labels = ACTION_LABEL();
      const rows = items.map((p) => {
        const action =
          p.kind === 'conflict'
            ? h(
                'select',
                { onchange: (e) => (p.choice = e.target.value) },
                h('option', { value: 'local' }, L.choiceLocal),
                h('option', { value: 'remote' }, L.choiceRemote),
                h('option', { value: 'both' }, L.choiceBoth)
              )
            : h('span', {}, labels[p.kind]);
        return h(
          'tr',
          {},
          h('td', { style: 'width:24px' }, h('input', { type: 'checkbox', checked: 'checked', onchange: (e) => (p.enabled = e.target.checked) })),
          h('td', {}, p.kind === 'conflict' ? `${L.conflict}: ` : '', p.name, p.note ? h('small', {}, p.note) : ''),
          h('td', { style: 'width:45%' }, action)
        );
      });
      const log = h('div', { class: 'gjsp-msg' });
      const applyBtn = h('button', { class: 'gjsp-primary' }, L.apply);
      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        const errs = [];
        let ok = 0;
        for (const it of items.filter((x) => x.enabled)) {
          try {
            await runItem(it);
            ok++;
          } catch (e) {
            errs.push(`${it.name}: ${e.message}`);
          }
        }
        st.lastSync = Date.now();
        await setMeta('lastSync', st.lastSync);
        await renderList();
        log.replaceChildren(
          h('div', {}, fmt(L.done, ok)),
          ...(errs.length ? [h('div', { class: 'gjsp-err' }, `${L.errors}:`), ...errs.map((e) => h('div', { class: 'gjsp-err' }, e))] : [])
        );
        if (!errs.length) setTimeout(() => editor.Modal.close(), 900);
      });
      body.replaceChildren(
        h('table', {}, ...rows),
        log,
        applyBtn,
        h('button', { class: 'gjsp-secondary', onclick: () => editor.Modal.close() }, L.close)
      );
    };

    const openSync = async () => {
      if (!st.settings.url) return openSettings();
      await flush();
      const body = h('div', { class: 'gjsp-modal' }, h('p', {}, L.syncLoading));
      editor.Modal.open({ title: L.sync, content: body });
      try {
        renderPlan(body, await buildPlan());
      } catch (e) {
        body.replaceChildren(
          h('p', { class: 'gjsp-err' }, `${L.syncFail}: ${e.message}`),
          h('button', { class: 'gjsp-secondary', onclick: () => editor.Modal.close() }, L.close)
        );
      }
    };

    function openSettings() {
      const url = h('input', { class: 'gjsp-input', type: 'url', placeholder: 'https://example.com/api/v1', value: st.settings.url });
      const token = h('input', { class: 'gjsp-input', type: 'password', value: st.settings.token, placeholder: 'token' });
      const msg = h('div', { class: 'gjsp-msg' });
      const read = () => ({ url: url.value.trim().replace(/\/+$/, ''), token: token.value.trim() });
      const test = async () => {
        msg.className = 'gjsp-msg';
        try {
          const r = await server('GET', '/pages', {}, read());
          msg.textContent = fmt(L.connOk, (Array.isArray(r) ? r : r.items || []).length);
        } catch (e) {
          msg.className = 'gjsp-msg gjsp-err';
          msg.textContent = fmt(L.connFail, e.message);
        }
      };
      const save = async () => {
        st.settings = read();
        await setMeta('settings', st.settings);
        renderList();
        editor.Modal.close();
      };
      editor.Modal.open({
        title: L.settings,
        content: h(
          'div',
          { class: 'gjsp-modal' },
          h('label', {}, L.serverUrl),
          url,
          h('label', {}, L.token),
          token,
          msg,
          h('button', { class: 'gjsp-primary', onclick: save }, L.save),
          h('button', { class: 'gjsp-secondary', onclick: test }, L.test)
        ),
      });
    }

    /* ------------------------------------------------------------------ */
    /* UI                                                                  */
    /* ------------------------------------------------------------------ */
    let flashTimer;
    function flash(text) {
      if (!ui.status) return;
      ui.status.textContent = text;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(renderStatus, 2500);
    }

    function renderStatus() {
      if (!ui.status) return;
      const parts = [];
      if (st.settings.url) {
        parts.push(fmt(L.server, st.settings.url));
        if (st.lastSync) parts.push(fmt(L.lastSync, new Date(st.lastSync).toLocaleString()));
      } else parts.push(L.noServer);
      ui.status.textContent = parts.join(' · ');
      ui.root.classList.toggle('has-server', !!st.settings.url);
    }

    const act = (txt, title, fn) =>
      h('button', { class: 'gjsp-act', title, onclick: (e) => { e.stopPropagation(); fn(); } }, txt);

    const subtitle = (r) => {
      const t = new Date(r.updatedAt).toLocaleString();
      if (!st.settings.url) return t;
      return `${t} · ${r.remote ? (r.dirty ? L.notSent : L.onServer) : L.localOnly}`;
    };

    async function renderList() {
      if (!ui.list) return;
      const rows = await list();
      ui.list.replaceChildren(
        ...rows.map((r) =>
          h(
            'li',
            { class: 'gjsp-item' + (r.id === st.active ? ' is-active' : ''), onclick: () => open(r.id).catch(console.error) },
            h('span', { class: 'gjsp-dot' + (r.dirty ? ' is-dirty' : ''), title: L.unsynced }, '●'),
            h('div', { class: 'gjsp-main' }, h('div', { class: 'gjsp-name', title: r.name }, r.name), h('div', { class: 'gjsp-sub' }, subtitle(r))),
            h(
              'div',
              { class: 'gjsp-acts' },
              act('✎', L.rename, () => rename(r.id)),
              act('⧉', L.duplicate, () => duplicate(r.id)),
              act('✕', L.remove, () => remove(r.id))
            )
          )
        )
      );
      renderStatus();
    }

    const buildUi = () => {
      if (!document.getElementById('gjsp-style')) {
        const s = h('style', { id: 'gjsp-style' });
        s.textContent = CSS;
        document.head.appendChild(s);
      }
      ui.undo = h('button', { class: 'gjsp-btn', title: L.undo, onclick: undo }, '↶');
      ui.redo = h('button', { class: 'gjsp-btn', title: L.redo, onclick: redo }, '↷');
      ui.list = h('ul', { class: 'gjsp-list' });
      ui.status = h('div', { class: 'gjsp-status' });
      ui.root = h(
        'div',
        { class: 'gjsp gjs-one-bg gjs-two-color', style: 'display:none' },
        h(
          'div',
          { class: 'gjsp-head' },
          h('span', {}, L.pages),
          h(
            'div',
            { class: 'gjsp-tools' },
            ui.undo,
            ui.redo,
            h('button', { class: 'gjsp-btn', title: L.newPage, onclick: () => create() }, '+'),
            h('button', { class: 'gjsp-btn', title: L.sync, onclick: openSync }, '⟳'),
            h('button', { class: 'gjsp-btn', title: L.settings, onclick: openSettings }, '⚙'),
            h('button', { class: 'gjsp-btn', title: L.close, onclick: () => editor.stopCommand('pages-manager:open') }, '✕')
          )
        ),
        ui.status,
        ui.list
      );

      // Собственная кнопка-переключатель — не зависит от того, есть ли в теме
      // подходящая панель. Всегда видна, приклеена к правому краю редактора.
      ui.toggle = h(
        'button',
        {
          class: 'gjsp-toggle',
          title: L.pages,
          onclick: () => editor.runCommand('pages-manager:toggle'),
        },
        '☰ ' + L.pages
      );
    };

    /* ------------------------------------------------------------------ */
    /* Панель, команды, клавиши                                            */
    /* ------------------------------------------------------------------ */
    const BTN_ID = 'pages-manager';
    // Ищем панель с кнопками-переключателями (слои/стили/трейты/блоки) не по id
    // (он отличается между сборками: 'views' в ядре GrapesJS, 'panel-switcher'
    // в популярном webpage-builder туториале, и т.д. — а "gjs-pn-buttons" вообще
    // не идентификатор, а общий CSS-класс контейнера кнопок ЛЮБОЙ панели),
    // а по тому, что в ней лежат кнопки со стандартными командами переключения.
    const SWITCH_CMD_RE = /^(open|show)-(sm|styles?|layers?|blocks?|tm|traits?)$/i;
    const findHostPanel = () => {
      if (opts.panelId) return editor.Panels.getPanel(opts.panelId);
      const byCommand = editor.Panels.getPanels().find((p) =>
        p.get('buttons').some((b) => {
          const cmd = b.get('command');
          const cmdId = typeof cmd === 'string' ? cmd : b.id;
          return SWITCH_CMD_RE.test(cmdId || '') || SWITCH_CMD_RE.test(b.id || '');
        })
      );
      if (byCommand) return byCommand;
      // На случай совсем нестандартных названий команд — пробуем известные id.
      return ['views', 'panel-switcher', 'options'].map((id) => editor.Panels.getPanel(id)).find(Boolean);
    };
    let hostPanel = findHostPanel();

    if (hostPanel) {
      hostPanel.get('buttons').add({
        id: BTN_ID,
        label:
          '<svg viewBox="0 0 24 24" style="display:block;width:22px;height:22px"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg>',
        command: 'pages-manager:open',
        togglable: false,
        attributes: { title: L.pages },
      });
    }

    editor.Commands.add('pages-manager:open', {
      run() {
        if (!ui.root) return;
        if (hostPanel) {
          const btns = hostPanel.get('buttons');
          btns.forEach((b) => b.id !== BTN_ID && b.get('active') && b.set('active', false));
        }
        ui.root.style.display = '';
      },
      stop() {
        if (ui.root) ui.root.style.display = 'none';
      },
    });
    editor.Commands.add('pages-manager:toggle', {
      run() {
        const isOpen = ui.root && ui.root.style.display !== 'none';
        if (isOpen) editor.stopCommand('pages-manager:open');
        else editor.runCommand('pages-manager:open');
      },
    });

    // Переопределяем команды undo/redo — панельные кнопки тоже начнут использовать нашу историю.
    editor.Commands.add('core:undo', { run: () => undo() });
    editor.Commands.add('core:redo', { run: () => redo() });
    editor.Commands.add('pages-manager:copy', { run: () => copySelection() });
    editor.Commands.add('pages-manager:paste', { run: () => pasteClipboard() });

    const km = editor.Keymaps;
    km.add('core:undo', opts.keys.undo, 'core:undo', { prevent: true });
    km.add('core:redo', opts.keys.redo, 'core:redo', { prevent: true });
    if (opts.takeOverCopyPaste) {
      km.remove('core:copy');
      km.remove('core:paste');
      km.add(
        'pages-manager:copy',
        opts.keys.copy,
        (ed, _s, o) => {
          if (copySelection() && o && o.event) o.event.preventDefault();
        },
        {}
      );
      km.add(
        'pages-manager:paste',
        opts.keys.paste,
        (ed, _s, o) => {
          if (pasteClipboard() && o && o.event) o.event.preventDefault();
        },
        {}
      );
    }

    editor.on('update change:changesCount', schedule);

    const onUnload = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        commit();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    editor.on('destroy', () => window.removeEventListener('beforeunload', onUnload));

    /* ------------------------------------------------------------------ */
    /* Старт                                                               */
    /* ------------------------------------------------------------------ */
    // Находим, куда встроить содержимое сайдбара, чтобы он появлялся там же,
    // где стандартные панели (слои/стили/трейты), а не поверх холста.
    // Порядок попыток: явный селектор из опций → типовые контейнеры известных
    // пресетов GrapesJS → запасной вариант (колонка рядом с канвасом) →
    // самый последний запасной вариант — оверлей поверх редактора.
    const findSidebarHost = () => {
      const c = editor.getContainer();
      if (opts.sidebarContainer) {
        const el = document.querySelector(opts.sidebarContainer);
        if (el) return { el, mode: 'inline' };
        console.warn('[gjs-pages-manager] sidebarContainer "%s" не найден, использую автоопределение', opts.sidebarContainer);
      }
      // Стандартный контейнер вида "views" в ядре GrapesJS.
      let el = c.querySelector('.gjs-pn-views-container');
      if (el) return { el, mode: 'inline' };
      // Типовой контейнер правой колонки в demo/preset webpage-темах.
      el = c.querySelector('.panel__right');
      if (el) return { el, mode: 'inline' };
      // Запасной вариант: встаём рядом с канвасом как ещё одна колонка —
      // визуально там же, где обычно расположены сайдбары.
      const canvasEl = c.querySelector('.gjs-cv-canvas') || c.querySelector('.gjs-cv-canvas-c');
      if (canvasEl && canvasEl.parentElement) return { el: canvasEl.parentElement, mode: 'inline' };
      return { el: c, mode: 'floating' };
    };

    const start = async () => {
      buildUi();

      const container = editor.getContainer();
      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

      const { el: sideHost, mode } = findSidebarHost();
      if (mode === 'floating') {
        ui.root.classList.add('gjsp-floating');
        // Сдвигаем панель ниже верхнего тулбара, чтобы не перекрывать его,
        // если удалось найти сам тулбар.
        const topPanel = container.querySelector('.gjs-pn-panel, .panel__top');
        if (topPanel) ui.root.style.top = topPanel.getBoundingClientRect().height + 'px';
      } else {
        ui.root.classList.add('gjsp-inline');
      }
      sideHost.appendChild(ui.root);

      if (hostPanel) {
        const btns = hostPanel.get('buttons');
        const ours = btns.get(BTN_ID);
        btns.on('change:active', (b) => {
          if (b.id !== BTN_ID && b.get('active') && ours && ours.get('active')) ours.set('active', false);
        });
      } else {
        // Последний запасной вариант: команды кнопок в этой сборке названы
        // совсем нестандартно, поиск по ним не сработал. ".gjs-pn-buttons" —
        // это общий CSS-класс контейнера кнопок ЛЮБОЙ панели (их может быть
        // несколько на странице), поэтому вслепую в первый попавшийся класть
        // нельзя — но панель переключателей обычно рендерится в DOM последней
        // (после панели с undo/redo и т.п.), поэтому берём последний найденный.
        const groups = container.querySelectorAll('.gjs-pn-buttons');
        const domHost = groups[groups.length - 1];
        if (domHost) {
          domHost.appendChild(ui.toggle);
          ui.toggle.classList.add('gjs-pn-btn', 'gjsp-btn-inline');
          ui.toggle.textContent = '';
          ui.toggle.innerHTML =
            '<svg viewBox="0 0 24 24" style="display:block;width:18px;height:18px"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg>';
        } else {
          // Совсем ничего не нашли — хотя бы плавающая кнопка, чтобы сайдбар
          // было чем открыть.
          container.appendChild(ui.toggle);
        }
      }

      const saved = await getMeta('settings');
      if (saved) st.settings = { ...st.settings, ...saved, url: (saved.url || st.settings.url).replace(/\/+$/, '') };
      st.clipboard = (await getMeta('clipboard')) || null;
      st.lastSync = (await getMeta('lastSync')) || null;

      const pages = await list();
      if (!pages.length) {
        // БД пуста — сохраняем текущее содержимое редактора как первую страницу.
        const data = editor.getProjectData();
        const now = Date.now();
        const rec = {
          id: uid(),
          name: `${L.defaultName} 1`,
          data,
          createdAt: now,
          updatedAt: now,
          dirty: true,
          deleted: false,
          remote: null,
        };
        await db.put('pages', rec);
        st.active = rec.id;
        await setMeta('active', rec.id);
        hist.set(rec.id, { stack: [JSON.stringify(data)], i: 0 });
      } else {
        const last = await getMeta('active');
        const target = pages.find((p) => p.id === last) || pages[0];
        await open(target.id, { force: true });
      }
      ready = true;
      updateUndoUi();
      await renderList();
      editor.trigger('pages-manager:ready');
    };

    if (editor.onReady) editor.onReady(() => start().catch(console.error));
    else editor.on('load', () => start().catch(console.error));

    editor.PagesManager = {
      list,
      open,
      create,
      duplicate,
      rename,
      remove,
      undo,
      redo,
      copy: copySelection,
      paste: pasteClipboard,
      sync: openSync,
      getActiveId: () => st.active,
      getSettings: () => ({ ...st.settings }),
      setSettings: async (s) => {
        st.settings = { ...st.settings, ...s, url: (s.url != null ? s.url : st.settings.url).replace(/\/+$/, '') };
        await setMeta('settings', st.settings);
        renderList();
      },
    };
  }

  return plugin;
});
