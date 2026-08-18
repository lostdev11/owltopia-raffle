/** Creator-scoped Owl Center API paths (SIWS + creator_wallet or admin). */
export function creatorMintConfigApiPath(launchId: string): string {
  return `/api/owl-center/launches/${launchId}/mint-config`
}

export function creatorMetadataRefreshApiPath(launchId: string): string {
  return `/api/owl-center/launches/${launchId}/metadata-refresh`
}

export function creatorRevealDayApiPath(launchId: string): string {
  return `/api/owl-center/launches/${launchId}/reveal-day`
}

export function creatorHashListApiPath(launchId: string): string {
  return `/api/owl-center/launches/${launchId}/hash-list`
}

export function creatorMarketplaceApiPath(launchId: string): string {
  return `/api/owl-center/launches/${launchId}/marketplaces`
}

export function creatorLaunchDeleteApiPath(launchId: string): string {
  return `/api/owl-center/launches/${launchId}`
}

export function creatorWlWalletsApiPath(launchId: string): string {
  return `/api/owl-center/launches/${launchId}/wl-wallets`
}

export function creatorCoreThawApiPath(launchId: string): string {
  return `/api/owl-center/launches/${launchId}/core-thaw`
}

export function creatorCoreRoyaltiesApiPath(launchId: string): string {
  return `/api/owl-center/launches/${launchId}/core-royalties`
}

export function publicHashListDownloadPath(slug: string): string {
  return `/api/owl-center/collections/${encodeURIComponent(slug)}/hash-list`
}
