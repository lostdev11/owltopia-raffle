/**
 * Client-side only: read NFTs and SPL tokens in a user's wallet at raffle creation time.
 * Uses RPC getParsedTokenAccountsByOwner; optionally fetches Metaplex metadata for NFTs.
 */

import type { AccountInfo } from '@solana/web3.js'
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
  /** Leftover Candy Machine / nest delegate may remain; owner can still transfer when not frozen. */
  hasDelegate?: boolean
  /**
   * SPL token-account frozen flag. For pNFTs this can be true without a stake/nest lock —
   * use {@link isNftHolderTransferLocked} before blocking raffle create/deposit.
   */
  isFrozen?: boolean
}

/**
 * @deprecated Gen2 CM thaw leaves a delegate without freeze — that is still owner-transferable.
 * Callers should use {@link NftHolderInWallet.isFrozen} (or on-chain freeze) instead of this shape.
 */
export interface NftHolderDelegated {
  delegated: true
}

/**
 * Find the token account that holds this mint in the given wallet (SPL Token or Token-2022).
 * Checks mint-filtered RPC first (no truncation), then ATA, then full scan.
 *
 * Important: do **not** skip accounts with a leftover delegate. Gen2 freezeSolPayment thaw often
 * leaves the freeze-escrow delegate set while `isFrozen=false` — those NFTs are sendable.
 * For classic NFTs, `isFrozen` means nested / mint-locked. For pNFTs, freeze alone is often
 * rule-set state — use {@link isNftHolderTransferLocked} (freeze + delegate) for raffle gates.
 */
export async function getNftHolderInWallet(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'
): Promise<NftHolderInWallet | NftHolderDelegated | null> {
  const mintStr = mint.toBase58()

  // 1) Mint-filtered lookup: returns only accounts holding this mint (avoids truncation when user has many tokens)
  try {
    const mintFilterResponse = await connection.getParsedTokenAccountsByOwner(
      owner,
      { mint },
      commitment
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
      const hasDelegate = Boolean(delegate && typeof delegate === 'string' && delegate !== '')
      const state = typeof (info as { state?: string }).state === 'string'
        ? (info as { state?: string }).state!.toLowerCase()
        : ''
      return {
        tokenProgram,
        tokenAccount: pubkey,
        hasDelegate,
        isFrozen: state === 'frozen',
      }
    }
  } catch {
    // RPC error; fall through to ATA and programId scan
  }

  // 2) Check canonical ATAs (SPL and Token-2022) — include delegated Gen2 leftovers.
  for (const programId of NFT_TOKEN_PROGRAM_IDS) {
    try {
      const ata = await getAssociatedTokenAddress(
        mint,
        owner,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const account = await getAccount(connection, ata, commitment, programId)
      if (account.amount >= 1n) {
        return {
          tokenProgram: programId,
          tokenAccount: ata,
          hasDelegate: Boolean(account.delegate),
          isFrozen: account.isFrozen,
        }
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
        commitment
      )
      for (const { pubkey, account } of response.value) {
        const info = account.data?.parsed?.info
        if (!info || (info.mint as string) !== mintStr) continue
        const amount = info.tokenAmount?.amount
        const amountStr = typeof amount === 'string' ? amount : String(amount ?? '0')
        const amountNum = Number(amountStr)
        if (!Number.isFinite(amountNum) || amountNum < 1) continue
        const delegate = info.delegate
        const hasDelegate = Boolean(delegate && typeof delegate === 'string' && delegate !== '')
        const state = typeof (info as { state?: string }).state === 'string'
          ? (info as { state?: string }).state!.toLowerCase()
          : ''
        return {
          tokenProgram: programId,
          tokenAccount: pubkey,
          hasDelegate,
          isFrozen: state === 'frozen',
        }
      }
    } catch {
      // RPC error; continue to next program or return null
    }
  }
  return null
}

/**
 * SPL / Token-2022 token account that holds at least `minAmount` raw units of `mint` (not delegated).
 */
export async function getFungibleHolderInWallet(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  minAmount: bigint,
  commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'
): Promise<NftHolderInWallet | null> {
  if (minAmount <= 0n) return null
  const mintStr = mint.toBase58()
  try {
    const mintFilterResponse = await connection.getParsedTokenAccountsByOwner(
      owner,
      { mint },
      commitment
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
      let amountBn: bigint
      try {
        amountBn = BigInt(amountStr)
      } catch {
        continue
      }
      if (amountBn < minAmount) continue
      const delegate = info.delegate
      if (delegate && typeof delegate === 'string' && delegate !== '') continue
      return { tokenProgram, tokenAccount: pubkey }
    }
  } catch {
    // fall through to ATA checks
  }
  for (const programId of NFT_TOKEN_PROGRAM_IDS) {
    try {
      const ata = await getAssociatedTokenAddress(
        mint,
        owner,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const acc = await getAccount(connection, ata, commitment, programId)
      if (acc.amount >= minAmount && !acc.delegate) {
        return { tokenProgram: programId, tokenAccount: ata }
      }
    } catch {
      continue
    }
  }
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

/** Solana RPC typically allows ~100 accounts per `getMultipleAccounts`; one request replaces N `getAccountInfo`s. */
const METADATA_ACCOUNT_FETCH_CHUNK = 100

/** Limit parallel off-chain metadata JSON fetches (not Helius, but avoids flooding the browser tab). */
const METADATA_JSON_FETCH_CONCURRENCY = 8

export interface WalletNft {
  mint: string
  tokenAccount: string
  amount: string
  decimals: number
  metadataUri: string | null
  name: string | null
  image: string | null
  collectionName: string | null
  /** Metaplex verified-collection mint when known (e.g. Helius DAS grouping). */
  collectionMint?: string | null
  /** Token-metadata symbol when resolved (e.g. client RPC path). */
  symbol?: string | null
  /**
   * DAS / parsed token account: frozen.
   * For pNFTs this can be true without a true stake/nest lock — see
   * {@link isWalletNftTransferLocked} in `nft-transfer-lock.ts` (needs freeze + delegate).
   */
  frozen?: boolean | null
  /** DAS / parsed token account: delegated (staked, nested, or leftover CM). */
  delegated?: boolean | null
  /** DAS asset interface when known (e.g. ProgrammableNFT, MplCoreAsset). */
  interface?: string | null
  /** DAS compression.compressed — cNFTs need a special single-NFT send path. */
  compressed?: boolean | null
}

/**
 * For escrow deposit when the prize was typed/pasted instead of picked from the wallet grid.
 * `depositPrizeNftToEscrowFromWallet` resolves SPL token accounts on-chain or uses Core/compressed paths.
 */
export function minimalWalletNftForEscrowTransfer(mint: string): WalletNft {
  const m = mint.trim()
  return {
    mint: m,
    tokenAccount: '',
    amount: '1',
    decimals: 0,
    metadataUri: null,
    name: null,
    image: null,
    collectionName: null,
    collectionMint: null,
    symbol: null,
  }
}

export interface WalletToken {
  mint: string
  /** Ticker when known (Metaplex / on-chain); otherwise a short mint fallback. */
  symbol: string
  /** Human name when Metaplex metadata exists. */
  name: string | null
  balance: string
  decimals: number
  tokenAccount: string
}

/** Display label for UI lists — prefer name, then symbol, then short mint. */
export function walletTokenDisplayName(token: Pick<WalletToken, 'name' | 'symbol' | 'mint'>): string {
  const name = token.name?.trim()
  if (name) return name
  const symbol = token.symbol?.trim()
  if (symbol && !/^Token \(/i.test(symbol)) return symbol
  const m = token.mint.trim()
  return m.length > 12 ? `${m.slice(0, 4)}…${m.slice(-4)}` : m
}

/** Parse Metaplex Token Metadata account data (on-chain buffer) to URI / name / symbol. */
function parseMetaplexMetadataAccountData(data: Uint8Array): { uri: string; name: string; symbol: string } | null {
  if (!data || data.length < 69) return null
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
  try {
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

async function fetchMetaplexMetadataBatch(
  connection: Connection,
  mints: PublicKey[]
): Promise<Array<{ uri: string; name: string; symbol: string } | null>> {
  if (mints.length === 0) return []
  const pdas = mints.map(
    (mint) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
        METADATA_PROGRAM_ID
      )[0]
  )
  const out: Array<{ uri: string; name: string; symbol: string } | null> = []
  for (let i = 0; i < pdas.length; i += METADATA_ACCOUNT_FETCH_CHUNK) {
    const slice = pdas.slice(i, i + METADATA_ACCOUNT_FETCH_CHUNK)
    let infos: (AccountInfo<Buffer> | null)[]
    try {
      // Same default commitment as `getAccountInfo(pubkey)` (single-arg) on this Connection.
      infos = await connection.getMultipleAccountsInfo(slice)
    } catch {
      infos = slice.map(() => null)
    }
    for (const info of infos) {
      if (!info?.data) {
        out.push(null)
        continue
      }
      out.push(parseMetaplexMetadataAccountData(info.data))
    }
  }
  return out
}

/** Fetch JSON from metadata URI and return name + image (with basic CORS-safe handling). */
async function fetchMetadataJson(uri: string): Promise<{
  name?: string
  image?: string
  collection?: { name?: string; key?: string }
} | null> {
  try {
    const res = await fetch(uri, { cache: 'force-cache' })
    if (!res.ok) return null
    const json = (await res.json()) as {
      name?: string
      image?: string
      collection?: { name?: string; key?: string }
    }
    return json
  } catch {
    return null
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++
      results[i] = await mapper(items[i]!, i)
    }
  })
  await Promise.all(workers)
  return results
}


/**
 * Fetch all NFTs (token accounts with decimals 0) in the wallet.
 * Includes both SPL Token and Token-2022 so any NFT can be selected for a raffle.
 * Optionally fetches Metaplex metadata and off-chain JSON for name/image.
 */
export async function getWalletNfts(
  connection: Connection,
  ownerPublicKey: PublicKey,
  options?: { fetchMetadata?: boolean; /** Include frozen/delegated holdings (flags set on WalletNft). */ includeLocked?: boolean }
): Promise<WalletNft[]> {
  const fetchMetadata = options?.fetchMetadata !== false
  const includeLocked = options?.includeLocked === true
  const rows: Array<{
    mint: string
    tokenAccount: string
    amount: string
    decimals: number
    frozen: boolean
    delegated: boolean
  }> = []
  for (const programId of NFT_TOKEN_PROGRAM_IDS) {
    const response = await connection.getParsedTokenAccountsByOwner(ownerPublicKey, {
      programId,
    })
    for (const { pubkey, account } of response.value) {
      const info = account.data?.parsed?.info
      if (!info) continue
      const delegate = info.delegate
      const delegated = Boolean(delegate && typeof delegate === 'string' && delegate !== '')
      const state = typeof (info as { state?: string }).state === 'string'
        ? (info as { state?: string }).state!.toLowerCase()
        : ''
      const frozen = state === 'frozen'
      // True transfer locks are freeze+delegate (Gen2 nest / CM freeze escrow / pNFT stake).
      // Exclude only those when includeLocked is false. Keep:
      // - leftover CM delegate without freeze (sendable)
      // - pNFT freeze without lock delegate (transferable via Token Metadata)
      if (!includeLocked && frozen && delegated) continue
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
      rows.push({ mint, tokenAccount, amount, decimals, frozen, delegated })
    }
  }

  if (!fetchMetadata || rows.length === 0) {
    return rows.map((row) => ({
      ...row,
      metadataUri: null,
      name: null,
      image: null,
      collectionName: null,
      collectionMint: null,
      symbol: null,
      interface: null,
    }))
  }

  const mintKeys = rows.map((r) => new PublicKey(r.mint))
  const onChainMeta = await fetchMetaplexMetadataBatch(connection, mintKeys)

  const enriched = await mapWithConcurrency(rows, METADATA_JSON_FETCH_CONCURRENCY, async (row, i) => {
    let metadataUri: string | null = null
    let name: string | null = null
    let image: string | null = null
    let collectionName: string | null = null
    let collectionMint: string | null = null
    let symbol: string | null = null
    const meta = onChainMeta[i] ?? null
    if (meta) {
      metadataUri = meta.uri || null
      name = meta.name || null
      symbol = meta.symbol ? meta.symbol.replace(/\0/g, '').trim() || null : null
      const json = meta.uri ? await fetchMetadataJson(meta.uri) : null
      if (json) {
        if (json.name) name = json.name
        if (json.image) image = json.image
        if (json.collection?.name) collectionName = json.collection.name
        if (json.collection?.key?.trim()) collectionMint = json.collection.key.trim()
      }
    }
    return {
      ...row,
      metadataUri,
      name,
      image,
      collectionName,
      collectionMint,
      symbol,
      interface: null,
    }
  })

  return enriched
}

function isLikelyNftTokenAccount(decimals: number, amount: string): boolean {
  if (amount === '0') return true
  if (decimals === 0 && (amount === '1' || Number(amount) === 1)) return true
  return false
}

function cleanMetaplexString(raw: string | null | undefined): string | null {
  if (!raw) return null
  const t = raw.replace(/\0/g, '').trim()
  return t || null
}

/**
 * Fetch fungible SPL / Token-2022 balances in the wallet.
 * Resolves Metaplex name/symbol when on-chain metadata exists (so UI can show “OWL” not a mint).
 */
export async function getWalletTokens(
  connection: Connection,
  ownerPublicKey: PublicKey
): Promise<WalletToken[]> {
  const programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const
  const raw: Array<{
    mint: string
    balance: string
    decimals: number
    tokenAccount: string
    parsedSymbol?: string
  }> = []

  for (const programId of programs) {
    let response: Awaited<ReturnType<Connection['getParsedTokenAccountsByOwner']>>
    try {
      response = await connection.getParsedTokenAccountsByOwner(ownerPublicKey, { programId })
    } catch {
      continue
    }
    for (const { pubkey, account } of response.value) {
      const info = account.data?.parsed?.info
      if (!info?.mint) continue
      const decimals = Number(info.tokenAmount?.decimals ?? 0)
      const amount = String(info.tokenAmount?.amount ?? '0')
      if (isLikelyNftTokenAccount(decimals, amount)) continue
      const mint = info.mint as string
      const parsedSymbol =
        typeof info.tokenAmount?.uiTokenAmount?.symbol === 'string'
          ? info.tokenAmount.uiTokenAmount.symbol
          : undefined
      raw.push({
        mint,
        balance: amount,
        decimals,
        tokenAccount: pubkey.toBase58(),
        parsedSymbol,
      })
    }
  }

  if (raw.length === 0) return []

  // One metadata account fetch per unique mint (shared across duplicate ATAs if any).
  const uniqueMints = [...new Set(raw.map((t) => t.mint))]
  const mintKeys = uniqueMints.map((m) => new PublicKey(m))
  const metas = await fetchMetaplexMetadataBatch(connection, mintKeys)
  const metaByMint = new Map<string, { name: string | null; symbol: string | null }>()
  uniqueMints.forEach((mint, i) => {
    const meta = metas[i]
    metaByMint.set(mint, {
      name: cleanMetaplexString(meta?.name),
      symbol: cleanMetaplexString(meta?.symbol),
    })
  })

  const known = knownFungibleLabels()

  return raw.map((t) => {
    const meta = metaByMint.get(t.mint)
    const knownLabel = known.get(t.mint)
    const symbol =
      knownLabel?.symbol ||
      cleanMetaplexString(t.parsedSymbol) ||
      meta?.symbol ||
      `Token (${t.mint.slice(0, 4)}…)`
    const name = knownLabel?.name || meta?.name || null
    return {
      mint: t.mint,
      symbol,
      name,
      balance: t.balance,
      decimals: t.decimals,
      tokenAccount: t.tokenAccount,
    }
  })
}

/** Platform-known mints so OwlSend shows friendly names even without Metaplex metadata. */
function knownFungibleLabels(): Map<string, { name: string; symbol: string }> {
  const map = new Map<string, { name: string; symbol: string }>()
  map.set('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', {
    name: 'USD Coin',
    symbol: 'USDC',
  })
  map.set('Cndm5E8m1EnCvduCp1EsakUjEw2jKGTUCTa3iL48dSuB', {
    name: 'Bamboo',
    symbol: 'BAMBOO',
  })
  map.set('BBLpindmy8n5ACcYyQmwsZbsT651g9u7C8TdKcgFBAGS', {
    name: 'GOATS OF SOLANA',
    symbol: 'GOATS',
  })
  const owl =
    typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_OWL_MINT_ADDRESS?.trim() : undefined
  if (owl) {
    map.set(owl, { name: 'Owltopia', symbol: 'OWL' })
  }
  return map
}
