import 'server-only'

import bs58 from 'bs58'
import { fetchAsset, fetchCollection, update } from '@metaplex-foundation/mpl-core'
import { publicKey } from '@metaplex-foundation/umi'

import { getLatestAssetUploadJobForLaunch } from '@/lib/db/owl-center-asset-upload-job'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { createIrysDeployerCoreUmi } from '@/lib/owl-center/core-cm-deploy-onchain'
import { coreCollectionAllowsUmiUpdates } from '@/lib/owl-center/core-ua-authority'
import {
  ensureWalletSafeTokenMetadataJsonUri,
  tokenMetadataJsonNeedsWalletFix,
} from '@/lib/owl-center/metadata-json-fix'
import { metadataRoyaltyFromLaunch } from '@/lib/owl-center/metadata-royalty'
import type {
  MetadataRefreshMintResult,
  MetadataRefreshRunResult,
} from '@/lib/owl-center/metadata-refresh'
import { buildSugarDeployPackageFromJob } from '@/lib/owl-center/sugar-deploy-package'
import { collectMintedNftMintsForLaunch } from '@/lib/owl-center/hash-list'
import { resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'

function signatureToString(sig: unknown): string {
  if (typeof sig === 'string') return sig
  if (sig instanceof Uint8Array) return bs58.encode(sig)
  return String(sig)
}

/**
 * Core metadata refresh using platform UpdateDelegate (or root UA).
 * Token Metadata refresh remains in metadata-refresh.ts.
 */
export async function runCoreMetadataRefreshForLaunch(
  launchId: string,
  opts?: { mints?: string[] }
): Promise<MetadataRefreshRunResult> {
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return { ok: false, error: 'Launch not found', code: 'not_found' }
  if (launch.mint_standard !== 'core') {
    return { ok: false, error: 'Core metadata refresh requires mint_standard=core', code: 'not_eligible' }
  }
  const collectionMint = launch.collection_mint?.trim()
  if (!collectionMint) {
    return { ok: false, error: 'Missing collection mint — deploy first', code: 'not_eligible' }
  }

  const job = await getLatestAssetUploadJobForLaunch(launchId)
  if (!job) return { ok: false, error: 'Upload job not found', code: 'not_found' }

  const network = resolveLaunchMintNetwork(launch)
  const umi = createIrysDeployerCoreUmi(network)
  const allowed = await coreCollectionAllowsUmiUpdates(umi, collectionMint)
  if (!allowed.ok) {
    return { ok: false, error: allowed.reason, code: 'ua_mismatch' }
  }

  const pkg = buildSugarDeployPackageFromJob(job, launch)
  const linesByName = new Map(pkg.configLines.map((l) => [l.name, l]))
  const allMints = await collectMintedNftMintsForLaunch(launchId)
  const requested = (opts?.mints?.length ? opts.mints : allMints).map((m) => m.trim()).filter(Boolean)

  const collection = await fetchCollection(umi, publicKey(collectionMint))
  const uploaded = job.upload_progress?.uploaded ?? {}
  const refreshed: MetadataRefreshMintResult[] = []
  const skipped: MetadataRefreshMintResult[] = []

  for (const mint of requested) {
    try {
      const asset = await fetchAsset(umi, publicKey(mint), { skipDerivePlugins: true })
      const currentName = String(asset.name ?? '')
      const currentUri = String(asset.uri ?? '')

      // Match by trailing index in name (e.g. "Breppe #12" → "12") or exact config uri.
      const indexMatch = /#\s*(\d+)\s*$/.exec(currentName)
      let tokenIndex = indexMatch?.[1] ?? null
      if (!tokenIndex) {
        for (const line of pkg.configLines) {
          if (line.uri === currentUri) {
            tokenIndex = line.name
            break
          }
        }
      }
      if (!tokenIndex || !linesByName.has(tokenIndex)) {
        skipped.push({ mint, ok: false, error: 'Could not match Core asset to config line' })
        continue
      }

      const line = linesByName.get(tokenIndex)!
      const targetName = `${(launch.name || 'Collection').slice(0, 24)} #${tokenIndex}`
      let needs = currentName !== targetName || currentUri !== line.uri
      let jsonNeedsFix = false
      try {
        jsonNeedsFix = await tokenMetadataJsonNeedsWalletFix({
          uploaded,
          tokenIndex,
          network,
          sourceJsonUri: currentUri,
        })
      } catch {
        jsonNeedsFix = true
      }
      if (!needs && !jsonNeedsFix) {
        skipped.push({ mint, ok: false, error: 'Already up to date' })
        continue
      }

      const safeJson = await ensureWalletSafeTokenMetadataJsonUri({
        uploaded,
        tokenIndex,
        network,
        sourceJsonUri: currentUri,
        displayName: targetName,
        collectionName: launch.name,
        royalty: metadataRoyaltyFromLaunch(launch),
      })
      if (!safeJson?.uri) {
        skipped.push({ mint, ok: false, error: 'Could not build wallet-safe metadata JSON' })
        continue
      }

      const result = await update(umi, {
        asset,
        collection,
        name: targetName,
        uri: safeJson.uri,
      }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

      refreshed.push({
        mint,
        ok: true,
        signature: signatureToString(result.signature),
        name: targetName,
        uri: safeJson.uri,
      })
    } catch (e) {
      skipped.push({ mint, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return {
    ok: true,
    refreshed,
    skipped,
    collection: undefined,
  }
}
