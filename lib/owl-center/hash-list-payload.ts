import 'server-only'

import { collectMintedNftMintsForLaunch } from '@/lib/owl-center/hash-list'
import {
  formatHashListJson,
  formatHashListText,
  suggestMagicEdenCollectionUrl,
  suggestTensorCollectionUrl,
} from '@/lib/owl-center/marketplace-urls'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { getLaunchCollectionMint, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'

export type HashListPayload = {
  launch_id: string
  slug: string
  mint_count: number
  mints: string[]
  hash_list_text: string
  hash_list_json: string
  suggested_magic_eden_url: string | null
  suggested_tensor_url: string | null
  collection_mint: string | null
  mint_network: 'mainnet' | 'devnet'
  me_submit_hint: string
  tensor_submit_hint: string
}

export async function buildHashListPayloadForLaunch(launchId: string): Promise<HashListPayload | null> {
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return null

  const mints = await collectMintedNftMintsForLaunch(launchId)
  const network = resolveLaunchMintNetwork(launch)
  const collectionMint = getLaunchCollectionMint(launch, network) || launch.collection_mint || ''

  return {
    launch_id: launchId,
    slug: launch.slug,
    mint_count: mints.length,
    mints,
    hash_list_text: formatHashListText(mints),
    hash_list_json: formatHashListJson(mints),
    suggested_magic_eden_url: collectionMint ? suggestMagicEdenCollectionUrl(collectionMint, network) : null,
    suggested_tensor_url: collectionMint ? suggestTensorCollectionUrl(collectionMint) : null,
    collection_mint: collectionMint || null,
    mint_network: network,
    me_submit_hint:
      'Upload hash_list_text to Magic Eden creator hub → Collection → Submit hash list. Then paste collection URL in admin when listed.',
    tensor_submit_hint:
      'Submit collection_mint on Tensor creator tools for verification. Then paste trade URL when listed.',
  }
}
