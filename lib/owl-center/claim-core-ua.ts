import 'server-only'

import { getOwlCenterLaunchByIdAdmin, updateOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { createIrysDeployerCoreUmi } from '@/lib/owl-center/core-cm-deploy-onchain'
import {
  isOwlCenterCreatorUaHandoffEnabled,
  handOffCoreCollectionUpdateAuthority,
  fetchCoreCollectionAuthorityStatus,
} from '@/lib/owl-center/core-collection-ua-handoff'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'

export type ClaimCoreUaResult =
  | {
      ok: true
      launch: OwlCenterLaunchPublic
      updateAuthority: string
      platformDelegate: string
      alreadyClaimed?: boolean
    }
  | { ok: false; error: string; status: number }

export async function getCoreUaStatusForLaunch(launchId: string): Promise<
  | {
      ok: true
      mint_standard: string
      collection_mint: string | null
      creator_wallet: string | null
      onchain_update_authority: string | null
      platform_update_delegate: string | null
      updateAuthority: string | null
      platformDelegateListed: boolean
      creatorOwnsUa: boolean
      canClaim: boolean
      handoffEnabled: boolean
    }
  | { ok: false; error: string; status: number }
> {
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return { ok: false, error: 'Launch not found', status: 404 }

  const handoffEnabled = isOwlCenterCreatorUaHandoffEnabled()
  const collection = launch.collection_mint?.trim() || null
  if (launch.mint_standard !== 'core' || !collection) {
    return {
      ok: true,
      mint_standard: launch.mint_standard,
      collection_mint: collection,
      creator_wallet: launch.creator_wallet,
      onchain_update_authority: launch.onchain_update_authority ?? null,
      platform_update_delegate: launch.platform_update_delegate ?? null,
      updateAuthority: launch.onchain_update_authority ?? null,
      platformDelegateListed: false,
      creatorOwnsUa: false,
      canClaim: false,
      handoffEnabled,
    }
  }

  try {
    const network = resolveLaunchMintNetwork(launch)
    const umi = createIrysDeployerCoreUmi(network)
    const platformDelegate = String(umi.identity.publicKey)
    const status = await fetchCoreCollectionAuthorityStatus({
      umi,
      collectionAddress: collection,
      creatorWallet: launch.creator_wallet,
      platformDelegate,
    })
    return {
      ok: true,
      mint_standard: launch.mint_standard,
      collection_mint: collection,
      creator_wallet: launch.creator_wallet,
      onchain_update_authority: launch.onchain_update_authority ?? status.updateAuthority,
      platform_update_delegate: launch.platform_update_delegate ?? platformDelegate,
      updateAuthority: status.updateAuthority,
      platformDelegateListed: status.platformDelegateListed,
      creatorOwnsUa: status.creatorOwnsUa,
      canClaim: status.canClaim,
      handoffEnabled,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), status: 500 }
  }
}

export async function claimCoreCollectionUpdateAuthorityForLaunch(
  launchId: string
): Promise<ClaimCoreUaResult> {
  if (!isOwlCenterCreatorUaHandoffEnabled()) {
    return { ok: false, error: 'Creator update-authority handoff is disabled.', status: 503 }
  }

  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return { ok: false, error: 'Launch not found', status: 404 }
  if (launch.mint_standard !== 'core') {
    return {
      ok: false,
      error: 'Claim update authority is only available for Metaplex Core collections.',
      status: 400,
    }
  }
  const collection = launch.collection_mint?.trim()
  if (!collection) {
    return { ok: false, error: 'Missing collection mint — deploy first.', status: 400 }
  }
  const creatorWallet = launch.creator_wallet?.trim()
  if (!creatorWallet) {
    return { ok: false, error: 'creator_wallet is required before claiming update authority.', status: 400 }
  }

  const network = resolveLaunchMintNetwork(launch)
  const umi = createIrysDeployerCoreUmi(network)
  const handoff = await handOffCoreCollectionUpdateAuthority({
    umi,
    collectionAddress: collection,
    creatorWallet,
  })
  if (!handoff.ok) {
    return { ok: false, error: handoff.error, status: 500 }
  }

  const updated = await updateOwlCenterLaunchByIdAdmin(launchId, {
    onchain_update_authority: handoff.updateAuthority,
    platform_update_delegate: handoff.platformDelegate,
  })

  return {
    ok: true,
    launch: updated ?? launch,
    updateAuthority: handoff.updateAuthority,
    platformDelegate: handoff.platformDelegate,
    alreadyClaimed: Boolean(handoff.alreadyHandedOff),
  }
}
