import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { ProjectData, RecordKind } from '../types';

/**
 * The pages archive: a ZIP with `manifest.json` and a folder per record.
 *
 * ```
 * manifest.json
 * site/                 project.json, style.css, settings.json
 * layouts/<name>/       project.json, body.html, style.css, index.html
 * templates/<name>/     project.json, body.html, style.css, index.html, fields.json
 * pages/<slug>/         project.json, body.html, style.css, index.html  (`/` → pages/index)
 * ```
 *
 * `project.json` (GrapesJS project data) is what an import reads back.
 * `body.html` and `style.css` are what a publish would send, `index.html`
 * a standalone preview (the site's CSS, the page put into its layout):
 * for work in other tools. When `body.html` or `style.css` were changed
 * there (their hash in the manifest no longer matches), an import builds
 * the record from them instead of `project.json`.
 *
 * Designs only: no entries of templates and no field values (the content
 * is moved separately). Pure functions, no DOM: usable in Node (a local
 * server keeps a site as this folder tree).
 */
export const ARCHIVE_FORMAT = 'grapesjs-pages-archive';
export const ARCHIVE_VERSION = 1;

/** One record of an archive. */
export interface ArchiveRecord {
  id: string;
  kind: RecordKind;
  name: string;
  /** GrapesJS project data. */
  data: ProjectData | null;
  slug?: string;
  parentId?: string | null;
  layoutId?: string | null;
  position?: number;
  /** A page's values (SEO, in_menu); the site's settings. */
  values?: Record<string, unknown>;
  /** A template's field list (grapesjs-storage / luna-pages). */
  fields?: unknown[];
  /** The published markup, when the export rendered it. */
  html?: string;
  css?: string;
}

/** A record as listed in `manifest.json`. */
export interface ManifestEntry {
  id: string;
  kind: RecordKind;
  name: string;
  /** Folder of the record inside the archive, no trailing slash. */
  dir: string;
  slug?: string;
  parentId?: string | null;
  layoutId?: string | null;
  position?: number;
  values?: Record<string, unknown>;
  /** Hashes of body.html and style.css as exported (to detect edits made elsewhere). */
  hash?: { html?: string; css?: string };
}

export interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  createdAt: string;
  generator?: string;
  /** Where it came from (a server URL, a folder), informational. */
  source?: string;
  name?: string;
  records: ManifestEntry[];
}

export interface ReadArchive {
  manifest: ArchiveManifest;
  records: ArchiveRecord[];
  /** Records whose body.html or style.css were edited outside (taken from the HTML). */
  edited: string[];
}

export class ArchiveError extends Error {}

const KIND_DIR: Record<RecordKind, string> = { site: 'site', layout: 'layouts', template: 'templates', page: 'pages' };

/** FNV-1a 32 bit, hex: enough to notice an edit, not a security measure. */
export function contentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A file-system safe folder name: latin letters, digits, dashes. */
export function safeName(raw: string, fallback = 'item'): string {
  const s = String(raw || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || fallback;
}

/** Folder of each record, unique within the archive. */
export function recordDirs(records: Pick<ArchiveRecord, 'id' | 'kind' | 'name' | 'slug'>[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  const take = (want: string, id: string): string => {
    let dir = want;
    if (used.has(dir)) dir = `${want}--${safeName(id).slice(0, 8)}`;
    let n = 2;
    while (used.has(dir)) dir = `${want}--${n++}`;
    used.add(dir);
    return dir;
  };
  // Pages with an address first, so their folders follow the site's paths.
  const order = [...records].sort((a, b) => Number(!a.slug) - Number(!b.slug));
  for (const r of order) {
    const kind = r.kind || 'page';
    let dir: string;
    if (kind === 'site') dir = 'site';
    else if (kind === 'page' && r.slug) {
      const parts = r.slug.split('/').filter(Boolean).map((p) => safeName(p));
      dir = `pages/${parts.length ? parts.join('/') : 'index'}`;
    } else dir = `${KIND_DIR[kind]}/${safeName(r.name, kind)}`;
    out.set(r.id, take(dir, r.id));
  }
  return out;
}

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The element a layout marks the page's place with, as published. */
const SLOT_RE = /<(page-slot|luna-slot)\b[^>]*>[\s\S]*?<\/\1>|<(page-slot|luna-slot)\b[^>]*\/>|<([a-z0-9-]+)\b[^>]*\bdata-(?:page|luna)-slot\b[^>]*>[\s\S]*?<\/\3>/i;

/** A page's HTML put into its layout's slot (or the page alone). */
export function compose(layoutHtml: string | undefined, pageHtml: string): string {
  if (!layoutHtml) return pageHtml;
  return SLOT_RE.test(layoutHtml) ? layoutHtml.replace(SLOT_RE, () => pageHtml) : layoutHtml + pageHtml;
}

/** `../` back to the archive root from a folder. */
const up = (dir: string): string => '../'.repeat(dir.split('/').length);

function previewDoc(rec: ArchiveRecord, dir: string, layout: ArchiveRecord | undefined, layoutDir: string | undefined): string {
  const root = up(dir);
  const links = [`<link rel="stylesheet" href="${root}site/style.css">`];
  if (layout?.css != null && layoutDir) links.push(`<link rel="stylesheet" href="${root}${layoutDir}/style.css">`);
  links.push('<link rel="stylesheet" href="style.css">');
  const title = String(rec.values?.['seo.title'] || rec.name || '');
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    ...links,
    '</head>',
    '<body>',
    compose(layout?.html, rec.html || ''),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';

/** The archive's files: path → contents. */
export function archiveFiles(records: ArchiveRecord[], meta: { name?: string; source?: string; generator?: string } = {}): Record<string, string> {
  const dirs = recordDirs(records);
  const byId = new Map(records.map((r) => [r.id, r]));
  const files: Record<string, string> = {};
  const entries: ManifestEntry[] = [];
  {
    for (const r of records) {
      const kind = r.kind || 'page';
      const dir = dirs.get(r.id)!;
      const e: ManifestEntry = { id: r.id, kind, name: r.name, dir };
      if (kind === 'page') {
        if (r.slug) e.slug = r.slug;
        e.parentId = r.parentId ?? null;
        e.layoutId = r.layoutId ?? null;
        e.position = r.position ?? 0;
      }
      if (r.values && Object.keys(r.values).length && kind !== 'site') e.values = r.values;
      files[`${dir}/project.json`] = json(r.data ?? null);
      if (kind === 'site') {
        files[`${dir}/settings.json`] = json(r.values || {});
        if (r.css != null) {
          files[`${dir}/style.css`] = r.css;
          e.hash = { css: contentHash(r.css) };
        }
      } else if (r.html != null || r.css != null) {
        const html = r.html ?? '';
        const css = r.css ?? '';
        files[`${dir}/body.html`] = html;
        files[`${dir}/style.css`] = css;
        e.hash = { html: contentHash(html), css: contentHash(css) };
        const layout = kind === 'page' && r.layoutId ? byId.get(r.layoutId) : undefined;
        if (kind !== 'layout') files[`${dir}/index.html`] = previewDoc(r, dir, layout, layout && dirs.get(layout.id));
      }
      if (kind === 'template' && r.fields) files[`${dir}/fields.json`] = json(r.fields);
      entries.push(e);
    }
  }
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    createdAt: new Date().toISOString(),
    generator: meta.generator || 'grapesjs-pages',
    ...(meta.source ? { source: meta.source } : {}),
    ...(meta.name ? { name: meta.name } : {}),
    records: entries,
  };
  return { 'manifest.json': json(manifest), ...files };
}

/** The archive as ZIP bytes. */
export function packArchive(records: ArchiveRecord[], meta: Parameters<typeof archiveFiles>[1] = {}): Uint8Array {
  const files = archiveFiles(records, meta);
  const zip: Zippable = {};
  Object.entries(files).forEach(([p, s]) => {
    zip[p] = [strToU8(s), { level: p.endsWith('.json') || p.endsWith('.html') || p.endsWith('.css') ? 6 : 0 }];
  });
  return zipSync(zip, { mtime: new Date() });
}

const KINDS: RecordKind[] = ['site', 'layout', 'template', 'page'];

const parseJson = (s: string | undefined, what: string): any => {
  if (s == null) return undefined;
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new ArchiveError(`${what}: ${(e as Error).message}`);
  }
};

/**
 * A project built from markup edited outside GrapesJS. The CSS goes in as a
 * `<style>` before the HTML: GrapesJS' parser moves it into the project's
 * rules (a CSS string in `styles` is not a format it loads).
 */
export function projectFromMarkup(html: string, css: string, base?: ProjectData | null): ProjectData {
  const b = (base || {}) as any;
  const style = css.trim() ? `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>` : '';
  return {
    ...(b.assets ? { assets: b.assets } : { assets: [] }),
    styles: [],
    pages: [{ ...(b.pages?.[0] || {}), frames: [{ component: style + html }] }],
  } as unknown as ProjectData;
}

/** Reads an archive's files (path → text). Throws `ArchiveError` when it is not one. */
export function readArchiveFiles(files: Record<string, string>): ReadArchive {
  // A ZIP made by zipping the folder may put everything under one top folder.
  let prefix = '';
  if (!('manifest.json' in files)) {
    const m = Object.keys(files).find((p) => /^[^/]+\/manifest\.json$/.test(p));
    if (m) prefix = m.slice(0, -'manifest.json'.length);
  }
  const manifest = parseJson(files[`${prefix}manifest.json`], 'manifest.json') as ArchiveManifest | undefined;
  if (!manifest || manifest.format !== ARCHIVE_FORMAT) throw new ArchiveError('manifest.json is missing or is not a pages archive');
  if (typeof manifest.version !== 'number' || manifest.version > ARCHIVE_VERSION) {
    throw new ArchiveError(`archive version ${manifest.version} is newer than this plugin reads (${ARCHIVE_VERSION})`);
  }
  if (!Array.isArray(manifest.records)) throw new ArchiveError('manifest.json has no records');
  const records: ArchiveRecord[] = [];
  const edited: string[] = [];
  const seen = new Set<string>();
  for (const e of manifest.records) {
    if (!e || typeof e.id !== 'string' || !e.id || seen.has(e.id)) throw new ArchiveError(`bad or repeated record id in manifest.json`);
    if (!KINDS.includes(e.kind)) throw new ArchiveError(`record ${e.id}: unknown kind ${e.kind}`);
    seen.add(e.id);
    const dir = prefix + String(e.dir || '').replace(/^\/+|\/+$/g, '');
    const at = (f: string): string | undefined => files[`${dir}/${f}`];
    const html = at('body.html');
    const css = at('style.css');
    let data = parseJson(at('project.json'), `${e.dir}/project.json`) as ProjectData | null | undefined;
    const htmlChanged = html != null && (!e.hash?.html || e.hash.html !== contentHash(html));
    const cssChanged = css != null && e.hash?.css != null && e.hash.css !== contentHash(css);
    if (e.kind !== 'site' && (data == null || htmlChanged || cssChanged) && (html != null || css != null)) {
      // No project, or the markup was edited elsewhere: GrapesJS parses it.
      if (data != null) edited.push(e.id);
      data = projectFromMarkup(html ?? '', css ?? '', data);
    } else if (e.kind === 'site' && cssChanged) {
      edited.push(e.id);
      data = projectFromMarkup('', css ?? '', data);
    }
    const rec: ArchiveRecord = { id: e.id, kind: e.kind, name: String(e.name || '').trim() || e.kind, data: data ?? null };
    if (e.kind === 'page') {
      if (e.slug) rec.slug = e.slug;
      rec.parentId = e.parentId ?? null;
      rec.layoutId = e.layoutId ?? null;
      rec.position = Number.isFinite(e.position) ? Number(e.position) : 0;
      if (e.values && typeof e.values === 'object') rec.values = e.values;
    }
    if (e.kind === 'site') rec.values = parseJson(at('settings.json'), `${e.dir}/settings.json`) || {};
    if (e.kind === 'template') {
      const f = parseJson(at('fields.json'), `${e.dir}/fields.json`);
      if (Array.isArray(f)) rec.fields = f;
    }
    if (html != null) rec.html = html;
    if (css != null) rec.css = css;
    records.push(rec);
  }
  return { manifest, records, edited };
}

/** Reads ZIP bytes. */
export function readArchive(bytes: Uint8Array): ReadArchive {
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes);
  } catch (e) {
    throw new ArchiveError(`not a ZIP file (${(e as Error).message})`);
  }
  const files: Record<string, string> = {};
  Object.entries(raw).forEach(([p, b]) => {
    if (!p.endsWith('/')) files[p.replace(/\\/g, '/')] = strFromU8(b);
  });
  return readArchiveFiles(files);
}

/**
 * The order an import writes records in: the site, layouts, templates,
 * then pages with every parent before its children (what a server that
 * checks references needs).
 */
export function importOrder<T extends Pick<ArchiveRecord, 'id' | 'kind' | 'parentId'>>(records: T[]): T[] {
  const rank: Record<RecordKind, number> = { site: 0, layout: 1, template: 2, page: 3 };
  const head = records.filter((r) => r.kind !== 'page').sort((a, b) => rank[a.kind] - rank[b.kind]);
  const pages = records.filter((r) => r.kind === 'page');
  const ids = new Set(pages.map((p) => p.id));
  const done = new Set<string>();
  const out: T[] = [];
  let left = pages;
  while (left.length) {
    const ready = left.filter((p) => !p.parentId || !ids.has(p.parentId) || done.has(p.parentId));
    // A cycle: write the rest as they are (the server refuses what it must).
    const batch = ready.length ? ready : left;
    batch.forEach((p) => {
      out.push(p);
      done.add(p.id);
    });
    left = left.filter((p) => !done.has(p.id));
  }
  return [...head, ...out];
}
