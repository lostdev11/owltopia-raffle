/**
 * OwlSwap custodial escrow — dedicated keypair (do not reuse prize escrow).
 * `OWL_SWAP_ESCROW_SECRET_KEY`: JSON array of 64 bytes, or base58 secret key.
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import { getSolanaConnection } from '@/lib/solana/connection'
import {
  OWL_SWAP_COMPUTE_UNIT_LIMIT,
  OWL_SWAP_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
} from '@/lib/owl-swap/constants'

const NFT_AMOUNT = 1n
const TOKEN_PROGRAM_IDS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const

function parseSolanaSecretKeyFromEnv(raw: string | undefined): Keypair | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as number[]
    if (Array.isArray(parsed) && parsed.length >= 64) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed))
    }
  } catch {
    // not JSON
  }
  try {
    const bs58 = require('bs58') as { decode: (s: string) => Uint8Array }
    return Keypair.fromSecretKey(bs58.decode(trimmed))
  } catch {
    return null
  }
}

let escrowKeypairCache: Keypair | null | undefined = undefined

function parseEscrowKeypair(): Keypair | null {
  return parseSolanaSecretKeyFromEnv(process.env.OWL_SWAP_ESCROW_SECRET_KEY)
}

/** Returns the OwlSwap escrow keypair if configured. */
export function getOwlSwapEscrowKeypair(): Keypair | null {
  if (escrowKeypairCache !== undefined) return escrowKeypairCache
  escrowKeypairCache = parseEscrowKeypair()
  return escrowKeypairCache
}

/** Escrow public key base58, or null if unset. */
export function getOwlSwapEscrowPublicKey(): string | null {
  const kp = getOwlSwapEscrowKeypair()
  return kp ? kp.publicKey.toBase58() : null
}

function prependComputeBudget(tx: Transaction): Transaction {
  const already = tx.instructions.some((ix) =>
    ix.programId.equals(ComputeBudgetProgram.programId)
  )
  if (already) return tx
  tx.instructions.unshift(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: OWL_SWAP_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
    }),
    ComputeBudgetProgram.setComputeUnitLimit({
      units: OWL_SWAP_COMPUTE_UNIT_LIMIT,
    })
  )
  return tx
}

/**
 * True when escrow ATA (TOKEN or TOKEN_2022) holds at least 1 of `mint`.
 */
export async function isMintHeldByOwlSwapEscrow(
  mint: string,
  connection: Connection = getSolanaConnection()
): Promise<boolean> {
  const keypair = getOwlSwapEscrowKeypair()
  if (!keypair) return false
  let mintPk: PublicKey
  try {
    mintPk = new PublicKey(mint.trim())
  } catch {
    return false
  }
  for (const programId of TOKEN_PROGRAM_IDS) {
    try {
      const ata = await getAssociatedTokenAddress(
        mintPk,
        keypair.publicKey,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const account = await getAccount(connection, ata, 'confirmed', programId)
      if (account.amount >= NFT_AMOUNT) return true
    } catch {
      // no account
    }
  }
  return false
}

export async function getOwlSwapEscrowTokenAccountForMint(
  mint: string,
  connection: Connection = getSolanaConnection()
): Promise<{ ata: PublicKey; tokenProgram: PublicKey } | null> {
  const keypair = getOwlSwapEscrowKeypair()
  if (!keypair) return null
  let mintPk: PublicKey
  try {
    mintPk = new PublicKey(mint.trim())
  } catch {
    return null
  }
  for (const programId of TOKEN_PROGRAM_IDS) {
    try {
      const ata = await getAssociatedTokenAddress(
        mintPk,
        keypair.publicKey,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const account = await getAccount(connection, ata, 'confirmed', programId)
      if (account.amount >= NFT_AMOUNT) return { ata, tokenProgram: programId }
    } catch {
      // continue
    }
  }
  return null
}

export async function getOwlSwapEscrowSolLamports(
  connection: Connection = getSolanaConnection()
): Promise<number> {
  const keypair = getOwlSwapEscrowKeypair()
  if (!keypair) return 0
  return connection.getBalance(keypair.publicKey, 'confirmed')
}

async function ensureDestAtaIx(params: {
  connection: Connection
  mint: PublicKey
  owner: PublicKey
  payer: PublicKey
  tokenProgram: PublicKey
}): Promise<{ ata: PublicKey; createIx: ReturnType<typeof createAssociatedTokenAccountInstruction> | null }> {
  const ata = await getAssociatedTokenAddress(
    params.mint,
    params.owner,
    false,
    params.tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  try {
    await getAccount(params.connection, ata, 'confirmed', params.tokenProgram)
    return { ata, createIx: null }
  } catch {
    return {
      ata,
      createIx: createAssociatedTokenAccountInstruction(
        params.payer,
        ata,
        params.owner,
        params.mint,
        params.tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
    }
  }
}

export type OwlSwapSettleSide = {
  mints: string[]
  solLamports: number
  recipient: string
}

/**
 * Build + send settlement: escrow releases maker assets → taker and taker assets → maker,
 * including optional SOL sweetener swaps. Fee is expected to already be paid by taker to treasury.
 */
export async function sendOwlSwapSettleTransaction(params: {
  maker: OwlSwapSettleSide
  taker: OwlSwapSettleSide
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const keypair = getOwlSwapEscrowKeypair()
  if (!keypair) {
    return { ok: false, error: 'OwlSwap escrow is not configured (OWL_SWAP_ESCROW_SECRET_KEY).' }
  }

  let makerRecipient: PublicKey
  let takerRecipient: PublicKey
  try {
    makerRecipient = new PublicKey(params.maker.recipient.trim())
    takerRecipient = new PublicKey(params.taker.recipient.trim())
  } catch {
    return { ok: false, error: 'Invalid maker or taker wallet.' }
  }

  const connection = getSolanaConnection()
  const tx = new Transaction()

  // Maker NFTs → taker
  for (const mint of params.maker.mints) {
    const held = await getOwlSwapEscrowTokenAccountForMint(mint, connection)
    if (!held) {
      return { ok: false, error: `Escrow does not hold maker mint ${mint.slice(0, 8)}…` }
    }
    const mintPk = new PublicKey(mint)
    const dest = await ensureDestAtaIx({
      connection,
      mint: mintPk,
      owner: takerRecipient,
      payer: keypair.publicKey,
      tokenProgram: held.tokenProgram,
    })
    if (dest.createIx) tx.add(dest.createIx)
    tx.add(
      createTransferInstruction(
        held.ata,
        dest.ata,
        keypair.publicKey,
        1,
        [],
        held.tokenProgram
      )
    )
  }

  // Taker NFTs → maker
  for (const mint of params.taker.mints) {
    const held = await getOwlSwapEscrowTokenAccountForMint(mint, connection)
    if (!held) {
      return { ok: false, error: `Escrow does not hold taker mint ${mint.slice(0, 8)}…` }
    }
    const mintPk = new PublicKey(mint)
    const dest = await ensureDestAtaIx({
      connection,
      mint: mintPk,
      owner: makerRecipient,
      payer: keypair.publicKey,
      tokenProgram: held.tokenProgram,
    })
    if (dest.createIx) tx.add(dest.createIx)
    tx.add(
      createTransferInstruction(
        held.ata,
        dest.ata,
        keypair.publicKey,
        1,
        [],
        held.tokenProgram
      )
    )
  }

  const makerSol = Math.max(0, Math.floor(params.maker.solLamports))
  const takerSol = Math.max(0, Math.floor(params.taker.solLamports))
  if (makerSol > 0) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: takerRecipient,
        lamports: makerSol,
      })
    )
  }
  if (takerSol > 0) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: makerRecipient,
        lamports: takerSol,
      })
    )
  }

  if (tx.instructions.length === 0) {
    return { ok: false, error: 'Nothing to settle.' }
  }

  prependComputeBudget(tx)
  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [keypair], {
      commitment: 'confirmed',
      skipPreflight: false,
    })
    return { ok: true, signature }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('owl-swap settle failed', msg)
    return { ok: false, error: `Settle failed: ${msg}` }
  }
}

/**
 * Reclaim maker assets from escrow back to maker (cancel / expire).
 */
export async function sendOwlSwapCancelReclaimTransaction(params: {
  makerWallet: string
  mints: string[]
  solLamports: number
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const keypair = getOwlSwapEscrowKeypair()
  if (!keypair) {
    return { ok: false, error: 'OwlSwap escrow is not configured (OWL_SWAP_ESCROW_SECRET_KEY).' }
  }

  let makerPk: PublicKey
  try {
    makerPk = new PublicKey(params.makerWallet.trim())
  } catch {
    return { ok: false, error: 'Invalid maker wallet.' }
  }

  const connection = getSolanaConnection()
  const tx = new Transaction()

  for (const mint of params.mints) {
    const held = await getOwlSwapEscrowTokenAccountForMint(mint, connection)
    if (!held) continue
    const mintPk = new PublicKey(mint)
    const dest = await ensureDestAtaIx({
      connection,
      mint: mintPk,
      owner: makerPk,
      payer: keypair.publicKey,
      tokenProgram: held.tokenProgram,
    })
    if (dest.createIx) tx.add(dest.createIx)
    tx.add(
      createTransferInstruction(
        held.ata,
        dest.ata,
        keypair.publicKey,
        1,
        [],
        held.tokenProgram
      )
    )
  }

  const sol = Math.max(0, Math.floor(params.solLamports))
  if (sol > 0) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: makerPk,
        lamports: sol,
      })
    )
  }

  if (tx.instructions.length === 0) {
    return { ok: true, signature: '' }
  }

  prependComputeBudget(tx)
  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [keypair], {
      commitment: 'confirmed',
      skipPreflight: true,
    })
    return { ok: true, signature }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('owl-swap cancel reclaim failed', msg)
    return { ok: false, error: `Reclaim failed: ${msg}` }
  }
}
