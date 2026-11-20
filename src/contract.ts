/**
 * GrapesJS plugin contract, v1.
 *
 * The same file is copied into every plugin of this family (no shared
 * package): keep the copies identical. It lets a plugin
 *  - say who it is (`id`, `version`, `title`) and which options it takes
 *    (`options` schema) — on the plugin function, as `fn.meta`;
 *  - be used by its npm name like the official plugins:
 *    `plugins: ['grapesjs-site-pages']`, `pluginsOpts: { 'grapesjs-site-pages': {…} }`;
 *  - expose its current options and take new ones after start
 *    (`getOptions()` / `setOptions(patch)`), which grapesjs-plugins-manager
 *    uses for its "Settings" form.
 *
 * Everything is looked up through `Symbol.for(...)` keys, so separate
 * bundles (each with its own copy of this file) see each other.
 */

/** A field of an options form. */
export interface OptionField {
  /** Option name; nested options are `type: 'object'` with `fields`. */
  key: string;
  type: 'boolean' | 'string' | 'number' | 'select' | 'list' | 'json' | 'object';
  /** The value used when the option is not given. */
  default?: unknown;
  /** Short title (English); the key is shown when missing. */
  title?: string;
  /** One-line help (English). */
  description?: string;
  /** `select`: the allowed values. */
  choices?: Array<{ value: string | number | boolean | null; label?: string }>;
  /** `object`: its fields. */
  fields?: OptionField[];
  /** Applied right away by `setOptions`; otherwise it needs a reload. */
  live?: boolean;
  /** Masked in forms (API keys, tokens). */
  secret?: boolean;
  /** Shown under "Advanced". */
  advanced?: boolean;
  /** Older names the plugin still accepts for this option. */
  aliases?: string[];
}

export interface PluginMeta {
  /** The npm name; also the id in `grapesjs.plugins` and `pluginsOpts`. */
  id: string;
  version?: string;
  title?: string;
  description?: string;
  options?: OptionField[];
}

/** What `setOptions` did. */
export interface SetOptionsResult {
  /** Keys applied right away. */
  applied: string[];
  /** Keys stored but taking effect after a reload. */
  reload: string[];
}

/** A running plugin's options, registered per editor. */
export interface PluginControl {
  meta: PluginMeta;
  /** The options in effect (resolved, with defaults). */
  getOptions(): Record<string, unknown>;
  /** Applies what it can now; the rest needs a reload. */
  setOptions(patch: Record<string, unknown>): SetOptionsResult;
}

export const CONTROLS = Symbol.for('grapesjs.plugin-controls');
/** Editor event after `setOptions`: `{ id, patch, result }`. */
export const OPTIONS_EVENT = 'plugin:options';

type PluginFnLike = ((editor: any, opts?: any) => void) & { meta?: PluginMeta };

/**
 * Marks a plugin function with its meta and registers it in
 * `grapesjs.plugins` under `meta.id` (when `grapesjs` is a global and the
 * id is free), so it can be listed by name. Returns the same function.
 */
export function definePlugin<F extends PluginFnLike>(fn: F, meta: PluginMeta): F & { meta: PluginMeta } {
  (fn as PluginFnLike).meta = meta;
  try {
    const g = (globalThis as { grapesjs?: { plugins?: { get(id: string): unknown; add(id: string, f: unknown): unknown } } }).grapesjs;
    if (g?.plugins && !g.plugins.get(meta.id)) g.plugins.add(meta.id, fn);
  } catch {
    /* no registry: used through imports only */
  }
  return fn as F & { meta: PluginMeta };
}

/** The controls of the plugins running in an editor: id → control. */
export function getControls(editor: object): Map<string, PluginControl> {
  const host = editor as Record<symbol, Map<string, PluginControl> | undefined>;
  let map = host[CONTROLS];
  if (!map) {
    map = new Map();
    Object.defineProperty(host, CONTROLS, { value: map, configurable: true });
  }
  return map;
}

/**
 * Registers a plugin's options control for an editor; returns the remover.
 * `apply(patch)` gets only the keys marked `live` and must apply them.
 */
export function registerControl(
  editor: { trigger?(event: string, ...args: unknown[]): unknown },
  meta: PluginMeta,
  current: () => Record<string, unknown>,
  apply: (patch: Record<string, unknown>) => void
): () => void {
  const live = new Set((meta.options || []).filter((f) => f.live).map((f) => f.key));
  const control: PluginControl = {
    meta,
    getOptions: () => current(),
    setOptions(patch) {
      const result: SetOptionsResult = { applied: [], reload: [] };
      const now: Record<string, unknown> = {};
      Object.keys(patch || {}).forEach((k) => {
        if (live.has(k)) {
          now[k] = patch[k];
          result.applied.push(k);
        } else result.reload.push(k);
      });
      if (result.applied.length) apply(now);
      editor.trigger?.(OPTIONS_EVENT, { id: meta.id, patch, result });
      return result;
    },
  };
  const map = getControls(editor);
  map.set(meta.id, control);
  return () => {
    if (map.get(meta.id) === control) map.delete(meta.id);
  };
}

/** Values of option fields by their defaults: `{ key: default }`. */
export function defaultsOf(fields: OptionField[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  fields.forEach((f) => {
    if (f.type === 'object' && f.fields && f.default === undefined) out[f.key] = defaultsOf(f.fields);
    else if (f.default !== undefined) out[f.key] = f.default;
  });
  return out;
}

/** Copies options given under an alias to the main key (the main key wins). */
export function applyAliases<T extends Record<string, unknown>>(opts: T, fields: OptionField[] = []): T {
  const out: Record<string, unknown> = { ...opts };
  fields.forEach((f) =>
    (f.aliases || []).forEach((a) => {
      if (a in out) {
        if (!(f.key in out)) out[f.key] = out[a];
        delete out[a];
      }
    })
  );
  return out as T;
}

/**
 * Writes a patch into a live options object. A plain-object option the
 * plugin already holds (e.g. `labels`) is refilled in place, so closures
 * that captured it see the new values; anything else is assigned.
 */
export function assignOptions(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  Object.keys(patch).forEach((k) => {
    const cur = target[k];
    const next = patch[k];
    if (plain(cur) && (plain(next) || next == null)) {
      Object.keys(cur).forEach((x) => delete cur[x]);
      if (next) Object.assign(cur, next);
    } else target[k] = next;
  });
}
