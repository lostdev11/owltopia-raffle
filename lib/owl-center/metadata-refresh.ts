import 'server-only'

import bs58 from 'bs58'
import { fetchMetadata, findMetadataPda, updateV1 } from '@metaplex-foundation/mpl-token-metadata'
import { percentAmount, publicKey, some } from '@metaplex-foundation/umi'

import { getLatestAssetUploadJobForLaunch } from '@/lib/db/owl-center-asset-upload-job'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { ensureMarketplaceRow } from '@/lib/db/owl-center-marketplace'
import { arweaveTxIdFromHttps, normalizeOwlCenterArweaveGatewayUri } from '@/lib/owl-center/arweave-gateway-uri'
import { collectMintedNftMintsForLaunch } from '@/lib/owl-center/hash-list'
import { isIrysUploadConfigured } from '@/lib/owl-center/irys-config'
import { launchSellerFeeBasisPoints } from '@/lib/owl-center/royalty'
import {
  buildSugarDeployPackageFromJob,
  sugarConfigLinePrefixName,
  type SugarDeployConfigLine,
} from '@/lib/owl-center/sugar-deploy-package'
import { createIrysDeployerUmi } from '@/lib/owl-center/sugar-deploy-onchain'
import { resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'

export type MetadataRefreshMintPreview = {
  mint: string
  token_index: string | null
  current_name: string | null
  current_uri: string | null
  target_name: string | null
  target_uri: string | null
  needs_refresh: boolean
  skip_reason: string | null
}

export type MetadataRefreshStatus = {
  enabled: boolean
  eligible: boolean
  arweave_ready: boolean
  mint_mode: string | null
  collection_mint: string | null
  minted_count: number
  mint_addresses: string[]
  mints: MetadataRefreshMintPreview[]
}

export type MetadataRefreshMintResult =
  | { mint: string; ok: true; signature: string; name: string; uri: string }
  | { mint: string; ok: false; error: string }

export type MetadataRefreshRunResult =
  | { ok: true; refreshed: MetadataRefreshMintResult[]; skipped: MetadataRefreshMintResult[] }
  | { ok: false; error: string; code?: string }

function buildArweaveIdToTokenIndex(uploaded: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [path, uri] of Object.entries(uploaded)) {
    const norm = path.replace(/\\/g, '/')
    const m = /^assets\/(\d+)\.json$/i.exec(norm)
    if (!m) continue
    const id = arweaveTxIdFromHttps(uri)
    if (id) map.set(id, m[1]!)
  }
  return map
}

function targetNameForIndex(collectionName: string, index: string): string {
  const prefix = sugarConfigLinePrefixName(collectionName, index.length)
  return `${prefix}${index}`.slice(0, 32)
}

function resolveTokenIndex(
  currentUri: string | null | undefined,
  idToIndex: Map<string, string>,
  configLines: SugarDeployConfigLine[]
): string | null {
  const id = currentUri ? arweaveTxIdFromHttps(currentUri) : null
  if (id && idToIndex.has(id)) return idToIndex.get(id) ?? null
  if (currentUri?.trim()) {
    for (const line of configLines) {
      if (line.uri === currentUri.trim()) return line.name
      const curId = arweaveTxIdFromHttps(currentUri)
      const lineId = arweaveTxIdFromHttps(line.uri)
      if (curId && lineId && curId === lineId) return line.name
    }
  }
  return null
}

function buildTargetUri(
  uploaded: Record<string, string>,
  index: string,
  network: 'mainnet' | 'devnet'
): string | null {
  const raw = uploaded[`assets/${index}.json`]?.trim()
  if (!raw) return null
  return normalizeOwlCenterArweaveGatewayUri(raw, network)
}

async function previewMintRefresh(params: {
  mint: string
  uploaded: Record<string, string>
  configLines: SugarDeployConfigLine[]
  collectionName: string
  network: 'mainnet' | 'devnet'
  umi: ReturnType<typeof createIrysDeployerUmi>
}): Promise<MetadataRefreshMintPreview> {
  const { mint, uploaded, configLines, collectionName, network, umi } = params
  const idToIndex = buildArweaveIdToTokenIndex(uploaded)
  let currentName: string | null = null
  let currentUri: string | null = null
  let skipReason: string | null = null

  try {
    const mintPk = publicKey(mint)
    const md = await fetchMetadata(umi, findMetadataPda(umi, { mint: mintPk }))
    currentName = md.name
    currentUri = md.uri
    if (String(md.updateAuthority) !== String(umi.identity.publicKey)) {
      skipReason = 'Update authority is not the IRYS deployer wallet'
    }
  } catch {
    skipReason = 'Could not load on-chain metadata'
  }

  const tokenIndex = resolveTokenIndex(currentUri, idToIndex, configLines)
  const targetUri = tokenIndex ? buildTargetUri(uploaded, tokenIndex, network) : null
  const targetName = tokenIndex ? targetNameForIndex(collectionName, tokenIndex) : null

  if (!skipReason && !tokenIndex) skipReason = 'Could not match mint to Arweave metadata index'
  if (!skipReason && !targetUri) skipReason = 'Missing metadata URI in upload job'

  const needsRefresh = Boolean(
    !skipReason &&
      targetName &&
      targetUri &&
      (currentName !== targetName || normalizeOwlCenterArweaveGatewayUri(currentUri ?? '', network) !== targetUri)
  )

  return {
    mint,
    token_index: tokenIndex,
    current_name: currentName,
    current_uri: currentUri,
    target_name: targetName,
    target_uri: targetUri,
    needs_refresh: needsRefresh,
    skip_reason: skipReason,
  }
}

export async function getMetadataRefreshStatusForLaunch(launchId: string): Promise<MetadataRefreshStatus | null> {
  const [launch, job, marketplace, mintAddresses] = await Promise.all([
    getOwlCenterLaunchByIdAdmin(launchId),
    getLatestAssetUploadJobForLaunch(launchId),
    ensureMarketplaceRow(launchId),
    collectMintedNftMintsForLaunch(launchId),
  ])

  if (!launch) return null

  const enabled = isIrysUploadConfigured()
  const arweaveReady = job?.status === 'completed'
  const collectionMint = marketplace?.collection_mint?.trim() || launch.collection_mint?.trim() || null
  const eligible =
    enabled &&
    launch.mint_mode === 'public_simple' &&
    arweaveReady &&
    Boolean(collectionMint) &&
    mintAddresses.length > 0

  let mints: MetadataRefreshMintPreview[] = []
  if (eligible && job) {
    const pkg = buildSugarDeployPackageFromJob(job, launch)
    const network = resolveLaunchMintNetwork(launch)
    const umi = createIrysDeployerUmi(network)
    mints = await Promise.all(
      mintAddresses.map((mint) =>
        previewMintRefresh({
          mint,
          uploaded: job.upload_progress.uploaded ?? {},
          configLines: pkg.configLines,
          collectionName: launch.name ?? 'Collection',
          network,
          umi,
        })
      )
    )
  }

  return {
    enabled,
    eligible,
    arweave_ready: arweaveReady,
    mint_mode: launch.mint_mode,
    collection_mint: collectionMint,
    minted_count: mintAddresses.length,
    mint_addresses: mintAddresses,
    mints,
  }
}

export async function runMetadataRefreshForLaunch(
  launchId: string,
  opts?: { mints?: string[] }
): Promise<MetadataRefreshRunResult> {
  if (!isIrysUploadConfigured()) {
    return { ok: false, error: 'IRYS_PRIVATE_KEY is not configured on the server.', code: 'disabled' }
  }

  const status = await getMetadataRefreshStatusForLaunch(launchId)
  if (!status) return { ok: false, error: 'Launch not found', code: 'not_found' }
  if (!status.eligible) {
    return {
      ok: false,
      error: 'Refresh not available — need public_simple launch, Arweave upload, collection mint, and recorded mints.',
      code: 'not_eligible',
    }
  }

  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  const job = await getLatestAssetUploadJobForLaunch(launchId)
  if (!launch || !job) return { ok: false, error: 'Launch or upload job not found', code: 'not_found' }

  const requested = (opts?.mints?.length ? opts.mints : status.mint_addresses).map((m) => m.trim()).filter(Boolean)
  const previews = status.mints.filter((m) => requested.includes(m.mint))
  if (!previews.length) {
    return { ok: false, error: 'No matching mint addresses to refresh', code: 'no_mints' }
  }

  const network = resolveLaunchMintNetwork(launch)
  const umi = createIrysDeployerUmi(network)
  const royaltyPercent = launchSellerFeeBasisPoints(launch) / 100
  const refreshed: MetadataRefreshMintResult[] = []
  const skipped: MetadataRefreshMintResult[] = []

  for (const preview of previews) {
    if (!preview.needs_refresh || preview.skip_reason || !preview.target_name || !preview.target_uri) {
      skipped.push({
        mint: preview.mint,
        ok: false,
        error: preview.skip_reason ?? 'Already up to date',
      })
      continue
    }

    try {
      const mintPk = publicKey(preview.mint)
      const md = await fetchMetadata(umi, findMetadataPda(umi, { mint: mintPk }))
      if (String(md.updateAuthority) !== String(umi.identity.publicKey)) {
        skipped.push({ mint: preview.mint, ok: false, error: 'Update authority is not the IRYS deployer wallet' })
        continue
      }

      const res = await updateV1(umi, {
        mint: mintPk,
        authority: umi.identity,
        data: some({
          name: preview.target_name,
          symbol: md.symbol || (launch.symbol ?? 'COL').slice(0, 10),
          uri: preview.target_uri,
          sellerFeeBasisPoints: md.sellerFeeBasisPoints ?? percentAmount(royaltyPercent),
          creators: md.creators,
        }),
      }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

      const sig = res.signature
      const sigStr = typeof sig === 'string' ? sig : bs58.encode(sig)
      refreshed.push({
        mint: preview.mint,
        ok: true,
        signature: sigStr,
        name: preview.target_name,
        uri: preview.target_uri,
      })
    } catch (e) {
      skipped.push({
        mint: preview.mint,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return { ok: true, refreshed, skipped }
}
