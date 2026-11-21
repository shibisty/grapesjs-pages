/**
 * `grapesjs-pages/archive`: the site archive format without the plugin
 * (no DOM, no GrapesJS) — for servers and tools that read or write it.
 */
export * from './format';
// The head of a page in any language (no DOM): for servers that publish or render.
export * from '../seo/head';
export * from '../seo/languages';
