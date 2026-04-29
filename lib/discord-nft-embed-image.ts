/**
 * Resolve NFT artwork URLs for Discord embeds: Helius DAS + site `/api/proxy-image` so Discord gets HTTPS.
 */
import { fetchNftImageUriFromHelius } from '@/lib/nft-helius-image'
import { getSiteBaseUrl } from '@/lib/site-config'

/**
 * Discord's embed fetcher often fails on raw IPFS gateways or odd schemes. Prefer our public image
 * proxy so the embed URL is always stable HTTPS under the site's origin (same mechanism as raffle UI).
 */
function discordWebhookImageUrlPreferProxy(originalMetadataUri: string): string | undefined {
  const trimmed = originalMetadataUri.trim()
  if (!trimmed) return undefined
  const base = getSiteBaseUrl().replace(/\/$/, '')
  return `${base}/api/proxy-image?url=${encodeURIComponent(trimmed)}`
}

/**
 * Resolve NFT artwork for Discord embeds (community pool giveaways, partner webhooks).
 * Tries Helius DAS with token id then mint; serves via `/api/proxy-image` so Discord gets a stable HTTPS URL.
 */
export async function resolveNftPrizeImageForDiscordEmbed(
  nftMint: string,
  nftTokenId: string | null | undefined
): Promise<string | undefined> {
  const mint = nftMint.trim()
  if (!mint) return undefined

  const tid = nftTokenId?.trim()
  const idsOrdered = tid && tid !== mint ? [tid, mint] : [mint]

  let raw: string | null | undefined
  for (const assetId of idsOrdered) {
    raw = await fetchNftImageUriFromHelius(assetId)
    if (raw?.trim()) break
  }

  if (!raw?.trim()) return undefined
  return discordWebhookImageUrlPreferProxy(raw)
}
