/** Creator-scoped Owl Center API paths (SIWS + creator_wallet or admin). */
export function creatorMintConfigApiPath(launchId: string): string {
  return `/api/owl-center/launches/${launchId}/mint-config`
}

export function creatorMetadataRefreshApiPath(launchId: string): string {
  return `/api/owl-center/launches/${launchId}/metadata-refresh`
}

export function creatorHashListApiPath(launchId: string): string {
  return `/api/owl-center/launches/${launchId}/hash-list`
}

export function publicHashListDownloadPath(slug: string): string {
  return `/api/owl-center/collections/${encodeURIComponent(slug)}/hash-list`
}
