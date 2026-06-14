import 'server-only'

import { normalizeOwlCenterArweaveGatewayUri } from '@/lib/owl-center/arweave-gateway-uri'
import { uploadBufferToArweaveViaIrys } from '@/lib/owl-center/irys-uploader'

export function imageGatewayUriFromUpload(
  uploaded: Record<string, string>,
  assetPath: string,
  network: 'mainnet' | 'devnet'
): string | null {
  const raw = uploaded[assetPath]?.trim()
  if (!raw) return null
  return normalizeOwlCenterArweaveGatewayUri(raw, network)
}

function rewriteJsonImageFields(json: Record<string, unknown>, imageUri: string): Record<string, unknown> {
  const out = { ...json, image: imageUri }
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

/** Wallets fail on arweave.net HTML shells and relative paths like collection.png. */
export function metadataJsonImageNeedsWalletFix(
  json: Record<string, unknown>,
  network: 'mainnet' | 'devnet'
): boolean {
  const image = typeof json.image === 'string' ? json.image.trim() : ''
  if (!image) return true
  if (!/^https?:\/\//i.test(image)) return true
  if (/arweave\.net/i.test(image)) return true
  const normalized = normalizeOwlCenterArweaveGatewayUri(image, network)
  return normalized !== image
}

export async function fetchMetadataJsonFromUri(uri: string): Promise<Record<string, unknown> | null> {
  const url = uri.trim()
  if (!url) return null
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as Record<string, unknown>
    return json && typeof json === 'object' ? json : null
  } catch {
    return null
  }
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
    const uri = normalizeOwlCenterArweaveGatewayUri(raw, network)
    const json = await fetchMetadataJsonFromUri(uri)
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
}): Promise<{ uri: string; reuploaded: boolean } | null> {
  const { uploaded, tokenIndex, network, sourceJsonUri, displayName } = params
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

  if (!metadataJsonImageNeedsWalletFix(json, network) && normalizedJobUri) {
    return { uri: normalizedJobUri, reuploaded: false }
  }

  const fixed = rewriteJsonImageFields(json, imageUri)
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
    (sourceJsonUri ? await fetchMetadataJsonFromUri(normalizeOwlCenterArweaveGatewayUri(sourceJsonUri, network)) : null) ??
    (normalizedJobUri ? await fetchMetadataJsonFromUri(normalizedJobUri) : null) ??
    ({
      name: collectionName,
      symbol: '',
      description: '',
      image: imageUri,
    } as Record<string, unknown>)

  json = { ...json, name: collectionName.slice(0, 32) }

  if (!metadataJsonImageNeedsWalletFix(json, network) && normalizedJobUri) {
    return { uri: normalizedJobUri, reuploaded: false }
  }

  const fixed = rewriteJsonImageFields(json, imageUri)
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
  const { uploaded, network, sourceJsonUri } = params
  const candidates = [
    sourceJsonUri,
    uploaded['assets/collection.json'],
  ].filter((u): u is string => Boolean(u?.trim()))

  for (const raw of candidates) {
    const json = await fetchMetadataJsonFromUri(normalizeOwlCenterArweaveGatewayUri(raw, network))
    if (json) return metadataJsonImageNeedsWalletFix(json, network)
  }
  return true
}

export async function tokenMetadataJsonNeedsWalletFix(params: {
  uploaded: Record<string, string>
  tokenIndex: string
  network: 'mainnet' | 'devnet'
  sourceJsonUri?: string | null
}): Promise<boolean> {
  const json = await loadTokenMetadataJson(
    params.uploaded,
    params.tokenIndex,
    params.network,
    params.sourceJsonUri
  )
  if (!json) return true
  return metadataJsonImageNeedsWalletFix(json, params.network)
}
