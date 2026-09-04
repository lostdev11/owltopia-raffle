import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { upsertPlatformProjectFromRaffle } from '@/lib/db/platform-projects'
import { resolveDasCollectionHint } from '@/lib/platform-projects/resolve-das-collection'
import { sanitizeLaunchMintPubkey } from '@/lib/solana/validate-pubkey'

type CreatedRaffleLike = {
  id: string
  prize_type?: string | null
  nft_mint_address?: string | null
  nft_collection_mint?: string | null
  nft_collection_name?: string | null
  image_url?: string | null
  promo_x_handle?: string | null
  creator_wallet?: string | null
  created_by?: string | null
  created_at?: string | null
}

/**
 * After a successful NFT raffle insert: persist collection mint if DAS finds one,
 * then upsert the project index. Never throws to the caller.
 */
export async function recordPlatformProjectFromCreatedRaffle(raffle: CreatedRaffleLike): Promise<void> {
  if (raffle.prize_type !== 'nft') return
  const prizeMint = raffle.nft_mint_address?.trim() || ''
  let collectionMint = sanitizeLaunchMintPubkey(raffle.nft_collection_mint)
  let collectionName = raffle.nft_collection_name?.trim() || null
  let imageUrl = raffle.image_url?.trim() || null

  if (!collectionMint && prizeMint) {
    const das = await resolveDasCollectionHint(prizeMint)
    collectionMint = das.collectionMint
    if (!collectionName && das.collectionName) collectionName = das.collectionName
    if (!imageUrl && das.imageUrl) imageUrl = das.imageUrl
    if (collectionMint) {
      const { error } = await getSupabaseAdmin()
        .from('raffles')
        .update({ nft_collection_mint: collectionMint })
        .eq('id', raffle.id)
      if (error) {
        console.warn('[platform-projects] raffle mint update failed:', error.message)
      }
    }
  }

  if (!collectionMint) return

  await upsertPlatformProjectFromRaffle({
    collectionMint,
    displayName: collectionName || 'Unknown collection',
    imageUrl,
    twitterHandle: raffle.promo_x_handle,
    hostWallet: raffle.creator_wallet || raffle.created_by || null,
    seenAt: raffle.created_at || new Date().toISOString(),
    incrementRaffleCount: true,
  })
}

export function recordPlatformProjectFromCreatedRaffleSafe(raffle: CreatedRaffleLike): void {
  void recordPlatformProjectFromCreatedRaffle(raffle).catch((err) => {
    console.warn('[platform-projects] index upsert skipped:', err)
  })
}
