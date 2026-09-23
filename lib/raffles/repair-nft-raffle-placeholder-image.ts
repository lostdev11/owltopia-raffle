import { updateRaffle } from '@/lib/db/raffles'
import { fetchNftImageUriFromHelius } from '@/lib/nft-helius-image'
import { isLegacyOwltopiaPlaceholderImageUrl } from '@/lib/raffle-display-image-url'
import type { Raffle } from '@/lib/types'

/**
 * When an NFT raffle has no listing art (or only the site brand mark), resolve
 * the prize mint via Helius DAS and persist `image_url` so browse/OG/Discord
 * stop depending on per-request mint fallback.
 */
export async function repairNftRafflePlaceholderImage(
  raffle: Pick<Raffle, 'id' | 'prize_type' | 'image_url' | 'nft_mint_address' | 'nft_token_id'>
): Promise<string | null> {
  if ((raffle.prize_type || '').toLowerCase() !== 'nft') return null
  const stored = raffle.image_url?.trim() || ''
  if (stored && !isLegacyOwltopiaPlaceholderImageUrl(stored)) return null

  const assetId = (raffle.nft_token_id || raffle.nft_mint_address || '').trim()
  if (!assetId) return null

  const resolved = (await fetchNftImageUriFromHelius(assetId, { preferMainnet: true }))?.trim()
  if (!resolved || isLegacyOwltopiaPlaceholderImageUrl(resolved)) return null

  try {
    await updateRaffle(raffle.id, { image_url: resolved })
    return resolved
  } catch (err) {
    console.error('[repairNftRafflePlaceholderImage]', raffle.id, err)
    return null
  }
}
