/** Публичная упаковка готовых артефактов; ordinary ZIP не требует Core. */
export { packageArtifact } from "./application/package-artifact.ts";
export { zip } from "./domain/zip.ts";
export type { ArchiveEntry } from "./domain/zip.ts";
export {
  finish as finishDownloads,
  prepareNativeDownloads,
  resetDownloadRequests,
} from "./infrastructure/runtime.ts";
export type {
  NativeDownloadOptions,
  OrdinaryDownloadOptions,
  PreparedDownloads,
} from "./infrastructure/runtime.ts";
