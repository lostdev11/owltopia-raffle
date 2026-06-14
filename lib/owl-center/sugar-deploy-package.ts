import 'server-only'

import type { AssetUploadProgress } from '@/lib/owl-center/asset-upload-types'
import type { OwlCenterAssetUploadJob } from '@/lib/owl-center/asset-upload-types'
import { publicSimpleSugarGuardsConfig } from '@/lib/owl-center/sugar-public-simple-guards'
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

/** Build Sugar config + cache items from a completed Phase B upload job. */
export function buildSugarDeployPackageFromJob(
  job: OwlCenterAssetUploadJob,
  launch: Pick<OwlCenterLaunchPublic, 'name' | 'symbol' | 'total_supply' | 'creator_wallet'>
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
  const collectionMetadataUri = uploaded['assets/collection.json']?.trim() || null

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

  const config = {
    tokenStandard: 'nft',
    number: supply,
    symbol: launch.symbol ?? 'COL',
    sellerFeeBasisPoints: 500,
    isMutable: true,
    isSequential: false,
    creators: [{ address: creator, share: 100 }],
    uploadMethod: 'bundlr',
    ruleSet: null,
    awsConfig: null,
    sdriveApiKey: null,
    pinataConfig: null,
    hiddenSettings: null,
    guards: publicSimpleSugarGuardsConfig(),
    maxEditionSupply: null,
  }

  return { config, cacheItems, configLines, collectionMetadataUri, supply }
}

export function parseOnchainDeployState(progress: AssetUploadProgress) {
  const raw = (progress as AssetUploadProgress & { onchain_deploy?: unknown }).onchain_deploy
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const status = o.status
  if (status !== 'running' && status !== 'completed' && status !== 'failed') return null
  return {
    status,
    candy_machine_id: typeof o.candy_machine_id === 'string' ? o.candy_machine_id : null,
    collection_mint: typeof o.collection_mint === 'string' ? o.collection_mint : null,
    candy_guard_id: typeof o.candy_guard_id === 'string' ? o.candy_guard_id : null,
    error: typeof o.error === 'string' ? o.error : null,
    completed_at: typeof o.completed_at === 'string' ? o.completed_at : null,
  }
}
