/**
 * Client-side only: read NFTs and SPL tokens in a user's wallet at raffle creation time.
 * Uses RPC getParsedTokenAccountsByOwner; optionally fetches Metaplex metadata for NFTs.
 */

import { Connection, PublicKey } from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from '@solana/spl-token'

/** Programs we support for NFTs (SPL Token + Token-2022) so any raffled NFT is recognized. */
export const NFT_TOKEN_PROGRAM_IDS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const

export interface NftHolderInWallet {
  tokenProgram: typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID
  tokenAccount: PublicKey
}

/** Returned when the mint is in the wallet but only in a delegated (staked) account. */
export interface NftHolderDelegated {
  delegated: true
}

/**
 * Find the token account that holds this mint in the given wallet (SPL Token or Token-2022).
 * Checks mint-filtered RPC first (no truncation), then ATA, then full scan.
 * If the only holding is delegated (staked), returns { delegated: true } so the UI can ask the user to unstake.
 */
export async function getNftHolderInWallet(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
): Promise<NftHolderInWallet | NftHolderDelegated | null> {
  const mintStr = mint.toBase58()
  let foundDelegated = false

  // 1) Mint-filtered lookup: returns only accounts holding this mint (avoids truncation when user has many tokens)
  try {
    const mintFilterResponse = await connection.getParsedTokenAccountsByOwner(
      owner,
      { mint },
      'confirmed'
    )
    for (const { pubkey, account } of mintFilterResponse.value) {
      const info = account.data?.parsed?.info
      if (!info || (info.mint as string) !== mintStr) continue
      const programOwner = account.owner
      const isTokenProgram = programOwner.equals(TOKEN_PROGRAM_ID)
      const isToken2022 = programOwner.equals(TOKEN_2022_PROGRAM_ID)
      if (!isTokenProgram && !isToken2022) continue
      const tokenProgram = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
      const amount = info.tokenAmount?.amount
      const amountStr = typeof amount === 'string' ? amount : String(amount ?? '0')
      const amountNum = Number(amountStr)
      if (!Number.isFinite(amountNum) || amountNum < 1) continue
      const delegate = info.delegate
      if (delegate && typeof delegate === 'string' && delegate !== '') {
        foundDelegated = true
        continue
      }
      return { tokenProgram, tokenAccount: pubkey }
    }
  } catch {
    // RPC error; fall through to ATA and programId scan
  }

  // 2) Check canonical ATAs (SPL and Token-2022)
  for (const programId of NFT_TOKEN_PROGRAM_IDS) {
    try {
      const ata = await getAssociatedTokenAddress(
        mint,
        owner,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const account = await getAccount(connection, ata, 'confirmed', programId)
      if (account.amount >= 1n) {
        if (account.delegate) foundDelegated = true
        else return { tokenProgram: programId, tokenAccount: ata }
      }
    } catch {
      // ATA not found or wrong program
    }
  }

  // 3) Full scan by program (may be truncated on some RPCs if user has many token accounts)
  for (const programId of NFT_TOKEN_PROGRAM_IDS) {
    try {
      const response = await connection.getParsedTokenAccountsByOwner(
        owner,
        { programId },
        'confirmed'
      )
      for (const { pubkey, account } of response.value) {
        const info = account.data?.parsed?.info
        if (!info || (info.mint as string) !== mintStr) continue
        const amount = info.tokenAmount?.amount
        const amountStr = typeof amount === 'string' ? amount : String(amount ?? '0')
        const amountNum = Number(amountStr)
        if (!Number.isFinite(amountNum) || amountNum < 1) continue
        const delegate = info.delegate
        if (delegate && typeof delegate === 'string' && delegate !== '') {
          foundDelegated = true
          continue
        }
        return { tokenProgram: programId, tokenAccount: pubkey }
      }
    } catch {
      // RPC error; continue to next program or return null
    }
  }
  if (foundDelegated) return { delegated: true }
  return null
}

/**
 * Detect which token program holds this mint in the given wallet (SPL Token or Token-2022).
 * Prefer getNftHolderInWallet when you need to transfer (so you can use the actual token account).
 */
export async function getTokenProgramForMintInWallet(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
): Promise<typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID | null> {
  const holder = await getNftHolderInWallet(connection, mint, owner)
  return holder && 'tokenProgram' in holder ? holder.tokenProgram : null
}

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
 * Includes both SPL Token and Token-2022 so any NFT can be selected for a raffle.
 * Optionally fetches Metaplex metadata and off-chain JSON for name/image.
 */
export async function getWalletNfts(
  connection: Connection,
  ownerPublicKey: PublicKey,
  options?: { fetchMetadata?: boolean }
): Promise<WalletNft[]> {
  const fetchMetadata = options?.fetchMetadata !== false
  const nfts: WalletNft[] = []
  for (const programId of NFT_TOKEN_PROGRAM_IDS) {
    const response = await connection.getParsedTokenAccountsByOwner(ownerPublicKey, {
      programId,
    })
    for (const { pubkey, account } of response.value) {
      const info = account.data?.parsed?.info
      if (!info) continue
      // Skip delegated (e.g. staked) NFTs – user can't transfer them until unstaked
      const delegate = info.delegate
      if (delegate && typeof delegate === 'string' && delegate !== '') continue
      const rawDecimals = info.tokenAmount?.decimals
      const decimals = typeof rawDecimals === 'number' && !Number.isNaN(rawDecimals) ? rawDecimals : Number(rawDecimals ?? 9)
      const amount = String(info.tokenAmount?.amount ?? '0')
      // Treat as NFT: decimals 0 and non-zero amount (some RPCs omit decimals for NFTs, so also accept amount 1 when decimals is missing/NaN)
      const amountNum = parseFloat(amount)
      const isNft =
        amount !== '0' &&
        (decimals === 0 || (Number.isNaN(decimals) && amountNum === 1))
      if (!isNft) continue
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
