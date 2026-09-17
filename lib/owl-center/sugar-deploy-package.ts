import 'server-only'

import type { AssetUploadProgress } from '@/lib/owl-center/asset-upload-types'
import type { OwlCenterAssetUploadJob } from '@/lib/owl-center/asset-upload-types'
import { publicSimpleGuardOptsFromLaunch, publicSimpleSugarGuardsConfig } from '@/lib/owl-center/sugar-public-simple-guards'
import { launchSellerFeeBasisPoints } from '@/lib/owl-center/royalty'
import { walletSplitsToMetaplexCreators } from '@/lib/owl-center/wallet-splits'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export type SugarDeployConfigLine = { name: string; uri: string }

export type SugarDeployPackage = {
  config: Record<string, unknown>
  cacheItems: Record<string, unknown>
  configLines: SugarDeployConfigLine[]
  collectionMetadataUri: string | null
  supply: number
}

function tokenIndexFromPath(path: string): string | null {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path
  const m = /^(\d+)\.json$/i.exec(base)
  return m ? m[1] : null
}

/** On-chain NFT name = prefixName + config line name (e.g. "Papers #" + "2" → "Papers #2"). */
export function sugarConfigLinePrefixName(collectionName: string, indexDigitLength: number): string {
  const base = (collectionName || 'Collection').trim() || 'Collection'
  const suffix = ' #'
  const maxTotal = 32
  const maxPrefix = Math.max(1, maxTotal - Math.max(1, indexDigitLength))
  const trimmed = base.slice(0, Math.max(1, maxPrefix - suffix.length))
  return `${trimmed}${suffix}`
}

export function sugarConfigLineNameLength(configLines: SugarDeployConfigLine[]): number {
  return Math.max(1, ...configLines.map((l) => l.name.length))
}

/** Build Sugar config + cache items from a completed Phase B upload job. */
export function buildSugarDeployPackageFromJob(
  job: OwlCenterAssetUploadJob,
  launch: Pick<
    OwlCenterLaunchPublic,
    | 'name'
    | 'symbol'
    | 'total_supply'
    | 'creator_wallet'
    | 'royalty_splits'
    | 'seller_fee_basis_points'
    | 'reveal_mode'
    | 'placeholder_metadata_uri'
    | 'wallet_mint_limit'
    | 'launch_deadline_at'
    | 'phase_schedule'
    | 'creator_wl_enabled'
    | 'creator_presale_enabled'
    | 'wl_supply'
    | 'presale_supply'
  >
): SugarDeployPackage {
  const uploaded = job.upload_progress.uploaded ?? {}
  const configLines: SugarDeployConfigLine[] = []

  for (const [path, uri] of Object.entries(uploaded)) {
    const norm = path.replace(/\\/g, '/')
    if (!norm.match(/assets\/\d+\.json$/i)) continue
    const index = tokenIndexFromPath(norm)
    if (!index || !uri.trim()) continue
    configLines.push({ name: index, uri: uri.trim() })
  }

  configLines.sort((a, b) => Number(a.name) - Number(b.name))

  const supply = configLines.length || launch.total_supply || 0
  let collectionMetadataUri = uploaded['assets/collection.json']?.trim() || null

  const placeholderUri = launch.placeholder_metadata_uri?.trim()
  if (launch.reveal_mode === 'reveal_day' && placeholderUri) {
    for (const line of configLines) {
      line.uri = placeholderUri
    }
    collectionMetadataUri = placeholderUri
  }

  const cacheItems: Record<string, unknown> = {}
  for (const line of configLines) {
    const png = uploaded[`assets/${line.name}.png`]
    cacheItems[line.name] = {
      name: line.name,
      metadata_link: line.uri,
      image_link: png ?? '',
      onChain: false,
    }
  }
  if (collectionMetadataUri) {
    cacheItems['-1'] = {
      name: 'collection',
      metadata_link: collectionMetadataUri,
      image_link: uploaded['assets/collection.png'] ?? uploaded['assets/0.png'] ?? '',
      onChain: false,
    }
  }

  const creator = launch.creator_wallet?.trim() || 'REPLACE_WITH_DEPLOYER_WALLET'
  const sellerFeeBasisPoints = launchSellerFeeBasisPoints(launch)
  const metaplexCreators = walletSplitsToMetaplexCreators(launch.royalty_splits, creator)

  const nameLength = sugarConfigLineNameLength(configLines)
  const prefixName = sugarConfigLinePrefixName(launch.name ?? 'Collection', nameLength)
  const uriLength = Math.max(32, ...configLines.map((l) => l.uri.length))

  const config = {
    tokenStandard: 'nft',
    number: supply,
    symbol: launch.symbol ?? 'COL',
    sellerFeeBasisPoints,
    isMutable: true,
    isSequential: false,
    creators: metaplexCreators,
    uploadMethod: 'bundlr',
    ruleSet: null,
    awsConfig: null,
    sdriveApiKey: null,
    pinataConfig: null,
    hiddenSettings: null,
    configLineSettings: {
      prefixName,
      nameLength,
      prefixUri: '',
      uriLength,
      isSequential: false,
    },
    guards: publicSimpleSugarGuardsConfig(publicSimpleGuardOptsFromLaunch(launch)),
    maxEditionSupply: null,
  }

  return { config, cacheItems, configLines, collectionMetadataUri, supply }
}

export type { OnchainDeployStatus, OnchainDeployState } from '@/lib/owl-center/onchain-deploy-state'
export { parseOnchainDeployState, configLinesFullyLoaded } from '@/lib/owl-center/onchain-deploy-state'

