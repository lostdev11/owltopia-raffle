'use client'

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey } from '@metaplex-foundation/umi'
import { fetchAsset } from '@metaplex-foundation/mpl-core'
import type { Connection } from '@solana/web3.js'
import { resolveMetaplexClientRpcUrl } from '@/lib/solana-rpc-url'

/** Single fetchAsset read — used after expiry errors to see if deposit already landed. */
export async function fetchMplCoreAssetOwnerB58(
  connection: Connection,
  assetId: string
): Promise<string | null> {
  const endpoint = resolveMetaplexClientRpcUrl(connection)
  const umi = createUmi(endpoint)
  const asset: { owner?: { toString(): string } } = await fetchAsset(umi as any, publicKey(assetId))
  return asset.owner?.toString() ?? null
}
