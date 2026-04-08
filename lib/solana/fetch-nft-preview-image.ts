/**
 * Server-side: resolve NFT artwork URL from mint and/or stored metadata URI (Metaplex + JSON).
 */
import { PublicKey } from '@solana/web3.js'
import { getSolanaConnection } from '@/lib/solana/connection'

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

function toFetchableUrl(uri: string): string | null {
  const u = uri.trim()
  if (!u) return null
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (/^ipfs:\/\//i.test(u)) {
    const path = u.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//i, '')
    return `https://ipfs.io/ipfs/${path}`
  }
  if (/^ar:\/\//i.test(u)) {
    const id = u.replace(/^ar:\/\//i, '').replace(/^\/+/, '').split('/')[0]?.trim()
    if (id) return `https://arweave.net/${id}`
    return null
  }
  return null
}

async function fetchMetadataJson(
  uri: string
): Promise<{ json: { image?: string; name?: string }; resolvedUrl: string } | null> {
  const url = toFetchableUrl(uri)
  if (!url) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'force-cache' })
    if (!res.ok) return null
    const json = (await res.json()) as { image?: string; name?: string }
    return { json, resolvedUrl: url }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Many collections use a relative `image` in metadata JSON (resolved against the JSON URL).
 */
function resolveMetadataImageUrl(
  imageField: string | undefined | null,
  metadataResolvedUrl: string | null
): string | null {
  const img = typeof imageField === 'string' ? imageField.trim() : ''
  if (!img) return null

  const direct = toFetchableUrl(img)
  if (direct) return direct
  if (img.startsWith('http://') || img.startsWith('https://')) return img

  if (metadataResolvedUrl) {
    try {
      const abs = new URL(img, metadataResolvedUrl).href
      const viaGateway = toFetchableUrl(abs)
      if (viaGateway) return viaGateway
      if (abs.startsWith('http://') || abs.startsWith('https://')) return abs
    } catch {
      return null
    }
  }
  return null
}

async function fetchMetaplexMetadataUri(mint: PublicKey): Promise<string | null> {
  const connection = getSolanaConnection()
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  )
  try {
    const accountInfo = await connection.getAccountInfo(metadataPda, 'confirmed')
    if (!accountInfo?.data || accountInfo.data.length < 69) return null
    const data = accountInfo.data as Uint8Array
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let offset = 1 + 32 + 32
    const readU32 = () => {
      const v = view.getUint32(offset, true)
      offset += 4
      return v
    }
    const readString = (len: number) => {
      const slice = data.subarray(offset, offset + len)
      offset += len
      return new TextDecoder().decode(slice)
    }
    const nameLen = readU32()
    if (nameLen > 0) readString(nameLen)
    const symbolLen = readU32()
    if (symbolLen > 0) readString(symbolLen)
    const uriLen = readU32()
    const uri = uriLen > 0 ? readString(uriLen).replace(/\0/g, '').trim() : ''
    return uri || null
  } catch {
    return null
  }
}

export type NftPreviewSource = {
  nft_mint_address: string | null | undefined
  nft_metadata_uri: string | null | undefined
}

/**
 * Returns raw image URL from metadata JSON (http(s), ipfs, or relative — caller may proxy).
 */
export async function fetchNftPreviewImageUrl(source: NftPreviewSource): Promise<string | null> {
  const mintStr = source.nft_mint_address?.trim() || ''
  const storedUri = source.nft_metadata_uri?.trim() || ''

  if (storedUri) {
    const meta = await fetchMetadataJson(storedUri)
    if (meta) {
      const resolved = resolveMetadataImageUrl(meta.json.image, meta.resolvedUrl)
      if (resolved) return resolved
    }
  }

  if (!mintStr) return null
  try {
    const mintPk = new PublicKey(mintStr)
    const uri = await fetchMetaplexMetadataUri(mintPk)
    if (!uri) return null
    const meta = await fetchMetadataJson(uri)
    if (!meta) return null
    return resolveMetadataImageUrl(meta.json.image, meta.resolvedUrl)
  } catch {
    return null
  }
}
