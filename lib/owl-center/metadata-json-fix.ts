import 'server-only'

import {
  arweaveTxIdFromHttps,
  normalizeOwlCenterArweaveGatewayUri,
  walletSafeArweaveImageUri,
} from '@/lib/owl-center/arweave-gateway-uri'
import { uploadBufferToArweaveViaIrys } from '@/lib/owl-center/irys-uploader'
import { irysGatewayMirrorHttpsUrls } from '@/lib/nft-media-uri'
import { getSiteBaseUrl } from '@/lib/site-config'

export type WalletImageFile = {
  uri: string
  type: string
  cdn?: boolean
}

export type WalletImageSet = {
  /** Primary `image` field — Owltopia proxy (Phantom + Solflare mobile). */
  primaryImage: string
  /** Direct Irys gateway mirror for indexers. */
  gatewayImage: string
  files: WalletImageFile[]
}

export function buildOwlCenterWalletProxyImageUrl(gatewayBase: string): string {
  return `${getSiteBaseUrl()}/api/proxy-image?url=${encodeURIComponent(gatewayBase)}`
}

export function buildWalletImageSetFromUpload(
  uploaded: Record<string, string>,
  assetPath: string,
  network: 'mainnet' | 'devnet'
): WalletImageSet | null {
  const raw = uploaded[assetPath]?.trim()
  if (!raw) return null
  return buildWalletImageSetFromImageUrl(raw, network)
}

/**
 * Build the wallet-safe image set from any existing Arweave/Irys image URL (e.g. the `image`
 * field already on-chain). Used to repair mints deployed outside the in-app upload job (Sugar CLI),
 * where there is no `uploaded` map to look up — we derive everything from the current image URL.
 */
export function buildWalletImageSetFromImageUrl(
  rawImageUrl: string,
  network: 'mainnet' | 'devnet'
): WalletImageSet | null {
  const raw = rawImageUrl?.trim()
  if (!raw) return null

  const id = arweaveTxIdFromHttps(raw)
  if (!id) return null

  const gatewayImage = walletSafeArweaveImageUri(raw, network)
  const gatewayBase = gatewayImage.split('?')[0] ?? gatewayImage
  const primaryImage = buildOwlCenterWalletProxyImageUrl(gatewayBase)

  return {
    primaryImage,
    gatewayImage,
    files: [
      { uri: primaryImage, type: 'image/png', cdn: true },
      { uri: gatewayImage, type: 'image/png' },
    ],
  }
}

/** Best existing image URL from an off-chain metadata JSON (`image`, else first `properties.files` uri). */
export function imageUrlFromMetadataJson(json: Record<string, unknown>): string | null {
  const image = typeof json.image === 'string' ? json.image.trim() : ''
  if (image) return image
  const props = json.properties
  if (props && typeof props === 'object') {
    const files = (props as Record<string, unknown>).files
    if (Array.isArray(files)) {
      for (const entry of files) {
        if (entry && typeof entry === 'object') {
          const uri = (entry as Record<string, unknown>).uri
          if (typeof uri === 'string' && uri.trim()) return uri.trim()
        }
      }
    }
  }
  return null
}

export function rewriteJsonImageFields(
  json: Record<string, unknown>,
  images: WalletImageSet,
  collectionName?: string | null
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...json, image: images.primaryImage }
  if (collectionName?.trim()) {
    out.collection = {
      name: collectionName.trim(),
      family: collectionName.trim(),
    }
  }

  const props =
    out.properties && typeof out.properties === 'object'
      ? { ...(out.properties as Record<string, unknown>) }
      : ({} as Record<string, unknown>)

  props.files = images.files
  props.category = 'image'
  out.properties = props

  return out
}

function isWalletSafePrimaryImageUrl(image: string): boolean {
  if (!/^https?:\/\//i.test(image)) return false
  try {
    const base = getSiteBaseUrl().toLowerCase()
    const u = new URL(image)
    const path = `${u.origin}${u.pathname}`.toLowerCase()
    if (path !== `${base}/api/proxy-image`) return false
    const embedded = u.searchParams.get('url')?.trim()
    return Boolean(embedded)
  } catch {
    return false
  }
}

function isGatewayImageUrl(uri: string, network: 'mainnet' | 'devnet'): boolean {
  if (!/^https?:\/\//i.test(uri)) return false
  try {
    const u = new URL(uri)
    const h = u.hostname.toLowerCase()
    const ext = u.searchParams.get('ext')?.toLowerCase()
    if (ext !== 'png') return false
    if (network === 'devnet') {
      return h === 'arweave.dev' || h.endsWith('.arweave.dev')
    }
    return h === 'gateway.irys.xyz' || h === 'ardrive.net' || h === 'uploader.irys.xyz'
  } catch {
    return false
  }
}

function hasGatewayFilesEntry(json: Record<string, unknown>, network: 'mainnet' | 'devnet'): boolean {
  const props = json.properties
  if (!props || typeof props !== 'object') return false
  const files = (props as Record<string, unknown>).files
  if (!Array.isArray(files)) return false
  return files.some((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const uri = (entry as Record<string, unknown>).uri
    return typeof uri === 'string' && isGatewayImageUrl(uri, network)
  })
}

function hasProxyCdnFilesEntry(json: Record<string, unknown>): boolean {
  const props = json.properties
  if (!props || typeof props !== 'object') return false
  const files = (props as Record<string, unknown>).files
  if (!Array.isArray(files) || files.length === 0) return false
  const first = files[0]
  if (!first || typeof first !== 'object') return false
  const entry = first as Record<string, unknown>
  const uri = entry.uri
  if (typeof uri !== 'string' || !isWalletSafePrimaryImageUrl(uri)) return false
  return entry.cdn === true
}

/** Wallets fail without proxy primary image, gateway mirror in files, and cdn proxy first in files. */
export function metadataJsonImageNeedsWalletFix(
  json: Record<string, unknown>,
  network: 'mainnet' | 'devnet'
): boolean {
  const image = typeof json.image === 'string' ? json.image.trim() : ''
  if (!image) return true
  if (!isWalletSafePrimaryImageUrl(image)) return true
  if (!hasGatewayFilesEntry(json, network)) return true
  if (!hasProxyCdnFilesEntry(json)) return true
  return false
}

function metadataJsonFetchCandidates(uri: string, network: 'mainnet' | 'devnet'): string[] {
  const trimmed = uri.trim()
  if (!trimmed) return []
  const normalized = normalizeOwlCenterArweaveGatewayUri(trimmed, network)
  const id = arweaveTxIdFromHttps(normalized)
  const mirrors = new Set<string>([trimmed, normalized, ...irysGatewayMirrorHttpsUrls(normalized)])
  if (id) {
    const host = network === 'devnet' ? 'arweave.dev' : 'ar-io.net'
    mirrors.add(`https://${host}/${id}`)
    mirrors.add(`https://gateway.irys.xyz/${id}`)
  }
  return [...mirrors].filter(Boolean)
}

export async function fetchMetadataJsonFromUri(
  uri: string,
  network: 'mainnet' | 'devnet' = 'mainnet'
): Promise<Record<string, unknown> | null> {
  for (const url of metadataJsonFetchCandidates(uri, network)) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) continue
      const json = (await res.json()) as Record<string, unknown>
      if (json && typeof json === 'object') return json
    } catch {
      /* try next gateway mirror */
    }
  }
  return null
}

/** Inspect only the on-chain metadata URI — never fall back to the upload job JSON. */
export async function onChainMetadataJsonNeedsWalletFix(
  sourceJsonUri: string | null | undefined,
  network: 'mainnet' | 'devnet'
): Promise<boolean> {
  if (!sourceJsonUri?.trim()) return true
  const json = await fetchMetadataJsonFromUri(sourceJsonUri, network)
  if (!json) return true
  return metadataJsonImageNeedsWalletFix(json, network)
}

async function loadTokenMetadataJson(
  uploaded: Record<string, string>,
  tokenIndex: string,
  network: 'mainnet' | 'devnet',
  sourceJsonUri?: string | null
): Promise<Record<string, unknown> | null> {
  const candidates = [
    sourceJsonUri,
    uploaded[`assets/${tokenIndex}.json`],
  ].filter((u): u is string => Boolean(u?.trim()))

  for (const raw of candidates) {
    const json = await fetchMetadataJsonFromUri(raw, network)
    if (json) return json
  }
  return null
}

/**
 * Return a wallet-safe metadata JSON URI. Re-uploads JSON when the embedded image URL
 * still points at arweave.net or a relative path.
 */
export async function ensureWalletSafeTokenMetadataJsonUri(params: {
  uploaded: Record<string, string>
  tokenIndex: string
  network: 'mainnet' | 'devnet'
  sourceJsonUri?: string | null
  displayName?: string | null
  collectionName?: string | null
}): Promise<{ uri: string; reuploaded: boolean } | null> {
  const { uploaded, tokenIndex, network, sourceJsonUri, displayName, collectionName } = params
  const images = buildWalletImageSetFromUpload(uploaded, `assets/${tokenIndex}.png`, network)
  if (!images) return null

  const jobJsonUri = uploaded[`assets/${tokenIndex}.json`]?.trim()
  const normalizedJobUri = jobJsonUri ? normalizeOwlCenterArweaveGatewayUri(jobJsonUri, network) : null
  const json = (await loadTokenMetadataJson(uploaded, tokenIndex, network, sourceJsonUri)) ?? {
    name: displayName ?? `Token ${tokenIndex}`,
    description: '',
    image: images.primaryImage,
  }

  if (displayName?.trim()) {
    json.name = displayName.trim()
  }

  const onChainNeedsFix = sourceJsonUri
    ? await onChainMetadataJsonNeedsWalletFix(sourceJsonUri, network)
    : true
  const sourceTxId = sourceJsonUri ? arweaveTxIdFromHttps(sourceJsonUri) : null
  const jobTxId = normalizedJobUri ? arweaveTxIdFromHttps(normalizedJobUri) : null

  if (
    !onChainNeedsFix &&
    normalizedJobUri &&
    (!sourceTxId || !jobTxId || sourceTxId === jobTxId)
  ) {
    return { uri: normalizedJobUri, reuploaded: false }
  }

  if (!metadataJsonImageNeedsWalletFix(json, network) && normalizedJobUri && sourceTxId !== jobTxId) {
    return { uri: normalizedJobUri, reuploaded: false }
  }

  const fixed = rewriteJsonImageFields(json, images, collectionName)
  const { uri } = await uploadBufferToArweaveViaIrys(
    Buffer.from(JSON.stringify(fixed, null, 2), 'utf8'),
    'application/json'
  )
  return { uri, reuploaded: true }
}

export async function ensureWalletSafeCollectionMetadataJsonUri(params: {
  uploaded: Record<string, string>
  collectionName: string
  network: 'mainnet' | 'devnet'
  sourceJsonUri?: string | null
}): Promise<{ uri: string; reuploaded: boolean } | null> {
  const { uploaded, collectionName, network, sourceJsonUri } = params
  const images =
    buildWalletImageSetFromUpload(uploaded, 'assets/collection.png', network) ??
    buildWalletImageSetFromUpload(uploaded, 'assets/0.png', network)
  if (!images) return null

  const jobJsonUri = uploaded['assets/collection.json']?.trim()
  const normalizedJobUri = jobJsonUri ? normalizeOwlCenterArweaveGatewayUri(jobJsonUri, network) : null
  let json =
    (sourceJsonUri ? await fetchMetadataJsonFromUri(sourceJsonUri, network) : null) ??
    (normalizedJobUri ? await fetchMetadataJsonFromUri(normalizedJobUri, network) : null) ??
    ({
      name: collectionName,
      symbol: '',
      description: '',
      image: images.primaryImage,
    } as Record<string, unknown>)

  json = { ...json, name: collectionName.slice(0, 32) }

  const onChainNeedsFix = sourceJsonUri
    ? await onChainMetadataJsonNeedsWalletFix(sourceJsonUri, network)
    : true
  const sourceTxId = sourceJsonUri ? arweaveTxIdFromHttps(sourceJsonUri) : null
  const jobTxId = normalizedJobUri ? arweaveTxIdFromHttps(normalizedJobUri) : null

  if (
    !onChainNeedsFix &&
    normalizedJobUri &&
    (!sourceTxId || !jobTxId || sourceTxId === jobTxId)
  ) {
    return { uri: normalizedJobUri, reuploaded: false }
  }

  if (!metadataJsonImageNeedsWalletFix(json, network) && normalizedJobUri && sourceTxId !== jobTxId) {
    return { uri: normalizedJobUri, reuploaded: false }
  }

  const fixed = rewriteJsonImageFields(json, images, collectionName)
  const { uri } = await uploadBufferToArweaveViaIrys(
    Buffer.from(JSON.stringify(fixed, null, 2), 'utf8'),
    'application/json'
  )
  return { uri, reuploaded: true }
}

export async function collectionMetadataJsonNeedsWalletFix(params: {
  uploaded: Record<string, string>
  network: 'mainnet' | 'devnet'
  sourceJsonUri?: string | null
}): Promise<boolean> {
  return onChainMetadataJsonNeedsWalletFix(params.sourceJsonUri, params.network)
}

export async function tokenMetadataJsonNeedsWalletFix(params: {
  uploaded: Record<string, string>
  tokenIndex: string
  network: 'mainnet' | 'devnet'
  sourceJsonUri?: string | null
}): Promise<boolean> {
  return onChainMetadataJsonNeedsWalletFix(params.sourceJsonUri, params.network)
}
