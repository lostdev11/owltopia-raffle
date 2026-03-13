/**
 * Prize escrow: platform-held NFT until settlement, then automatic transfer to winner.
 * Requires PRIZE_ESCROW_SECRET_KEY (JSON array of 64 bytes, or base58 secret key).
 */
import { Keypair, PublicKey, Transaction } from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { getSolanaConnection } from '@/lib/solana/connection'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import type { Raffle } from '@/lib/types'

const NFT_AMOUNT = 1n

function parseEscrowKeypair(): Keypair | null {
  const raw = process.env.PRIZE_ESCROW_SECRET_KEY?.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as number[]
    if (Array.isArray(parsed) && parsed.length >= 64) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed))
    }
  } catch {
    // not JSON
  }
  try {
    const bs58 = require('bs58')
    return Keypair.fromSecretKey(bs58.decode(raw))
  } catch {
    return null
  }
}

let escrowKeypairCache: Keypair | null | undefined = undefined

/** Returns the prize escrow keypair if PRIZE_ESCROW_SECRET_KEY is set. */
export function getPrizeEscrowKeypair(): Keypair | null {
  if (escrowKeypairCache !== undefined) return escrowKeypairCache
  escrowKeypairCache = parseEscrowKeypair()
  return escrowKeypairCache
}

/** Returns the prize escrow public key (for showing deposit address). */
export function getPrizeEscrowPublicKey(): string | null {
  const kp = getPrizeEscrowKeypair()
  return kp ? kp.publicKey.toBase58() : null
}

/**
 * Transfer the NFT prize from the platform escrow to the winner.
 * Call after selectWinner for NFT raffles. Idempotent if nft_transfer_transaction already set.
 */
export async function transferNftPrizeToWinner(raffleId: string): Promise<{
  ok: boolean
  signature?: string
  error?: string
}> {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) {
    return { ok: false, error: 'Raffle not found' }
  }
  if (raffle.prize_type !== 'nft' || !raffle.nft_mint_address || !raffle.winner_wallet) {
    return { ok: false, error: 'Raffle is not an NFT raffle or has no winner' }
  }
  if (raffle.nft_transfer_transaction) {
    return { ok: true, signature: raffle.nft_transfer_transaction }
  }

  const keypair = getPrizeEscrowKeypair()
  if (!keypair) {
    return { ok: false, error: 'Prize escrow not configured (PRIZE_ESCROW_SECRET_KEY)' }
  }

  const connection = getSolanaConnection()
  const mint = new PublicKey(raffle.nft_mint_address)
  const winnerPubkey = new PublicKey(raffle.winner_wallet)

  const sourceAta = await getAssociatedTokenAddress(
    mint,
    keypair.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  const destAta = await getAssociatedTokenAddress(
    mint,
    winnerPubkey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

  let destAccountExists = false
  try {
    await getAccount(connection, destAta)
    destAccountExists = true
  } catch {
    destAccountExists = false
  }

  const tx = new Transaction()
  if (!destAccountExists) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        destAta,
        winnerPubkey,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
  }
  tx.add(
    createTransferInstruction(
      sourceAta,
      destAta,
      keypair.publicKey,
      NFT_AMOUNT,
      [],
      TOKEN_PROGRAM_ID
    )
  )

  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.feePayer = keypair.publicKey
    tx.sign(keypair)

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')

    await updateRaffle(raffleId, { nft_transfer_transaction: sig })
    return { ok: true, signature: sig }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Prize escrow transfer failed for raffle ${raffleId}:`, err)
    return { ok: false, error: message }
  }
}

/**
 * Check if the escrow holds at least one token of the given mint (for this raffle).
 * Used to verify prize deposit.
 */
export async function checkEscrowHoldsNft(raffle: Raffle): Promise<{ holds: boolean; error?: string }> {
  if (raffle.prize_type !== 'nft' || !raffle.nft_mint_address) {
    return { holds: false, error: 'Not an NFT raffle or missing mint' }
  }
  const keypair = getPrizeEscrowKeypair()
  if (!keypair) {
    return { holds: false, error: 'Prize escrow not configured' }
  }
  const connection = getSolanaConnection()
  const mint = new PublicKey(raffle.nft_mint_address)
  const ata = await getAssociatedTokenAddress(
    mint,
    keypair.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  try {
    const account = await getAccount(connection, ata)
    const amount = account.amount
    return { holds: amount >= NFT_AMOUNT }
  } catch (err) {
    return { holds: false, error: err instanceof Error ? err.message : String(err) }
  }
}
