import 'server-only'

import { arweaveTxIdFromHttps, normalizeOwlCenterArweaveGatewayUri, walletSafeArweaveImageUri } from '@/lib/owl-center/arweave-gateway-uri'
import { uploadBufferToArweaveViaIrys } from '@/lib/owl-center/irys-uploader'
import { irysGatewayMirrorHttpsUrls } from '@/lib/nft-media-uri'

export function imageGatewayUriFromUpload(
  uploaded: Record<string, string>,
  assetPath: string,
  network: 'mainnet' | 'devnet'
): string | null {
  const raw = uploaded[assetPath]?.trim()
  if (!raw) return null
  return walletSafeArweaveImageUri(raw, network)
}

function rewriteJsonImageFields(
  json: Record<string, unknown>,
  imageUri: string,
  collectionName?: string | null
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...json, image: imageUri }
  if (collectionName?.trim()) {
    out.collection = {
      name: collectionName.trim(),
      family: collectionName.trim(),
    }
  }
  if (out.properties && typeof out.properties === 'object') {
    const props = { ...(out.properties as Record<string, unknown>) }
    if (Array.isArray(props.files)) {
      props.files = (props.files as Record<string, unknown>[]).map((f) => ({
        ...f,
        uri: typeof f.uri === 'string' && (f.uri.endsWith('.png') || f.uri === json.image) ? imageUri : f.uri,
      }))
    } else {
      props.files = [{ uri: imageUri, type: 'image/png' }]
    }
    props.category = props.category ?? 'image'
    out.properties = props
  } else {
    out.properties = {
      files: [{ uri: imageUri, type: 'image/png' }],
      category: 'image',
    }
  }
  return out
}

function isWalletSafeImageUrl(image: string, network: 'mainnet' | 'devnet'): boolean {
  if (!/^https?:\/\//i.test(image)) return false
  try {
    const u = new URL(image)
    const h = u.hostname.toLowerCase()
    const ext = u.searchParams.get('ext')?.toLowerCase()
    if (network === 'devnet') {
      return (h === 'arweave.dev' || h.endsWith('.arweave.dev')) && ext === 'png'
    }
    return (h === 'arweave.net' || h === 'www.arweave.net') && ext === 'png'
  } catch {
    return false
  }
}

/** Wallets fail on arweave.net HTML shells and relative paths like collection.png. */
export function metadataJsonImageNeedsWalletFix(
  json: Record<string, unknown>,
  network: 'mainnet' | 'devnet'
): boolean {
  const image = typeof json.image === 'string' ? json.image.trim() : ''
  if (!image) return true
  return !isWalletSafeImageUrl(image, network)
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
  const imageUri = imageGatewayUriFromUpload(uploaded, `assets/${tokenIndex}.png`, network)
  if (!imageUri) return null

  const jobJsonUri = uploaded[`assets/${tokenIndex}.json`]?.trim()
  const normalizedJobUri = jobJsonUri ? normalizeOwlCenterArweaveGatewayUri(jobJsonUri, network) : null
  const json = (await loadTokenMetadataJson(uploaded, tokenIndex, network, sourceJsonUri)) ?? {
    name: displayName ?? `Token ${tokenIndex}`,
    description: '',
    image: imageUri,
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

  const fixed = rewriteJsonImageFields(json, imageUri, collectionName)
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
  const imageUri =
    imageGatewayUriFromUpload(uploaded, 'assets/collection.png', network) ??
    imageGatewayUriFromUpload(uploaded, 'assets/0.png', network)
  if (!imageUri) return null

  const jobJsonUri = uploaded['assets/collection.json']?.trim()
  const normalizedJobUri = jobJsonUri ? normalizeOwlCenterArweaveGatewayUri(jobJsonUri, network) : null
  let json =
    (sourceJsonUri ? await fetchMetadataJsonFromUri(sourceJsonUri, network) : null) ??
    (normalizedJobUri ? await fetchMetadataJsonFromUri(normalizedJobUri, network) : null) ??
    ({
      name: collectionName,
      symbol: '',
      description: '',
      image: imageUri,
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

  const fixed = rewriteJsonImageFields(json, imageUri, collectionName)
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
