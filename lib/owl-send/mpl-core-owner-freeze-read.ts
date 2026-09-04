/**
 * Read-only: is this asset an MPL Core NFT frozen under Owner FreezeDelegate?
 * Used before OwlSend Core transfer so we never fall through to Token Metadata noise.
 */

import type { Connection } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey } from '@metaplex-foundation/umi'
import { fetchAsset } from '@metaplex-foundation/mpl-core'
import { readMplCoreFreezeDelegate } from '@/lib/solana/mpl-core-nest-lock'
import { isMplCoreWrongAccountTypeError } from '@/lib/solana/mpl-core-transfer-errors'
import { resolveMetaplexClientRpcUrl } from '@/lib/solana-rpc-url'
import { isDasMplCoreInterface } from '@/lib/solana/prize-nft-standard'

export type OwlSendCoreOwnerFreezeCheck =
  | { kind: 'not_core' }
  | { kind: 'not_frozen' }
  | { kind: 'owner_frozen' }
  | { kind: 'other_frozen'; authorityType: string | null }
  | { kind: 'read_failed'; error: string }

export async function readOwlSendCoreOwnerFreeze(params: {
  connection: Connection
  assetId: string
  /** DAS interface hint — skip RPC when clearly not Core. */
  interfaceHint?: string | null
}): Promise<OwlSendCoreOwnerFreezeCheck> {
  const assetId = params.assetId.trim()
  if (!assetId) return { kind: 'not_core' }

  if (
    params.interfaceHint != null &&
    params.interfaceHint.trim() !== '' &&
    !isDasMplCoreInterface(params.interfaceHint)
  ) {
    return { kind: 'not_core' }
  }

  try {
    const endpoint = resolveMetaplexClientRpcUrl(params.connection)
    const umi = createUmi(endpoint)
    const assetAccount = await fetchAsset(umi as any, publicKey(assetId))
    const fd = readMplCoreFreezeDelegate(assetAccount)
    if (!fd?.frozen) return { kind: 'not_frozen' }
    if (fd.authorityType === 'Owner') return { kind: 'owner_frozen' }
    return { kind: 'other_frozen', authorityType: fd.authorityType }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isMplCoreWrongAccountTypeError(msg)) return { kind: 'not_core' }
    return { kind: 'read_failed', error: msg }
  }
}
