/**
 * Every UI string of the plugin. `%s` is a placeholder filled in order.
 */
export interface PagesLabels {
  pages: string;
  newPage: string;
  sync: string;
  settings: string;
  undo: string;
  redo: string;
  rename: string;
  duplicate: string;
  remove: string;
  /** %s — page name */
  confirmRemove: string;
  promptName: string;
  /** Base of auto-generated names: "Page 1", "Page 2"… */
  defaultName: string;
  copySuffix: string;
  serverSuffix: string;
  /** %s — count */
  copied: string;
  /** %s — count */
  pasted: string;
  noServer: string;
  /** %s — URL */
  server: string;
  /** %s — date */
  lastSync: string;
  unsynced: string;
  onServer: string;
  localOnly: string;
  notSent: string;
  serverUrl: string;
  token: string;
  test: string;
  save: string;
  close: string;
  /** %s — count */
  connOk: string;
  /** %s — error */
  connFail: string;
  syncLoading: string;
  syncFail: string;
  allSynced: string;
  apply: string;
  push: string;
  pull: string;
  del: string;
  purge: string;
  choiceLocal: string;
  choiceRemote: string;
  choiceBoth: string;
  conflict: string;
  missingOnServer: string;
  restored: string;
  /** %s — count */
  done: string;
  errors: string;
  conflictErr: string;

  /* ---- remote mode (contract v2) ---- */
  layouts: string;
  templates: string;
  site: string;
  newLayout: string;
  newTemplate: string;
  properties: string;
  publish: string;
  unpublish: string;
  published: string;
  draft: string;
  revisions: string;
  restore: string;
  live: string;
  noRevisions: string;
  /** %s — revision number */
  confirmRestore: string;
  slug: string;
  parent: string;
  none: string;
  layout: string;
  seoTitle: string;
  seoDescription: string;
  inMenu: string;
  saving: string;
  saved: string;
  offline: string;
  /** %s — error */
  saveError: string;
  conflictHint: string;
  resolve: string;
  /** %s — name */
  publishedMsg: string;
  /** %s — list */
  publishWarnings: string;
  /** %s — count */
  importLocal: string;
  /** %s — count */
  imported: string;
  slotLabel: string;
  slotBlock: string;
  refresh: string;
  search: string;
  noMatches: string;
  expand: string;
  collapse: string;

  /* ---- site archive ---- */
  exportArchive: string;
  importArchive: string;
  exportHint: string;
  exportHintLocal: string;
  exportHtml: string;
  download: string;
  /** %s — done/total */
  exporting: string;
  exported: string;
  archiveFile: string;
  importMode: string;
  modeReplace: string;
  modeCopy: string;
  importSite: string;
  importBtn: string;
  /** %s — done/total */
  importing: string;
  /** %s — created, %s — updated */
  importDone: string;
  /** %s — count */
  importFromMarkup: string;
  /** %s — count */
  importSkipped: string;
  /** %s — list */
  importErrors: string;
  /** %s — reason */
  badArchive: string;

  /* ---- linked components ---- */
  components: string;
  newComponent: string;
  /** Base of auto-generated names: "Component 1"… */
  componentName: string;
  saveAsComponent: string;
  /** Prompt title when saving a selection as a component */
  promptComponentName: string;
  editComponent: string;
  detachComponent: string;
  /** %s — component name */
  confirmRemoveComponent: string;
  /** %s — component name */
  componentSaved: string;
  /** %s — component name; shown over the canvas while a component is edited */
  editingComponent: string;
  /** %s — page name */
  backTo: string;
  /* ---- component sources ---- */
  /** Label of the choice of what a new component starts from */
  startFrom: string;
  emptyComponent: string;
  createComponent: string;
  /** Tab of the main fields in the properties dialog */
  general: string;
  /** Sub-line of a data record (grapesjs-storage): `%s` is its page */
  dataOf: string;
  /** The breadcrumbs component and its block */
  breadcrumbs: string;
  /** Traits of the breadcrumbs. */
  bcSeparator: string;
  bcHome: string;
  bcCurrent: string;
  bcDesigns: string;
  /** The board of all pages. */
  board: string;
  boardHint: string;
  boardZoomIn: string;
  boardZoomOut: string;
  boardZoom100: string;
  boardFit: string;
  boardFitFrame: string;
  boardRefresh: string;
  boardPages: string;
  boardData: string;
  boardLayouts: string;
  boardTemplates: string;
  boardComponents: string;
  /* SEO, Open Graph, Schema.org (properties of a page, SEO of the site) */
  seoKeywords: string;
  seoCanonical: string;
  seoNoindex: string;
  seoNofollow: string;
  /** %s — length, %s — the recommended maximum */
  seoChars: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogImageAlt: string;
  ogType: string;
  twitterCard: string;
  twitterSmall: string;
  twitterLarge: string;
  fromAssets: string;
  fromCloud: string;
  /** %s — date and time */
  tempLink: string;
  pickChoose: string;
  /** %s — count */
  pickChooseN: string;
  cancel: string;
  schemaType: string;
  schemaNone: string;
  schemaAuthor: string;
  schemaPublished: string;
  schemaBrand: string;
  schemaSku: string;
  schemaPrice: string;
  schemaCurrency: string;
  schemaAvailability: string;
  inStock: string;
  outOfStock: string;
  preOrder: string;
  schemaStart: string;
  schemaEnd: string;
  schemaPlace: string;
  schemaAddress: string;
  schemaPhone: string;
  schemaHours: string;
  schemaPriceRange: string;
  schemaArea: string;
  schemaFaq: string;
  schemaQuestion: string;
  schemaAnswer: string;
  schemaAddQa: string;
  schemaSameAs: string;
  schemaBreadcrumbs: string;
  schemaExtra: string;
  schemaExtraHint: string;
  /** %s — the parser error */
  schemaInvalid: string;
  schemaPreview: string;
  siteSeo: string;
  siteUrl: string;
  siteUrlHint: string;
  siteName: string;
  siteLang: string;
  titleTemplate: string;
  /** Mentions %s (the page title placeholder) */
  titleTemplateHint: string;
  defaultDescription: string;
  defaultImage: string;
  twitterSite: string;
  organization: string;
  orgName: string;
  orgLogo: string;
  seoDefaultsHint: string;
}
