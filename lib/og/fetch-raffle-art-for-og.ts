import { buildOgArtFetchAttemptChain, toOgArtFetchUrl } from '@/lib/og/build-og-art-fetch-urls'
import { fetchImageDataUrlForOg } from '@/lib/og/fetch-image-data-url-for-og'
import { fetchNftImageUriFromHelius } from '@/lib/nft-helius-image'
import type { Raffle } from '@/lib/types'

/**
 * Load raffle prize art as a data URL for Satori / `next/og`. Tries proxy-wrapped fetch URLs, then
 * Helius DAS when stored metadata URLs fail (common for NFT prize raffles on X).
 */
export async function fetchRaffleArtDataUrlForOg(
  raffle: Pick<Raffle, 'image_url' | 'image_fallback_url' | 'nft_mint_address' | 'nft_token_id'>,
  siteBase: string
): Promise<string | null> {
  for (const fetchUrl of buildOgArtFetchAttemptChain(
    siteBase,
    raffle.image_url,
    raffle.image_fallback_url
  )) {
    const data = await fetchImageDataUrlForOg(fetchUrl)
    if (data) return data
  }

  const mint = raffle.nft_mint_address?.trim()
  if (!mint) return null

  const assetId = raffle.nft_token_id?.trim() || mint
  const heliusUri = await fetchNftImageUriFromHelius(assetId, { preferMainnet: true })
  if (!heliusUri?.trim()) return null

  const fetchUrl = toOgArtFetchUrl(heliusUri, siteBase)
  if (!fetchUrl) return null
  return fetchImageDataUrlForOg(fetchUrl)
}
