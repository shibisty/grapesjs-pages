/** Replaces each `%s` with the next argument. */
export const fmt = (s: string, ...args: Array<string | number>): string =>
  args.reduce<string>((r, v) => r.replace('%s', String(v)), s);

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Strips trailing slashes and whitespace from a base URL. */
export const normalizeUrl = (url: string | null | undefined): string => (url || '').trim().replace(/\/+$/, '');

/**
 * A random UUID v4 (what servers keying records by client ids expect).
 * `crypto.randomUUID` exists only in secure contexts (https, localhost);
 * elsewhere the UUID is built from `getRandomValues`, or `Math.random` as
 * the last resort.
 */
export const uuid = (): string => {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      /* not a secure context */
    }
  }
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uid = (prefix = ''): string => prefix + uuid();

/** Logs instead of leaving an unhandled rejection. */
export const report = (e: unknown): void => {
  console.error('[grapesjs-pages]', e);
};
