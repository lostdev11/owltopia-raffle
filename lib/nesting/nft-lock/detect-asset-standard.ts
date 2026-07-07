import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import type { ResolvedNftLockStandard } from '@/lib/nesting/nft-lock/types'

type DasAssetInterface = {
  interface?: string
  id?: string
}

/**
 * Map Helius DAS `interface` to a nest lock standard.
 * @see https://docs.helius.dev/compression-and-das-api/digital-asset-standard-das-api
 */
export function resolvedLockStandardFromDasInterface(
  iface: string | null | undefined
): ResolvedNftLockStandard {
  const v = (iface ?? '').trim()
  if (v === 'MplCoreAsset' || v === 'MplCoreCollection') {
    return 'mpl_core_freeze_delegate'
  }
  // Legacy TM, pNFT, and most partner Candy Machine mints.
  if (
    v === 'V1_NFT' ||
    v === 'ProgrammableNFT' ||
    v === 'Custom' ||
    v === 'Legacy' ||
    v === 'V1_PRINT' ||
    v === 'V2_NFT'
  ) {
    return 'spl_token_account_freeze'
  }
  // Compressed NFTs need a dedicated adapter later; default to SPL path for clear errors.
  if (v === 'V1_NFT_COMPRESSED' || v === 'MplCoreAssetV1') {
    return 'spl_token_account_freeze'
  }
  return 'spl_token_account_freeze'
}

export async function detectResolvedNftLockStandardFromAsset(
  assetId: string
): Promise<ResolvedNftLockStandard | null> {
  const mint = assetId.trim()
  if (!mint) return null

  const heliusUrl = getHeliusMainnetRpcUrl()
  if (!heliusUrl) return null

  try {
    const res = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'nesting-detect-lock-standard',
        method: 'getAsset',
        params: { id: mint },
      }),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = (await res.json().catch(() => null)) as {
      result?: DasAssetInterface
      error?: { message?: string }
    } | null
    if (!json?.result) return null
    return resolvedLockStandardFromDasInterface(json.result.interface)
  } catch {
    return null
  }
}
