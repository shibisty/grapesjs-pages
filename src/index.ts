import pagesPlugin from './plugin';

export default pagesPlugin;
export { pagesPlugin };
export { getPagesManager, PANEL_BUTTON_ID } from './plugin';
export { EVENTS, COMMANDS } from './events';
export { DEFAULT_OPTIONS, DEFAULT_KEYS, resolveOptions, META, VERSION } from './options';
export { locales, SUPPORTED_LOCALES, I18N_NS } from './i18n';
export type { PagesLabels } from './i18n';
export { IndexedDbPageStore } from './store/IndexedDbPageStore';
export { MemoryPageStore } from './store/MemoryPageStore';
export type { PageStore } from './store/types';
export { PagesManager } from './core/PagesManager';
export type { RecordHook } from './core/PagesManager';
export { MetaSharedBackend, SiteSharedBackend, SHARED_META } from './core/SharedData';
export type { SharedBackend } from './core/SharedData';
export { SnapshotHistory } from './core/SnapshotHistory';
export { ComponentClipboard, serializeComponent, remapIds } from './clipboard/ComponentClipboard';
export { RestClient, HttpError } from './sync/RestClient';
export type { RemotePage, RemotePageMeta } from './sync/RestClient';
export { buildPlan } from './sync/plan';
export type { SyncPlanItem, SyncKind, ConflictChoice } from './sync/plan';
export { SyncService } from './sync/SyncService';
export type { SyncResult } from './sync/SyncService';
export { RemoteClient, fromWire, toWire, COLLECTION, SITE_ID } from './remote/RemoteClient';
export type { WireRecord, WireWrite, PublishResult } from './remote/RemoteClient';
export { RemotePageStore } from './remote/RemotePageStore';
export type { RemoteState, RemoteStoreHooks } from './remote/RemotePageStore';
export { RemoteEditor, normalizeSlug } from './remote/RemoteEditor';
export { registerSlot, SLOT_BLOCK_ID } from './remote/slot';
export { pageTree, moveInTree, keyboardMove, searchTree, subtree } from './ui/tree';
export type { DropWhere, TreeMove, TreeRow } from './ui/tree';
export { uuid } from './utils';
export type * from './types';
export { ArchiveService } from './archive/ArchiveService';
export type { ExportOptions, ImportOptions, ImportMode, ImportReport } from './archive/ArchiveService';
export {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  ArchiveError,
  archiveFiles,
  packArchive,
  readArchive,
  readArchiveFiles,
  importOrder,
  compose,
  contentHash,
  projectFromMarkup,
  recordDirs,
  safeName,
} from './archive/format';
export type { ArchiveRecord, ArchiveManifest, ManifestEntry, ReadArchive } from './archive/format';
export { canvasMarkup, runMarkupHooks } from './remote/RemoteEditor';
export type { MarkupHook } from './remote/RemoteEditor';
export { ComponentsFeature, BLOCK_CATEGORY, BLOCK_PREFIX, instanceOf } from './components/ComponentsFeature';
export type { ComponentsApi, ComponentSource } from './components/ComponentsFeature';
export { expandProject, buildInstance, detachJson, INSTANCE_TYPE, INSTANCE_ATTR } from './components/expand';
export type { Master } from './components/expand';
