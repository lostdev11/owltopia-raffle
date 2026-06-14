import 'server-only'

import bs58 from 'bs58'
import { fetchCandyMachine } from '@metaplex-foundation/mpl-candy-machine'
import { fetchMetadata, findMetadataPda, updateV1 } from '@metaplex-foundation/mpl-token-metadata'
import { percentAmount, publicKey, some } from '@metaplex-foundation/umi'

import { getLatestAssetUploadJobForLaunch } from '@/lib/db/owl-center-asset-upload-job'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { ensureMarketplaceRow } from '@/lib/db/owl-center-marketplace'
import { arweaveTxIdFromHttps, normalizeOwlCenterArweaveGatewayUri } from '@/lib/owl-center/arweave-gateway-uri'
import {
  collectionMetadataJsonNeedsWalletFix,
  ensureWalletSafeCollectionMetadataJsonUri,
  ensureWalletSafeTokenMetadataJsonUri,
  tokenMetadataJsonNeedsWalletFix,
} from '@/lib/owl-center/metadata-json-fix'
import { collectMintedNftMintsForLaunch } from '@/lib/owl-center/hash-list'
import { isIrysUploadConfigured } from '@/lib/owl-center/irys-config'
import { launchSellerFeeBasisPoints } from '@/lib/owl-center/royalty'
import {
  buildSugarDeployPackageFromJob,
  sugarConfigLineNameLength,
  sugarConfigLinePrefixName,
  type SugarDeployConfigLine,
} from '@/lib/owl-center/sugar-deploy-package'
import { createIrysDeployerUmi } from '@/lib/owl-center/sugar-deploy-onchain'
import { getLaunchCandyMachineId, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'

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
  collection?: {
    current_name: string | null
    target_name: string
    needs_refresh: boolean
    skip_reason: string | null
  }
}

export type MetadataRefreshMintResult =
  | { mint: string; ok: true; signature: string; name: string; uri: string }
  | { mint: string; ok: false; error: string }

export type MetadataRefreshRunResult =
  | {
      ok: true
      refreshed: MetadataRefreshMintResult[]
      skipped: MetadataRefreshMintResult[]
      collection?: { ok: true; signature: string; name: string; uri: string } | { ok: false; error: string }
    }
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

function cleanOnChainName(name: string | null | undefined): string | null {
  if (!name) return null
  return name.replace(/\0/g, '').trim() || null
}

function indexFromOnChainName(
  name: string | null | undefined,
  collectionName: string,
  configLines: SugarDeployConfigLine[]
): string | null {
  const n = cleanOnChainName(name)
  if (!n) return null

  if (configLines.some((line) => line.name === n)) return n
  if (/^\d+$/.test(n)) return n

  const nameLength = sugarConfigLineNameLength(configLines)
  const prefix = sugarConfigLinePrefixName(collectionName, nameLength)
  if (n.startsWith(prefix)) {
    const rest = n.slice(prefix.length)
    if (/^\d+$/.test(rest) && configLines.some((line) => line.name === rest)) return rest
  }

  const hashMatch = /#\s*(\d+)\s*$/.exec(n)
  if (hashMatch && configLines.some((line) => line.name === hashMatch[1]!)) {
    return hashMatch[1]!
  }

  return null
}

function updateAuthorityMismatchReason(params: {
  onChainAuthority: string
  serverSigner: string
  candyMachineAuthority?: string | null
}): string {
  const { onChainAuthority, serverSigner, candyMachineAuthority } = params
  const cmHint =
    candyMachineAuthority && candyMachineAuthority !== onChainAuthority
      ? ` CM authority ${candyMachineAuthority.slice(0, 8)}…`
      : candyMachineAuthority
        ? ` (CM deploy wallet ${candyMachineAuthority.slice(0, 8)}…)`
        : ''
  return `Update authority is ${onChainAuthority.slice(0, 8)}… — server IRYS signer is ${serverSigner.slice(0, 8)}…. Set IRYS_PRIVATE_KEY to the Candy Machine deploy wallet${cmHint}.`
}

function resolveTokenIndex(
  currentUri: string | null | undefined,
  currentName: string | null | undefined,
  idToIndex: Map<string, string>,
  configLines: SugarDeployConfigLine[],
  collectionName: string
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
  return indexFromOnChainName(currentName, collectionName, configLines)
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
  candyMachineAuthority?: string | null
}): Promise<MetadataRefreshMintPreview> {
  const { mint, uploaded, configLines, collectionName, network, umi, candyMachineAuthority } = params
  const idToIndex = buildArweaveIdToTokenIndex(uploaded)
  let currentName: string | null = null
  let currentUri: string | null = null
  let skipReason: string | null = null
  const serverSigner = String(umi.identity.publicKey)

  try {
    const mintPk = publicKey(mint)
    const md = await fetchMetadata(umi, findMetadataPda(umi, { mint: mintPk }))
    currentName = cleanOnChainName(md.name)
    currentUri = md.uri?.trim() || null
    const onChainUa = String(md.updateAuthority)
    if (onChainUa !== serverSigner) {
      skipReason = updateAuthorityMismatchReason({
        onChainAuthority: onChainUa,
        serverSigner,
        candyMachineAuthority,
      })
    }
  } catch {
    skipReason = 'Could not load on-chain metadata'
  }

  const tokenIndex = resolveTokenIndex(currentUri, currentName, idToIndex, configLines, collectionName)
  const targetUri = tokenIndex ? buildTargetUri(uploaded, tokenIndex, network) : null
  const targetName = tokenIndex ? targetNameForIndex(collectionName, tokenIndex) : null

  if (!skipReason && !tokenIndex) skipReason = 'Could not match mint to metadata index (name/URI)'
  if (!skipReason && !targetUri) skipReason = 'Missing metadata URI in upload job'

  let jsonNeedsFix = false
  if (!skipReason && tokenIndex) {
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
  }

  // Wallet-safe refresh may re-upload JSON to a new Arweave tx id — compare name + on-chain JSON quality.
  const onChainTxId = arweaveTxIdFromHttps(currentUri ?? '')
  const jobTxId = tokenIndex ? arweaveTxIdFromHttps(uploaded[`assets/${tokenIndex}.json`] ?? '') : null
  const uriTxMismatch = Boolean(onChainTxId && jobTxId && onChainTxId !== jobTxId)
  const needsRefresh = Boolean(
    !skipReason && targetName && targetUri && (currentName !== targetName || jsonNeedsFix || uriTxMismatch)
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

async function previewCollectionRefresh(params: {
  collectionMint: string
  collectionName: string
  uploaded: Record<string, string>
  network: 'mainnet' | 'devnet'
  umi: ReturnType<typeof createIrysDeployerUmi>
  candyMachineAuthority?: string | null
}): Promise<MetadataRefreshStatus['collection']> {
  const { collectionMint, collectionName, uploaded, network, umi, candyMachineAuthority } = params
  const targetName = collectionName.slice(0, 32) || 'Collection'
  const serverSigner = String(umi.identity.publicKey)
  let currentName: string | null = null
  let currentUri: string | null = null
  let skipReason: string | null = null

  try {
    const md = await fetchMetadata(umi, findMetadataPda(umi, { mint: publicKey(collectionMint) }))
    currentName = cleanOnChainName(md.name)
    currentUri = md.uri?.trim() || null
    const onChainUa = String(md.updateAuthority)
    if (onChainUa !== serverSigner) {
      skipReason = updateAuthorityMismatchReason({
        onChainAuthority: onChainUa,
        serverSigner,
        candyMachineAuthority,
      })
    }
  } catch {
    skipReason = 'Could not load collection metadata'
  }

  let jsonNeedsFix = false
  if (!skipReason) {
    try {
      jsonNeedsFix = await collectionMetadataJsonNeedsWalletFix({
        uploaded,
        network,
        sourceJsonUri: currentUri,
      })
    } catch {
      jsonNeedsFix = true
    }
  }

  const needsRefresh = Boolean(
    !skipReason && (currentName !== targetName || jsonNeedsFix || !currentUri?.trim())
  )

  return {
    current_name: currentName,
    target_name: targetName,
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
  let mints: MetadataRefreshMintPreview[] = []
  let collectionPreview: MetadataRefreshStatus['collection'] | undefined
  if (enabled && arweaveReady && Boolean(collectionMint) && mintAddresses.length > 0 && job) {
    const pkg = buildSugarDeployPackageFromJob(job, launch)
    const network = resolveLaunchMintNetwork(launch)
    const umi = createIrysDeployerUmi(network)
    let candyMachineAuthority: string | null = null
    const cmId = getLaunchCandyMachineId(launch, network)
    if (cmId) {
      try {
        const cm = await fetchCandyMachine(umi, publicKey(cmId))
        candyMachineAuthority = String(cm.authority)
      } catch {
        candyMachineAuthority = null
      }
    }
    mints = await Promise.all(
      mintAddresses.map((mint) =>
        previewMintRefresh({
          mint,
          uploaded: job.upload_progress.uploaded ?? {},
          configLines: pkg.configLines,
          collectionName: launch.name ?? 'Collection',
          network,
          umi,
          candyMachineAuthority,
        })
      )
    )
    if (collectionMint) {
      collectionPreview = await previewCollectionRefresh({
        collectionMint,
        collectionName: launch.name ?? 'Collection',
        uploaded: job.upload_progress.uploaded ?? {},
        network,
        umi,
        candyMachineAuthority,
      })
    }
  }

  const eligible =
    enabled &&
    launch.mint_mode === 'public_simple' &&
    arweaveReady &&
    Boolean(collectionMint) &&
    mintAddresses.length > 0

  return {
    enabled,
    eligible,
    arweave_ready: arweaveReady,
    mint_mode: launch.mint_mode,
    collection_mint: collectionMint,
    minted_count: mintAddresses.length,
    mint_addresses: mintAddresses,
    mints,
    collection: collectionPreview,
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
  const uploaded = job.upload_progress.uploaded ?? {}
  const refreshed: MetadataRefreshMintResult[] = []
  const skipped: MetadataRefreshMintResult[] = []

  for (const preview of previews) {
    if (preview.skip_reason || !preview.target_name || !preview.token_index) {
      skipped.push({
        mint: preview.mint,
        ok: false,
        error: preview.skip_reason ?? 'Already up to date',
      })
      continue
    }

    let jsonNeedsFix = false
    try {
      jsonNeedsFix = await tokenMetadataJsonNeedsWalletFix({
        uploaded,
        tokenIndex: preview.token_index,
        network,
        sourceJsonUri: preview.current_uri,
      })
    } catch {
      jsonNeedsFix = true
    }

    if (!preview.needs_refresh && !jsonNeedsFix) {
      skipped.push({
        mint: preview.mint,
        ok: false,
        error: 'Already up to date',
      })
      continue
    }

    try {
      const mintPk = publicKey(preview.mint)
      const md = await fetchMetadata(umi, findMetadataPda(umi, { mint: mintPk }))
      const onChainUa = String(md.updateAuthority)
      const serverSigner = String(umi.identity.publicKey)
      if (onChainUa !== serverSigner) {
        skipped.push({
          mint: preview.mint,
          ok: false,
          error: preview.skip_reason ?? updateAuthorityMismatchReason({ onChainAuthority: onChainUa, serverSigner }),
        })
        continue
      }

      const safeJson = await ensureWalletSafeTokenMetadataJsonUri({
        uploaded,
        tokenIndex: preview.token_index,
        network,
        sourceJsonUri: preview.current_uri,
        displayName: preview.target_name,
      })
      if (!safeJson?.uri) {
        skipped.push({ mint: preview.mint, ok: false, error: 'Could not build wallet-safe metadata JSON' })
        continue
      }

      const res = await updateV1(umi, {
        mint: mintPk,
        authority: umi.identity,
        data: some({
          name: preview.target_name,
          symbol: md.symbol || (launch.symbol ?? 'COL').slice(0, 10),
          uri: safeJson.uri,
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
        uri: safeJson.uri,
      })
    } catch (e) {
      skipped.push({
        mint: preview.mint,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  let collection:
    | { ok: true; signature: string; name: string; uri: string }
    | { ok: false; error: string }
    | undefined

  const collectionMint = status.collection_mint?.trim()
  if (collectionMint && status.collection?.needs_refresh && !status.collection.skip_reason) {
    try {
      const colPk = publicKey(collectionMint)
      const colMd = await fetchMetadata(umi, findMetadataPda(umi, { mint: colPk }))
      const onChainUa = String(colMd.updateAuthority)
      const serverSigner = String(umi.identity.publicKey)
      if (onChainUa !== serverSigner) {
        collection = {
          ok: false,
          error: updateAuthorityMismatchReason({ onChainAuthority: onChainUa, serverSigner }),
        }
      } else {
        const targetName = status.collection.target_name
        const safeCol = await ensureWalletSafeCollectionMetadataJsonUri({
          uploaded,
          collectionName: targetName,
          network,
          sourceJsonUri: colMd.uri,
        })
        if (!safeCol?.uri) {
          collection = { ok: false, error: 'Could not build wallet-safe collection metadata JSON' }
        } else {
          const res = await updateV1(umi, {
            mint: colPk,
            authority: umi.identity,
            data: some({
              name: targetName,
              symbol: colMd.symbol || (launch.symbol ?? 'COL').slice(0, 10),
              uri: safeCol.uri,
              sellerFeeBasisPoints: colMd.sellerFeeBasisPoints ?? percentAmount(royaltyPercent),
              creators: colMd.creators,
            }),
          }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
          const sig = res.signature
          const sigStr = typeof sig === 'string' ? sig : bs58.encode(sig)
          collection = { ok: true, signature: sigStr, name: targetName, uri: safeCol.uri }
        }
      }
    } catch (e) {
      collection = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  return { ok: true, refreshed, skipped, collection }
}
