import { getAssetPackageByLaunchId } from '@/lib/db/owl-center-asset-package'
import { getMarketplaceReadinessByLaunchId } from '@/lib/db/owl-center-marketplace'
import {
  getOwlCenterLaunchByIdAdmin,
  updateOwlCenterLaunchByIdAdmin,
} from '@/lib/db/owl-center-launch'
import type { OwlCenterAssetPackage, OwlCenterMarketplaceReadiness } from '@/lib/owl-center/asset-types'
import { postLaunchApprovedDiscord } from '@/lib/owl-center/launch-approved-discord'
import { getLaunchCandyMachineId, getLaunchCollectionMint, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export type LaunchGoLiveAssessment = {
  /** True when pending review and all infra checks pass (auto go-live). */
  ready: boolean
  /** True when launch is already on the public mint console. */
  already_live: boolean
  /** True when infra is complete and promotion would change launch state. */
  can_promote: boolean
  blockers: string[]
}

const REVIEW_STATUSES = new Set(['DRAFT', 'PENDING_REVIEW'])

function cmIdsFromSources(
  launch: OwlCenterLaunchPublic,
  marketplace: OwlCenterMarketplaceReadiness | null
): { candy_machine_id: string | null; collection_mint: string | null } {
  const draft = {
    ...launch,
    candy_machine_id: marketplace?.candy_machine_id?.trim() || launch.candy_machine_id,
    collection_mint: marketplace?.collection_mint?.trim() || launch.collection_mint,
  }
  const network = resolveLaunchMintNetwork(draft)
  return {
    candy_machine_id: getLaunchCandyMachineId(draft, network) || null,
    collection_mint: getLaunchCollectionMint(draft, network) || null,
  }
}

export function assessLaunchGoLiveReadiness(
  launch: OwlCenterLaunchPublic,
  assetPackage: OwlCenterAssetPackage | null,
  marketplace: OwlCenterMarketplaceReadiness | null
): LaunchGoLiveAssessment {
  const blockers: string[] = []
  const pendingApproval = REVIEW_STATUSES.has(launch.status)
  const already_live =
    !pendingApproval &&
    !launch.is_paused &&
    launch.active_phase === 'PUBLIC' &&
    launch.mint_mode === 'public_simple'

  if (launch.slug === 'gen2') {
    blockers.push('Gen2 uses the Gen2 admin console — not this go-live flow.')
  }

  const assetsReady =
    Boolean(launch.assets_ready && launch.metadata_ready) ||
    (assetPackage?.validation_status === 'VALID' &&
      assetPackage.metadata_upload_status === 'READY_FOR_CANDY_MACHINE')

  if (!assetsReady) {
    blockers.push('Asset package must be VALID and READY_FOR_CANDY_MACHINE (complete checklist, then mark ready).')
  }

  const { candy_machine_id, collection_mint } = cmIdsFromSources(launch, marketplace)
  if (!candy_machine_id) blockers.push('Candy Machine ID is required (save in Marketplace panel below).')
  if (!collection_mint) blockers.push('Collection mint is required (save in Marketplace panel below).')

  return {
    ready: pendingApproval && blockers.length === 0,
    already_live,
    can_promote: !already_live && blockers.length === 0,
    blockers,
  }
}

export function buildLaunchGoLivePatch(
  launch: OwlCenterLaunchPublic,
  marketplace: OwlCenterMarketplaceReadiness | null
): Parameters<typeof updateOwlCenterLaunchByIdAdmin>[1] {
  const { candy_machine_id, collection_mint } = cmIdsFromSources(launch, marketplace)
  const network = resolveLaunchMintNetwork(launch)

  return {
    status: 'PUBLIC',
    active_phase: 'PUBLIC',
    is_paused: false,
    mint_mode: launch.slug === 'gen2' ? 'gen2_full' : 'public_simple',
    mint_network: launch.mint_network ?? (network === 'devnet' ? 'devnet' : 'mainnet'),
    candy_machine_id,
    collection_mint,
  }
}

export type PromoteLaunchResult =
  | { ok: true; launch: OwlCenterLaunchPublic; auto: boolean; already_live: boolean }
  | { ok: false; reason: 'not_found' | 'not_ready'; blockers: string[] }

/** Promote a pending creator launch to live PUBLIC mint when infra is ready. */
export async function promoteLaunchToLive(
  launchId: string,
  options?: { auto?: boolean; force?: boolean }
): Promise<PromoteLaunchResult> {
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return { ok: false, reason: 'not_found', blockers: ['Launch not found'] }

  const [assetPackage, marketplace] = await Promise.all([
    getAssetPackageByLaunchId(launchId),
    getMarketplaceReadinessByLaunchId(launchId),
  ])

  const assessment = assessLaunchGoLiveReadiness(launch, assetPackage, marketplace)

  if (assessment.already_live) {
    return { ok: true, launch, auto: Boolean(options?.auto), already_live: true }
  }

  const allow =
    options?.force || (options?.auto ? assessment.ready : assessment.can_promote)
  if (!allow) {
    return { ok: false, reason: 'not_ready', blockers: assessment.blockers }
  }

  const patch = buildLaunchGoLivePatch(launch, marketplace)
  const updated = await updateOwlCenterLaunchByIdAdmin(launchId, patch)
  if (!updated) return { ok: false, reason: 'not_ready', blockers: ['Database update failed'] }

  await postLaunchApprovedDiscord(updated)

  return { ok: true, launch: updated, auto: Boolean(options?.auto), already_live: false }
}
