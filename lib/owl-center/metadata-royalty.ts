import { walletSafeArweaveImageUri } from '@/lib/owl-center/arweave-gateway-uri'
import { launchSellerFeeBasisPoints } from '@/lib/owl-center/royalty'
import { walletSplitsToMetaplexCreators } from '@/lib/owl-center/wallet-splits'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

/** Off-chain Metaplex JSON royalty fields explorers (Orb, ME, Tensor) display. */
export type MetadataRoyaltyFields = {
  sellerFeeBasisPoints: number
  creators: Array<{ address: string; share: number }>
}

export type MetadataJsonCreator = {
  address: string
  share: number
  verified: false
}

/** Core on-chain Royalties plugin args (percentage, not Metaplex JSON share). */
export type CoreRoyaltiesPluginArgs = {
  type: 'Royalties'
  basisPoints: number
  creators: Array<{ address: string; percentage: number }>
}

const MIN_PUBKEY_LEN = 32

export function metadataRoyaltyFromLaunch(
  launch: Pick<OwlCenterLaunchPublic, 'seller_fee_basis_points' | 'royalty_splits' | 'creator_wallet'>
): MetadataRoyaltyFields {
  const fallback = launch.creator_wallet?.trim() || ''
  return {
    sellerFeeBasisPoints: launchSellerFeeBasisPoints(launch),
    creators: walletSplitsToMetaplexCreators(launch.royalty_splits, fallback).filter(
      (row) => row.address.trim().length >= MIN_PUBKEY_LEN && row.share > 0
    ),
  }
}

export function coreRoyaltiesPluginFromLaunch(
  launch: Pick<OwlCenterLaunchPublic, 'seller_fee_basis_points' | 'royalty_splits' | 'creator_wallet'>
): CoreRoyaltiesPluginArgs | null {
  const royalty = metadataRoyaltyFromLaunch(launch)
  if (royalty.creators.length === 0) return null
  return {
    type: 'Royalties',
    basisPoints: royalty.sellerFeeBasisPoints,
    creators: royalty.creators.map((row) => ({ address: row.address, percentage: row.share })),
  }
}

export function metadataJsonCreators(royalty: MetadataRoyaltyFields): MetadataJsonCreator[] {
  return royalty.creators.map((row) => ({
    address: row.address,
    share: row.share,
    verified: false as const,
  }))
}

/** True when explorers would treat the JSON as having no royalty set. */
export function metadataJsonNeedsRoyaltyFields(json: Record<string, unknown>): boolean {
  const bps = json.seller_fee_basis_points
  if (typeof bps !== 'number' || !Number.isFinite(bps) || bps < 0) return true
  const props = json.properties
  if (!props || typeof props !== 'object') return true
  const creators = (props as Record<string, unknown>).creators
  if (!Array.isArray(creators) || creators.length === 0) return true
  return !creators.some((row) => {
    if (!row || typeof row !== 'object') return false
    const address = (row as Record<string, unknown>).address
    const share = (row as Record<string, unknown>).share
    return typeof address === 'string' && address.trim().length >= MIN_PUBKEY_LEN && Number(share) > 0
  })
}

/** Stamp launch royalties onto Metaplex JSON. Always overwrites so JSON matches on-chain. */
export function applyMetaplexRoyaltyFields(
  json: Record<string, unknown>,
  royalty: MetadataRoyaltyFields | null | undefined
): Record<string, unknown> {
  if (!royalty) return json
  json.seller_fee_basis_points = royalty.sellerFeeBasisPoints
  const props =
    json.properties && typeof json.properties === 'object'
      ? { ...(json.properties as Record<string, unknown>) }
      : ({} as Record<string, unknown>)
  if (royalty.creators.length > 0) {
    props.creators = metadataJsonCreators(royalty)
  }
  json.properties = props
  return json
}

/** Look up an already-uploaded Arweave URI by file basename (`collection.png`, `0.png`). */
export function uploadedUriByBasename(uploaded: Record<string, string>, fileBasename: string): string | null {
  const needle = fileBasename.replace(/\\/g, '/').split('/').pop()?.toLowerCase()
  if (!needle) return null
  for (const [path, uri] of Object.entries(uploaded)) {
    const base = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase()
    if (base === needle && uri?.trim()) return uri.trim()
  }
  return null
}

/** Stamp image URIs and launch royalties onto Metaplex token/collection JSON. */
export function rewriteMetadataJson(
  rawJson: string,
  imageUri: string | null | undefined,
  pngBasename: string,
  royalty?: MetadataRoyaltyFields | null
): string {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>
  const rawImage = imageUri?.trim()
  const image = rawImage
    ? /[?&]ext=/i.test(rawImage)
      ? rawImage
      : walletSafeArweaveImageUri(rawImage)
    : ''
  if (image) {
    parsed.image = image
    if (parsed.properties && typeof parsed.properties === 'object') {
      const props = parsed.properties as Record<string, unknown>
      if (Array.isArray(props.files)) {
        props.files = (props.files as Record<string, unknown>[]).map((f) => ({
          ...f,
          uri: typeof f.uri === 'string' && f.uri.endsWith('.png') ? image : f.uri,
        }))
      }
    }
    if (!parsed.properties || typeof parsed.properties !== 'object') {
      parsed.properties = {
        files: [{ uri: image, type: 'image/png' }],
        category: 'image',
      }
    }
  }
  applyMetaplexRoyaltyFields(parsed, royalty)
  void pngBasename
  return JSON.stringify(parsed, null, 2)
}
