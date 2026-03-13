/**
 * Client-side only: read NFTs and SPL tokens in a user's wallet at raffle creation time.
 * Uses RPC getParsedTokenAccountsByOwner; optionally fetches Metaplex metadata for NFTs.
 */

import { Connection, PublicKey } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

export interface WalletNft {
  mint: string
  tokenAccount: string
  amount: string
  decimals: number
  metadataUri: string | null
  name: string | null
  image: string | null
  collectionName: string | null
}

export interface WalletToken {
  mint: string
  symbol: string
  balance: string
  decimals: number
  tokenAccount: string
}

/** Parse Metaplex Token Metadata account to get URI (and optionally name/symbol). */
async function fetchMetaplexMetadata(
  connection: Connection,
  mint: PublicKey
): Promise<{ uri: string; name: string; symbol: string } | null> {
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  )
  try {
    const accountInfo = await connection.getAccountInfo(metadataPda)
    if (!accountInfo?.data || accountInfo.data.length < 69) return null
    const data = accountInfo.data as Uint8Array
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let offset = 1 + 32 + 32 // key + update_authority + mint
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
    const name = nameLen > 0 ? readString(nameLen) : ''
    const symbolLen = readU32()
    const symbol = symbolLen > 0 ? readString(symbolLen) : ''
    const uriLen = readU32()
    const uri = uriLen > 0 ? readString(uriLen) : ''
    return { uri, name, symbol }
  } catch {
    return null
  }
}

/** Fetch JSON from metadata URI and return name + image (with basic CORS-safe handling). */
async function fetchMetadataJson(uri: string): Promise<{ name?: string; image?: string; collection?: { name?: string } } | null> {
  try {
    const res = await fetch(uri, { cache: 'force-cache' })
    if (!res.ok) return null
    const json = (await res.json()) as { name?: string; image?: string; collection?: { name?: string } }
    return json
  } catch {
    return null
  }
}

/**
 * Fetch all NFTs (token accounts with decimals 0) in the wallet.
 * Optionally fetches Metaplex metadata and off-chain JSON for name/image.
 */
export async function getWalletNfts(
  connection: Connection,
  ownerPublicKey: PublicKey,
  options?: { fetchMetadata?: boolean }
): Promise<WalletNft[]> {
  const fetchMetadata = options?.fetchMetadata !== false
  const response = await connection.getParsedTokenAccountsByOwner(ownerPublicKey, {
    programId: TOKEN_PROGRAM_ID,
  })
  const nfts: WalletNft[] = []
  for (const { pubkey, account } of response.value) {
    const info = account.data?.parsed?.info
    if (!info) continue
    const decimals = Number(info.tokenAmount?.decimals ?? 9)
    const amount = String(info.tokenAmount?.amount ?? '0')
    // Treat as NFT: decimals 0 and non-zero amount
    if (decimals !== 0 || amount === '0') continue
    const mint = info.mint as string
    const tokenAccount = pubkey.toBase58()
    let metadataUri: string | null = null
    let name: string | null = null
    let image: string | null = null
    let collectionName: string | null = null
    if (fetchMetadata) {
      const meta = await fetchMetaplexMetadata(connection, new PublicKey(mint))
      if (meta) {
        metadataUri = meta.uri || null
        name = meta.name || null
        const json = meta.uri ? await fetchMetadataJson(meta.uri) : null
        if (json) {
          if (json.name) name = json.name
          if (json.image) image = json.image
          if (json.collection?.name) collectionName = json.collection.name
        }
      }
    }
    nfts.push({
      mint,
      tokenAccount,
      amount,
      decimals,
      metadataUri,
      name,
      image,
      collectionName,
    })
  }
  return nfts
}

/**
 * Fetch all fungible (and optionally NFT) token accounts in the wallet.
 * Returns balance, symbol from mint (we don't resolve symbol for arbitrary mints; use "Unknown" or mint slice).
 */
export async function getWalletTokens(
  connection: Connection,
  ownerPublicKey: PublicKey
): Promise<WalletToken[]> {
  const response = await connection.getParsedTokenAccountsByOwner(ownerPublicKey, {
    programId: TOKEN_PROGRAM_ID,
  })
  const tokens: WalletToken[] = []
  for (const { pubkey, account } of response.value) {
    const info = account.data?.parsed?.info
    if (!info) continue
    const decimals = Number(info.tokenAmount?.decimals ?? 0)
    const amount = String(info.tokenAmount?.amount ?? '0')
    const mint = info.mint as string
    const symbol = (info.tokenAmount?.uiTokenAmount?.symbol as string) ?? undefined
    tokens.push({
      mint,
      symbol: symbol ?? `Token (${mint.slice(0, 4)}…)`,
      balance: amount,
      decimals,
      tokenAccount: pubkey.toBase58(),
    })
  }
  return tokens
}
