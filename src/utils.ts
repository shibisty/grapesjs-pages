/** Replaces each `%s` with the next argument. */
export const fmt = (s: string, ...args: Array<string | number>): string =>
  args.reduce<string>((r, v) => r.replace('%s', String(v)), s);

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Strips trailing slashes and whitespace from a base URL. */
export const normalizeUrl = (url: string | null | undefined): string => (url || '').trim().replace(/\/+$/, '');

export const uid = (prefix = ''): string => {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  const id =
    c && typeof c.randomUUID === 'function'
      ? c.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return prefix + id;
};

/** Logs instead of leaving an unhandled rejection. */
export const report = (e: unknown): void => {
  console.error('[grapesjs-pages]', e);
};
