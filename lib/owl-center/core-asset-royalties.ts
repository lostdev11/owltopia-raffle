import 'server-only'

import bs58 from 'bs58'
import { addPlugin, fetchAsset, ruleSet } from '@metaplex-foundation/mpl-core'
import { publicKey } from '@metaplex-foundation/umi'

import { collectMintedNftMintsForLaunch } from '@/lib/owl-center/hash-list'
import {
  coreRoyaltiesPluginFromLaunch,
  type CoreRoyaltiesPluginArgs,
} from '@/lib/owl-center/metadata-royalty'
import { createIrysDeployerCoreUmi } from '@/lib/owl-center/core-cm-deploy-onchain'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { isIrysUploadConfigured } from '@/lib/owl-center/irys-config'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export const CORE_ROYALTIES_BACKFILL_MAX = 20

export type CoreAssetRoyaltyResult =
  | { mint: string; status: 'added'; signature: string }
  | { mint: string; status: 'already' }
  | { mint: string; status: 'skipped'; reason: string }
  | { mint: string; status: 'failed'; error: string }

export type CoreLaunchRoyaltiesResult =
  | {
      ok: true
      collection: string
      processed: number
      remaining: number
      results: CoreAssetRoyaltyResult[]
    }
  | { ok: false; error: string; status: number }

function signatureToString(sig: string | Uint8Array): string {
  return typeof sig === 'string' ? sig : bs58.encode(sig)
}

function alreadyHasPluginError(message: string): boolean {
  return /already exists|already been added|plugin already/i.test(message)
}

export async function ensureCoreAssetRoyaltiesPlugin(params: {
  mint: string
  collectionMint: string
  network: 'mainnet' | 'devnet'
  plugin: CoreRoyaltiesPluginArgs
}): Promise<CoreAssetRoyaltyResult> {
  const mint = params.mint.trim()
  const collectionMint = params.collectionMint.trim()
  if (!mint || !collectionMint) {
    return { mint, status: 'skipped', reason: 'missing_address' }
  }

  try {
    const umi = createIrysDeployerCoreUmi(params.network)
    const assetPk = publicKey(mint)
    const collectionPk = publicKey(collectionMint)
    // Collection royalties inherit in default fetchAsset; explorers/DAS read asset plugins only.
    const asset = await fetchAsset(umi, assetPk, { skipDerivePlugins: true })
    if (asset.royalties) {
      return { mint, status: 'already' }
    }

    const result = await addPlugin(umi, {
      asset: assetPk,
      collection: collectionPk,
      plugin: {
        type: 'Royalties',
        basisPoints: params.plugin.basisPoints,
        creators: params.plugin.creators.map((row) => ({
          address: publicKey(row.address),
          percentage: row.percentage,
        })),
        ruleSet: ruleSet('None'),
      },
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

    return { mint, status: 'added', signature: signatureToString(result.signature) }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (alreadyHasPluginError(error)) {
      return { mint, status: 'already' }
    }
    return { mint, status: 'failed', error }
  }
}

/** Best-effort stamp after a live mint — never throws. */
export async function ensureCoreMintRoyaltiesAfterConfirm(
  launch: Pick<
    OwlCenterLaunchPublic,
    | 'mint_standard'
    | 'mint_mode'
    | 'mint_network'
    | 'collection_mint'
    | 'seller_fee_basis_points'
    | 'royalty_splits'
    | 'creator_wallet'
  >,
  mints: string[]
): Promise<void> {
  if (launch.mint_standard !== 'core') return
  if (!isIrysUploadConfigured()) return
  try {
    const collectionMint = launch.collection_mint?.trim()
    const plugin = coreRoyaltiesPluginFromLaunch(launch)
    if (!collectionMint || !plugin) return
    const network = resolveLaunchMintNetwork(launch)
    const batch = mints.map((m) => m.trim()).filter(Boolean).slice(0, CORE_ROYALTIES_BACKFILL_MAX)
    for (const mint of batch) {
      const result = await ensureCoreAssetRoyaltiesPlugin({
        mint,
        collectionMint,
        network,
        plugin,
      })
      if (result.status === 'failed') {
        console.error('[core-asset-royalties] post-mint', mint, result.error)
      }
    }
  } catch (e) {
    console.error('[core-asset-royalties] post-mint', e instanceof Error ? e.message : e)
  }
}

export async function backfillCoreLaunchAssetRoyalties(
  launchId: string,
  options?: { mints?: string[]; max?: number }
): Promise<CoreLaunchRoyaltiesResult> {
  if (!isIrysUploadConfigured()) {
    return { ok: false, error: 'IRYS_PRIVATE_KEY is not configured', status: 500 }
  }

  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return { ok: false, error: 'Launch not found', status: 404 }
  if (launch.mint_mode !== 'public_simple') {
    return { ok: false, error: 'Only public_simple launches use Core asset royalties', status: 400 }
  }
  if (launch.mint_standard !== 'core') {
    return { ok: false, error: 'mint_standard must be core', status: 400 }
  }
  const collectionMint = launch.collection_mint?.trim()
  if (!collectionMint) {
    return { ok: false, error: 'Missing collection address — deploy first', status: 400 }
  }
  const plugin = coreRoyaltiesPluginFromLaunch(launch)
  if (!plugin) {
    return { ok: false, error: 'Launch has no royalty recipients', status: 400 }
  }

  const requested = (options?.mints?.length ? options.mints : await collectMintedNftMintsForLaunch(launch.id))
    .map((m) => m.trim())
    .filter(Boolean)
  const max = Math.min(CORE_ROYALTIES_BACKFILL_MAX, Math.max(1, options?.max ?? CORE_ROYALTIES_BACKFILL_MAX))
  const batch = requested.slice(0, max)
  const network = resolveLaunchMintNetwork(launch)
  const results: CoreAssetRoyaltyResult[] = []

  for (const mint of batch) {
    results.push(
      await ensureCoreAssetRoyaltiesPlugin({
        mint,
        collectionMint,
        network,
        plugin,
      })
    )
  }

  return {
    ok: true,
    collection: collectionMint,
    processed: results.length,
    remaining: Math.max(0, requested.length - batch.length),
    results,
  }
}
