import { getAssetPackageByLaunchId } from '@/lib/db/owl-center-asset-package'
import { getLatestAssetUploadJobForLaunch } from '@/lib/db/owl-center-asset-upload-job'
import { getOwlCenterLaunchByIdAdmin, updateOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import type { OwlCenterAssetPackage } from '@/lib/owl-center/asset-types'
import type { AssetUploadProgress } from '@/lib/owl-center/asset-upload-types'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export type LaunchCoverCandidate = {
  id: string
  label: string
  url: string
  kind: 'explicit' | 'collection' | 'logo' | 'token'
  token_index: number | null
}

function isHttpUrl(v: string | null | undefined): boolean {
  if (!v?.trim()) return false
  return v.startsWith('http://') || v.startsWith('https://')
}

/** Prefer launch.image_url, then asset package collection/logo URLs. */
export function resolveLaunchCoverImageUrl(
  launch: Pick<OwlCenterLaunchPublic, 'image_url'>,
  pkg: Pick<OwlCenterAssetPackage, 'collection_image_url' | 'logo_url'> | null
): string | null {
  if (isHttpUrl(launch.image_url)) return launch.image_url!.trim()
  if (pkg && isHttpUrl(pkg.collection_image_url)) return pkg.collection_image_url!.trim()
  if (pkg && isHttpUrl(pkg.logo_url)) return pkg.logo_url!.trim()
  if (launch.image_url?.startsWith('/')) return launch.image_url
  return null
}

/** NFT / collection images uploaded to Arweave via the asset upload job. */
export function listUploadedNftCoverCandidates(progress: AssetUploadProgress): LaunchCoverCandidate[] {
  const out: LaunchCoverCandidate[] = []

  for (const entry of progress.file_list) {
    const url = progress.uploaded[entry.path]
    if (!isHttpUrl(url)) continue

    if (entry.kind === 'collection_image') {
      out.push({
        id: `collection:${entry.path}`,
        label: 'Collection image',
        url,
        kind: 'collection',
        token_index: null,
      })
      continue
    }

    if (entry.kind === 'image' && entry.index != null) {
      out.push({
        id: `token:${entry.index}`,
        label: `NFT #${entry.index}`,
        url,
        kind: 'token',
        token_index: entry.index,
      })
    }
  }

  out.sort((a, b) => {
    if (a.kind === 'collection') return -1
    if (b.kind === 'collection') return 1
    return (a.token_index ?? 9999) - (b.token_index ?? 9999)
  })

  return out
}

export async function listLaunchCoverCandidates(launchId: string): Promise<LaunchCoverCandidate[]> {
  const [launch, pkg, job] = await Promise.all([
    getOwlCenterLaunchByIdAdmin(launchId),
    getAssetPackageByLaunchId(launchId),
    getLatestAssetUploadJobForLaunch(launchId),
  ])
  if (!launch) return []

  const candidates: LaunchCoverCandidate[] = []

  if (isHttpUrl(launch.image_url)) {
    candidates.push({
      id: 'current',
      label: 'Current hub cover',
      url: launch.image_url!.trim(),
      kind: 'explicit',
      token_index: null,
    })
  }
  if (pkg && isHttpUrl(pkg.collection_image_url)) {
    candidates.push({
      id: 'pkg-collection',
      label: 'Collection image URL',
      url: pkg.collection_image_url!.trim(),
      kind: 'collection',
      token_index: null,
    })
  }
  if (pkg && isHttpUrl(pkg.logo_url)) {
    candidates.push({
      id: 'pkg-logo',
      label: 'Logo URL',
      url: pkg.logo_url!.trim(),
      kind: 'logo',
      token_index: null,
    })
  }

  if (job && (job.status === 'completed' || job.status === 'uploading')) {
    for (const c of listUploadedNftCoverCandidates(job.upload_progress)) {
      if (!candidates.some((x) => x.url === c.url)) candidates.push(c)
    }
  }

  return candidates
}

/** Write hub card cover to launch.image_url (and mirror to collection_image_url when from upload). */
export async function syncLaunchHubCoverImage(
  launchId: string,
  coverUrl: string | null | undefined
): Promise<OwlCenterLaunchPublic | null> {
  const trimmed = typeof coverUrl === 'string' ? coverUrl.trim() : ''
  if (!trimmed) return null
  if (!isHttpUrl(trimmed) && !trimmed.startsWith('/')) return null

  return updateOwlCenterLaunchByIdAdmin(launchId, { image_url: trimmed.slice(0, 2000) })
}

/** Pick first uploaded token image when no cover is set yet. */
export async function autoSetLaunchCoverFromUploadJob(launchId: string): Promise<string | null> {
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch || isHttpUrl(launch.image_url)) return launch?.image_url ?? null

  const pkg = await getAssetPackageByLaunchId(launchId)
  const existing = resolveLaunchCoverImageUrl(launch, pkg)
  if (existing) {
    await syncLaunchHubCoverImage(launchId, existing)
    return existing
  }

  const job = await getLatestAssetUploadJobForLaunch(launchId)
  if (!job || job.status !== 'completed') return null

  const candidates = listUploadedNftCoverCandidates(job.upload_progress)
  const pick =
    candidates.find((c) => c.kind === 'collection') ??
    candidates.find((c) => c.kind === 'token' && c.token_index === 0) ??
    candidates.find((c) => c.kind === 'token') ??
    null

  if (!pick) return null

  await syncLaunchHubCoverImage(launchId, pick.url)
  if (pkg && pick.kind !== 'logo' && !isHttpUrl(pkg.collection_image_url)) {
    const { upsertAssetPackageForLaunch } = await import('@/lib/db/owl-center-asset-package')
    await upsertAssetPackageForLaunch(launchId, { collection_image_url: pick.url })
  }

  return pick.url
}
