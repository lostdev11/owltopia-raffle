/**
 * Parse a Solana transaction to extract the NFT mint transferred to the prize escrow.
 * Used when escrow holds multiple NFTs - the deposit tx identifies which mint belongs to this raffle.
 *
 * Supports: SPL Token Transfer, Token-2022 Transfer, TransferChecked, and Metaplex/Token Metadata
 * deposits whose SPL CPI is only visible via meta.pre/postTokenBalances or inner instructions.
 * Mpl Core and compressed NFTs use different flows (verify-prize-deposit has Core fallback).
 */
import { Connection, PublicKey } from '@solana/web3.js'
import { getAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import bs58 from 'bs58'

const TOKEN_PROGRAM_IDS = [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]

// SPL Token instruction discriminators
const TRANSFER = 3
const TRANSFER_CHECKED = 12

export type TokenBalanceRow = {
  mint?: string
  owner?: string
  uiTokenAmount?: { amount?: string | null } | null
}

export type DepositTxMeta = {
  loadedAddresses?: { writable?: unknown[]; readonly?: unknown[] }
  innerInstructions?: Array<{
    instructions?: Array<{
      programIdIndex?: number
      accounts?: number[]
      accountKeyIndexes?: number[]
      data?: string | Uint8Array | number[]
    }>
  }>
  preTokenBalances?: TokenBalanceRow[] | null
  postTokenBalances?: TokenBalanceRow[] | null
}

type TxMessage = {
  accountKeys?: Array<{ pubkey?: string } | string | PublicKey>
  /** Versioned (v0) messages use static keys + meta.loadedAddresses (ALTs). */
  staticAccountKeys?: Array<{ pubkey?: string } | string | PublicKey>
  instructions?: Array<{
    programIdIndex?: number
    accounts?: number[]
    accountKeyIndexes?: number[]
    data?: string | Uint8Array | number[]
  }>
  /** web3.js Message / MessageV0 field — often present when `instructions` is absent. */
  compiledInstructions?: Array<{
    programIdIndex?: number
    accounts?: number[]
    accountKeyIndexes?: number[]
    data?: string | Uint8Array | number[]
  }>
}

type TxResponse = {
  transaction?: {
    message?: TxMessage
  }
  meta?: DepositTxMeta
}

function getDiscriminatorFromBytes(bytes: Uint8Array): number | null {
  return bytes.length > 0 ? bytes[0]! : null
}

function instructionDataToBytes(data: string | Uint8Array | number[] | undefined): Uint8Array | null {
  if (data == null) return null
  if (data instanceof Uint8Array) return data
  if (Array.isArray(data)) {
    try {
      return Uint8Array.from(data)
    } catch {
      return null
    }
  }
  if (typeof data === 'string') {
    if (!data) return null
    try {
      return bs58.decode(data)
    } catch {
      try {
        // Some RPC paths return base64 instruction data.
        return Uint8Array.from(Buffer.from(data, 'base64'))
      } catch {
        return null
      }
    }
  }
  return null
}

async function fetchTransactionForParsing(
  connection: Connection,
  signature: string
): Promise<TxResponse | null> {
  const fetchOptions = [
    { commitment: 'confirmed' as const, maxSupportedTransactionVersion: 0 },
    { commitment: 'confirmed' as const },
    { commitment: 'finalized' as const, maxSupportedTransactionVersion: 0 },
    { commitment: 'finalized' as const },
  ]
  for (const opts of fetchOptions) {
    try {
      const tx = (await connection.getTransaction(signature, opts as any)) as TxResponse | null
      if (tx?.transaction?.message) return tx
    } catch {
      // Try the next option.
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}

function accountKeyEntryToBase58(k: unknown): string | null {
  if (typeof k === 'string' && k.trim()) return k.trim()
  if (k && typeof k === 'object' && 'pubkey' in k && typeof (k as { pubkey?: string }).pubkey === 'string') {
    const p = (k as { pubkey: string }).pubkey.trim()
    return p || null
  }
  try {
    if (k instanceof PublicKey) return k.toBase58()
    if (k != null) return new PublicKey(k as ConstructorParameters<typeof PublicKey>[0]).toBase58()
  } catch {
    return null
  }
  return null
}

/**
 * Full account list for instruction indexing: legacy `accountKeys`, or v0
 * `staticAccountKeys` + loaded writable + loaded readonly (matches on-chain layout).
 */
function getAccountKeys(tx: TxResponse): string[] {
  const msg = tx?.transaction?.message
  if (!msg) return []

  const resolved: string[] = []
  const staticKeys = msg.staticAccountKeys
  const legacyKeys = msg.accountKeys

  if (Array.isArray(staticKeys) && staticKeys.length > 0) {
    for (const k of staticKeys) {
      const a = accountKeyEntryToBase58(k)
      if (a) resolved.push(a)
    }
  } else if (Array.isArray(legacyKeys)) {
    for (const k of legacyKeys) {
      const a = accountKeyEntryToBase58(k)
      if (a) resolved.push(a)
    }
  }

  const loaded = tx.meta?.loadedAddresses
  if (loaded?.writable?.length) {
    for (const w of loaded.writable) {
      const a = accountKeyEntryToBase58(w)
      if (a) resolved.push(a)
    }
  }
  if (loaded?.readonly?.length) {
    for (const r of loaded.readonly) {
      const a = accountKeyEntryToBase58(r)
      if (a) resolved.push(a)
    }
  }

  return resolved
}

function ixAccountIndexes(ix: {
  accounts?: number[]
  accountKeyIndexes?: number[]
}): number[] {
  if (Array.isArray(ix.accountKeyIndexes) && ix.accountKeyIndexes.length > 0) {
    return ix.accountKeyIndexes
  }
  if (Array.isArray(ix.accounts) && ix.accounts.length > 0) {
    return ix.accounts
  }
  return []
}

type NormalizedIx = {
  programIdIndex: number
  accounts: number[]
  data: string | Uint8Array | number[]
}

/**
 * Outer + inner instructions. Handles legacy `instructions`, web3.js `compiledInstructions`,
 * and ALT-loaded account indexes.
 */
export function collectDepositTxInstructions(tx: TxResponse): NormalizedIx[] {
  const msg = tx.transaction?.message
  const outer = msg?.instructions?.length
    ? msg.instructions
    : msg?.compiledInstructions?.length
      ? msg.compiledInstructions
      : []

  const all: NormalizedIx[] = []
  for (const ix of outer) {
    all.push({
      programIdIndex: ix.programIdIndex ?? 0,
      accounts: ixAccountIndexes(ix),
      data: ix.data ?? '',
    })
  }
  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions ?? []) {
      all.push({
        programIdIndex: ix.programIdIndex ?? 0,
        accounts: ixAccountIndexes(ix),
        data: ix.data ?? '',
      })
    }
  }
  return all
}

function tokenAmount(row: TokenBalanceRow | undefined): bigint {
  const raw = row?.uiTokenAmount?.amount
  if (raw == null || raw === '') return 0n
  try {
    return BigInt(raw)
  } catch {
    return 0n
  }
}

/**
 * Mints whose balance for `owner` increased in this tx (escrow deposit attribution).
 * Prefer this over instruction parsing — works for Token Metadata / pNFT CPI transfers
 * and does not require follow-up getAccount RPC calls.
 */
export function mintsCreditedToOwnerFromTokenBalances(
  meta: DepositTxMeta | null | undefined,
  ownerAddress: string
): Array<{ mint: string; amount: bigint }> {
  const owner = ownerAddress.trim()
  if (!owner || !meta) return []

  const pre = meta.preTokenBalances ?? []
  const post = meta.postTokenBalances ?? []
  const preByMint = new Map<string, bigint>()
  for (const row of pre) {
    if (!row?.mint || row.owner !== owner) continue
    preByMint.set(row.mint, tokenAmount(row))
  }

  const credited: Array<{ mint: string; amount: bigint }> = []
  const seen = new Set<string>()
  for (const row of post) {
    if (!row?.mint || row.owner !== owner) continue
    if (seen.has(row.mint)) continue
    seen.add(row.mint)
    const postAmt = tokenAmount(row)
    const preAmt = preByMint.get(row.mint) ?? 0n
    const delta = postAmt - preAmt
    if (delta > 0n) {
      credited.push({ mint: row.mint, amount: delta })
    }
  }
  return credited
}

/**
 * Pick the best NFT mint credited to escrow from token-balance diffs.
 * Prefers amount === 1 (standard NFT), else the sole credit, else null when ambiguous.
 */
export function pickNftMintFromEscrowCredits(
  credits: Array<{ mint: string; amount: bigint }>
): string | null {
  if (credits.length === 0) return null
  const nftLike = credits.filter((c) => c.amount === 1n)
  if (nftLike.length === 1) return nftLike[0]!.mint
  if (credits.length === 1) return credits[0]!.mint
  if (nftLike.length > 1) {
    // Multiple NFT deposits in one tx — ambiguous; caller may pass preferred mint separately.
    return null
  }
  return null
}

/**
 * When multiple mints were credited, pick `preferredMint` if it was one of them.
 */
export function resolveDepositMintFromCredits(
  credits: Array<{ mint: string; amount: bigint }>,
  preferredMint: string | null | undefined
): string | null {
  const preferred = (preferredMint || '').trim()
  if (preferred) {
    const hit = credits.find((c) => c.mint === preferred && c.amount > 0n)
    if (hit) return hit.mint
  }
  return pickNftMintFromEscrowCredits(credits)
}

function readU64Le(buf: Uint8Array, offset: number): bigint | null {
  if (offset + 8 > buf.length) return null
  let x = 0n
  for (let i = 0; i < 8; i++) x |= BigInt(buf[offset + i]!) << (8n * BigInt(i))
  return x
}

/**
 * Sum SPL / Token-2022 transfer amounts in a tx that credit the escrow ATA for `expectedMint`.
 * Used for fungible partner prizes (deposit tx is required for verify).
 */
export async function sumIncomingSplToEscrowForMint(
  connection: Connection,
  signature: string,
  escrowOwnerAddress: string,
  expectedMint: string
): Promise<bigint | null> {
  const escrow = escrowOwnerAddress.trim()
  const wantMint = expectedMint.trim()
  if (!escrow || !wantMint) return null

  let escrowPk: PublicKey
  let wantMintPk: PublicKey
  try {
    escrowPk = new PublicKey(escrow)
    wantMintPk = new PublicKey(wantMint)
  } catch {
    return null
  }

  const tx = await fetchTransactionForParsing(connection, signature)
  if (!tx?.transaction?.message) return null

  const fromBalances = mintsCreditedToOwnerFromTokenBalances(tx.meta, escrowPk.toBase58()).find(
    (c) => c.mint === wantMintPk.toBase58()
  )
  if (fromBalances && fromBalances.amount > 0n) {
    return fromBalances.amount
  }

  const accountKeys = getAccountKeys(tx)
  if (accountKeys.length === 0) return null

  const allInstructions = collectDepositTxInstructions(tx)
  let total = 0n

  for (const ix of allInstructions) {
    const programId = accountKeys[ix.programIdIndex]
    if (!programId || !TOKEN_PROGRAM_IDS.includes(programId)) continue
    if (ix.accounts.length < 3) continue

    const bytes = instructionDataToBytes(ix.data)
    if (!bytes) continue
    const disc = getDiscriminatorFromBytes(bytes)
    if (disc !== TRANSFER && disc !== TRANSFER_CHECKED) continue

    const tokenProgram = programId === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    const destIndex = disc === TRANSFER_CHECKED ? 2 : 1
    const destTokenAccount = accountKeys[ix.accounts[destIndex]!]
    if (!destTokenAccount) continue

    const amount = readU64Le(bytes, 1)
    if (amount == null || amount <= 0n) continue

    if (disc === TRANSFER_CHECKED) {
      const mintInIx = accountKeys[ix.accounts[1]!]
      if (mintInIx !== wantMintPk.toBase58()) continue
      // Destination must be escrow-owned; confirm via getAccount when possible.
      try {
        const accountInfo = await getAccount(connection, new PublicKey(destTokenAccount), 'confirmed', tokenProgram)
        if (!accountInfo.owner.equals(escrowPk)) continue
        if (!accountInfo.mint.equals(wantMintPk)) continue
        total += amount
      } catch {
        // ATA may lag; TransferChecked already named the mint — trust amount if dest appears in
        // post balances for this owner+mint (handled above). Skip on failure.
        continue
      }
      continue
    }

    try {
      const accountInfo = await getAccount(connection, new PublicKey(destTokenAccount), 'confirmed', tokenProgram)
      if (!accountInfo.owner.equals(escrowPk)) continue
      if (!accountInfo.mint.equals(wantMintPk)) continue
      total += amount
    } catch {
      continue
    }
  }

  return total > 0n ? total : null
}

export async function getMintFromDepositTx(
  connection: Connection,
  signature: string,
  escrowAddress: string,
  preferredMint?: string | null
): Promise<string | null> {
  const detailed = await getMintFromDepositTxDetailed(
    connection,
    signature,
    escrowAddress,
    preferredMint
  )
  return detailed.mint
}

/**
 * Like getMintFromDepositTx, but distinguishes "tx not found on RPC yet" from "tx found, no mint".
 */
export async function getMintFromDepositTxDetailed(
  connection: Connection,
  signature: string,
  escrowAddress: string,
  preferredMint?: string | null
): Promise<{ mint: string | null; txFound: boolean }> {
  const escrow = escrowAddress.trim()
  if (!escrow) return { mint: null, txFound: false }

  let escrowPk: PublicKey
  try {
    escrowPk = new PublicKey(escrow)
  } catch {
    return { mint: null, txFound: false }
  }

  const tx = await fetchTransactionForParsing(connection, signature)
  if (!tx?.transaction?.message) return { mint: null, txFound: false }

  const credits = mintsCreditedToOwnerFromTokenBalances(tx.meta, escrowPk.toBase58())
  const fromBalances = resolveDepositMintFromCredits(credits, preferredMint)
  if (fromBalances) return { mint: fromBalances, txFound: true }

  const accountKeys = getAccountKeys(tx)
  if (accountKeys.length === 0) return { mint: null, txFound: true }

  const allInstructions = collectDepositTxInstructions(tx)
  const preferred = (preferredMint || '').trim()

  for (const ix of allInstructions) {
    const programId = accountKeys[ix.programIdIndex]
    if (!programId || !TOKEN_PROGRAM_IDS.includes(programId)) continue
    if (ix.accounts.length < 3) continue

    const bytes = instructionDataToBytes(ix.data)
    if (!bytes) continue
    const discriminator = getDiscriminatorFromBytes(bytes)
    if (discriminator !== TRANSFER && discriminator !== TRANSFER_CHECKED) continue

    // Transfer: accounts = [source, destination, owner]
    // TransferChecked: accounts = [source, mint, destination, owner]
    const destIndex = discriminator === TRANSFER_CHECKED ? 2 : 1
    const destTokenAccount = accountKeys[ix.accounts[destIndex!]!]
    if (!destTokenAccount) continue

    if (discriminator === TRANSFER_CHECKED) {
      const mintFromIx = accountKeys[ix.accounts[1]!]
      if (!mintFromIx) continue
      if (preferred && mintFromIx !== preferred) continue
      try {
        const tokenProgram =
          programId === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
        const accountInfo = await getAccount(
          connection,
          new PublicKey(destTokenAccount),
          'confirmed',
          tokenProgram
        )
        if (!accountInfo.owner.equals(escrowPk)) continue
        return { mint: accountInfo.mint.toBase58(), txFound: true }
      } catch {
        continue
      }
    }

    try {
      const tokenProgram =
        programId === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
      const accountInfo = await getAccount(
        connection,
        new PublicKey(destTokenAccount),
        'confirmed',
        tokenProgram
      )
      if (!accountInfo.owner.equals(escrowPk)) continue
      const mint = accountInfo.mint.toBase58()
      if (preferred && mint !== preferred) continue
      return { mint, txFound: true }
    } catch {
      continue
    }
  }

  return { mint: null, txFound: true }
}
