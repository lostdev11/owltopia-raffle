/**
 * Parse a Solana transaction to extract the NFT mint transferred to the prize escrow.
 * Used when escrow holds multiple NFTs - the deposit tx identifies which mint belongs to this raffle.
 *
 * Supports: SPL Token Transfer, Token-2022 Transfer, TransferChecked.
 * Mpl Core and compressed NFTs use different flows (verify-prize-deposit has Core fallback).
 */
import { Connection, PublicKey } from '@solana/web3.js'
import { getAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import bs58 from 'bs58'

const TOKEN_PROGRAM_IDS = [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]

// SPL Token instruction discriminators
const TRANSFER = 3
const TRANSFER_CHECKED = 12

function getDiscriminator(dataB58: string): number | null {
  try {
    const bytes = bs58.decode(dataB58)
    return bytes.length > 0 ? bytes[0]! : null
  } catch {
    return null
  }
}

type TxMessage = {
  accountKeys?: Array<{ pubkey?: string } | string>
  /** Versioned (v0) messages use static keys + meta.loadedAddresses (ALTs). */
  staticAccountKeys?: Array<{ pubkey?: string } | string | PublicKey>
  instructions?: Array<{
    programIdIndex?: number
    accounts?: number[]
    data?: string
  }>
}

type TxResponse = {
  transaction?: {
    message?: TxMessage
  }
  meta?: {
    loadedAddresses?: { writable?: string[]; readonly?: string[] }
  }
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
      if (typeof w === 'string' && w.trim()) resolved.push(w.trim())
    }
  }
  if (loaded?.readonly?.length) {
    for (const r of loaded.readonly) {
      if (typeof r === 'string' && r.trim()) resolved.push(r.trim())
    }
  }

  return resolved
}

/**
 * Extract the mint address from a transaction that transferred an NFT to the escrow.
 * Returns null if the tx doesn't contain a token transfer to escrow, or parsing fails.
 */
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

  let tx: TxResponse
  try {
    tx = (await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })) as TxResponse
  } catch {
    return null
  }
  if (!tx?.transaction?.message) return null

  const accountKeys = getAccountKeys(tx)
  if (accountKeys.length === 0) return null

  const instructions = tx.transaction?.message?.instructions ?? []
  const innerInstructions = (tx.meta as { innerInstructions?: Array<{ instructions: typeof instructions }> })?.innerInstructions ?? []

  const allInstructions: Array<{ programIdIndex: number; accounts: number[]; data: string }> = []
  for (const ix of instructions) {
    allInstructions.push({
      programIdIndex: ix.programIdIndex ?? 0,
      accounts: ix.accounts ?? [],
      data: ix.data ?? '',
    })
  }
  for (const inner of innerInstructions) {
    for (const ix of inner.instructions ?? []) {
      allInstructions.push({
        programIdIndex: ix.programIdIndex ?? 0,
        accounts: ix.accounts ?? [],
        data: ix.data ?? '',
      })
    }
  }

  let total = 0n

  for (const ix of allInstructions) {
    const programId = accountKeys[ix.programIdIndex]
    if (!programId || !TOKEN_PROGRAM_IDS.includes(programId)) continue
    if (ix.accounts.length < 3 || !ix.data) continue

    const tokenProgram = programId === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID

    let disc: number | null
    try {
      const bytes = bs58.decode(ix.data)
      disc = bytes.length > 0 ? bytes[0]! : null
    } catch {
      disc = null
    }
    if (disc !== TRANSFER && disc !== TRANSFER_CHECKED) continue

    const destIndex = disc === TRANSFER_CHECKED ? 2 : 1
    const destTokenAccount = accountKeys[ix.accounts[destIndex]!]
    if (!destTokenAccount) continue

    let amount: bigint | null
    try {
      const b = bs58.decode(ix.data)
      amount = readU64Le(b, 1)
    } catch {
      amount = null
    }
    if (amount == null || amount <= 0n) continue

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
  escrowAddress: string
): Promise<string | null> {
  const escrow = escrowAddress.trim()
  if (!escrow) return null

  let escrowPk: PublicKey
  try {
    escrowPk = new PublicKey(escrow)
  } catch {
    return null
  }

  let tx: TxResponse
  try {
    tx = (await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })) as TxResponse
  } catch {
    return null
  }
  if (!tx?.transaction?.message) return null

  const accountKeys = getAccountKeys(tx)
  if (accountKeys.length === 0) return null

  const instructions = tx.transaction?.message?.instructions ?? []
  const innerInstructions = (tx.meta as { innerInstructions?: Array<{ instructions: typeof instructions }> })?.innerInstructions ?? []

  const allInstructions: Array<{ programIdIndex: number; accounts: number[]; data: string }> = []
  for (const ix of instructions) {
    const programIdIndex = ix.programIdIndex ?? 0
    const accounts = ix.accounts ?? []
    const data = ix.data ?? ''
    allInstructions.push({ programIdIndex, accounts, data })
  }
  for (const inner of innerInstructions) {
    for (const ix of inner.instructions ?? []) {
      const programIdIndex = ix.programIdIndex ?? 0
      const accounts = ix.accounts ?? []
      const data = ix.data ?? ''
      allInstructions.push({ programIdIndex, accounts, data })
    }
  }

  for (const ix of allInstructions) {
    const programId = accountKeys[ix.programIdIndex]
    if (!TOKEN_PROGRAM_IDS.includes(programId)) continue

    if (ix.accounts.length < 3) continue

    const data = ix.data
    if (!data) continue

    const discriminator = getDiscriminator(data)
    if (discriminator !== TRANSFER && discriminator !== TRANSFER_CHECKED) continue

    // Transfer: accounts = [source, destination, owner]
    // TransferChecked: accounts = [source, mint, destination, owner]
    const destIndex = discriminator === TRANSFER_CHECKED ? 2 : 1
    const destAccountIndex = ix.accounts[destIndex]
    const destTokenAccount = accountKeys[destAccountIndex]
    if (!destTokenAccount) continue

    try {
      const tokenProgram = programId === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
      const accountInfo = await getAccount(connection, new PublicKey(destTokenAccount), 'confirmed', tokenProgram)
      if (!accountInfo.owner.equals(escrowPk)) continue

      const mint = accountInfo.mint.toBase58()
      return mint
    } catch {
      continue
    }
  }

  return null
}
