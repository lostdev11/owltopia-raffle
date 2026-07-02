/**
 * Resolve NFT artwork URLs for Discord embeds: Helius DAS + site `/api/proxy-image` so Discord gets HTTPS.
 */
import { fetchNftImageUriFromHelius } from '@/lib/nft-helius-image'
import {
  arweaveUriToHttps,
  isIrysGatewayHttpsUrl,
  isIrysUploaderHttpsUrl,
  unwrapHeliusCdnImageUrl,
} from '@/lib/nft-media-uri'
import { getSiteBaseUrl } from '@/lib/site-config'

function siteOriginsForMatch(): string[] {
  const base = getSiteBaseUrl().replace(/\/$/, '').toLowerCase()
  const origins = new Set<string>([base])
  try {
    const u = new URL(base)
    if (u.hostname.startsWith('www.')) {
      origins.add(`${u.protocol}//${u.hostname.slice(4)}`.toLowerCase())
    } else {
      origins.add(`${u.protocol}//www.${u.hostname}`.toLowerCase())
    }
  } catch {
    /* ignore */
  }
  return [...origins]
}

function isOwltopiaProxyImageUrl(uri: string): boolean {
  const lower = uri.trim().toLowerCase()
  return siteOriginsForMatch().some((origin) => lower.startsWith(`${origin}/api/proxy-image`))
}

/** DAS often indexes gateway.irys / Helius CDN before arweave.net art is wired — not safe to stop resolving. */
export function isReliableDiscordFeedImageUri(uri: string): boolean {
  const trimmed = uri.trim()
  if (!trimmed) return false

  if (isOwltopiaProxyImageUrl(trimmed)) return true

  const inner = unwrapHeliusCdnImageUrl(trimmed) ?? trimmed
  if (/arweave\.net\//i.test(inner)) return true
  if (/ar-io\.net\//i.test(inner)) return true
  if (isIrysGatewayHttpsUrl(inner) || isIrysUploaderHttpsUrl(inner)) return false
  if (unwrapHeliusCdnImageUrl(trimmed) && !/arweave\.net\//i.test(inner)) return false

  return /^https?:\/\//i.test(trimmed)
}

/**
 * Discord embed image URL. Prefer direct arweave.net (Discord crawls it reliably); proxy only for
 * IPFS / Irys / other schemes. Avoids double-wrapping existing Owltopia proxy URLs (www vs apex).
 */
export function discordEmbedImageUrlFromRaw(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined

  if (isOwltopiaProxyImageUrl(trimmed)) return trimmed

  const inner = unwrapHeliusCdnImageUrl(trimmed) ?? trimmed
  const arHttps = arweaveUriToHttps(inner)
  if (arHttps && /arweave\.net\//i.test(arHttps)) return arHttps
  if (/^https?:\/\/([a-z0-9-]+\.)*arweave\.net\//i.test(inner)) return inner
  if (/^https:\/\/ar-io\.net\//i.test(inner)) return inner

  return discordWebhookImageUrlFromRaw(trimmed)
}

/**
 * Discord's embed fetcher often fails on raw IPFS gateways or odd schemes. Prefer our public image
 * proxy so the embed URL is always stable HTTPS under the site's origin (same mechanism as raffle UI).
 * Skips double-wrapping when the URI is already our proxy endpoint.
 */
export function discordWebhookImageUrlFromRaw(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined

  if (isOwltopiaProxyImageUrl(trimmed)) return trimmed

  const inner = unwrapHeliusCdnImageUrl(trimmed) ?? trimmed
  const base = getSiteBaseUrl().replace(/\/$/, '')
  return `${base}/api/proxy-image?url=${encodeURIComponent(inner)}`
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
  return discordEmbedImageUrlFromRaw(raw)
}
