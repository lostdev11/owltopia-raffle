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

function getAccountKeys(tx: TxResponse): string[] {
  const msg = tx?.transaction?.message
  if (!msg) return []
  const keys = msg.accountKeys
  if (!keys) return []
  const resolved: string[] = []
  for (const k of keys) {
    const addr = typeof k === 'string' ? k : (k as { pubkey?: string })?.pubkey
    if (addr) resolved.push(addr)
  }
  const loaded = tx.meta?.loadedAddresses
  if (loaded?.writable) resolved.push(...loaded.writable)
  if (loaded?.readonly) resolved.push(...loaded.readonly)
  return resolved
}

/**
 * Extract the mint address from a transaction that transferred an NFT to the escrow.
 * Returns null if the tx doesn't contain a token transfer to escrow, or parsing fails.
 */
export async function getMintFromDepositTx(
  connection: Connection,
  signature: string,
  escrowAddress: string
): Promise<string | null> {
  const escrow = escrowAddress.trim()
  if (!escrow) return null

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
      const owner = accountInfo.owner.toBase58()
      if (owner !== escrow) continue

      const mint = accountInfo.mint.toBase58()
      return mint
    } catch {
      continue
    }
  }

  return null
}
