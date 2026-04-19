/**
 * Funds escrow: ticket proceeds wallet (separate from NFT prize escrow).
 * FUNDS_ESCROW_SECRET_KEY — same formats as PRIZE_ESCROW_SECRET_KEY (JSON byte array or base58).
 */
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { getSolanaConnection, getSolanaReadConnection } from '@/lib/solana/connection'
import { getTokenInfo } from '@/lib/tokens'
import type { Entry, Raffle } from '@/lib/types'

const TOKEN_PROGRAM_IDS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const

function parseFundsEscrowKeypair(): Keypair | null {
  const raw = process.env.FUNDS_ESCROW_SECRET_KEY?.trim()
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
    const bs58 = require('bs58') as { decode: (s: string) => Uint8Array }
    return Keypair.fromSecretKey(bs58.decode(raw))
  } catch {
    return null
  }
}

let fundsEscrowKeypairCache: Keypair | null | undefined = undefined

export function getFundsEscrowKeypair(): Keypair | null {
  if (fundsEscrowKeypairCache !== undefined) return fundsEscrowKeypairCache
  fundsEscrowKeypairCache = parseFundsEscrowKeypair()
  return fundsEscrowKeypairCache
}

export function getFundsEscrowPublicKey(): string | null {
  const kp = getFundsEscrowKeypair()
  return kp ? kp.publicKey.toBase58() : null
}

async function getFundsEscrowTokenProgramForMint(
  mint: PublicKey,
  escrowOwner: PublicKey
): Promise<typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID | null> {
  const connection = getSolanaReadConnection()
  for (const programId of TOKEN_PROGRAM_IDS) {
    try {
      const ata = await getAssociatedTokenAddress(
        mint,
        escrowOwner,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      await getAccount(connection, ata, 'confirmed', programId)
      return programId
    } catch {
      // try next
    }
  }
  return null
}

function treasuryWalletFromEnv(): string | null {
  const w =
    process.env.RAFFLE_RECIPIENT_WALLET?.trim() ||
    process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET?.trim()
  return w || null
}

export type FundsEscrowPayoutResult =
  | { ok: true; signature: string }
  | { ok: false; error: string }

/**
 * Send creator net + platform fee from funds escrow (post-draw settlement).
 */
export async function payoutCreatorAndPlatformFromFundsEscrow(raffle: Raffle): Promise<FundsEscrowPayoutResult> {
  const kp = getFundsEscrowKeypair()
  if (!kp) {
    return { ok: false, error: 'Funds escrow is not configured (FUNDS_ESCROW_SECRET_KEY).' }
  }

  const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
  if (!creatorWallet) {
    return { ok: false, error: 'Raffle has no creator wallet.' }
  }

  const treasury = treasuryWalletFromEnv()
  if (!treasury) {
    return { ok: false, error: 'Treasury wallet not configured (RAFFLE_RECIPIENT_WALLET).' }
  }

  const creatorPayout = Number(raffle.creator_payout_amount ?? 0)
  const platformFee = Number(raffle.platform_fee_amount ?? 0)
  if (!Number.isFinite(creatorPayout) || creatorPayout < 0) {
    return { ok: false, error: 'Invalid creator payout amount.' }
  }
  if (!Number.isFinite(platformFee) || platformFee < 0) {
    return { ok: false, error: 'Invalid platform fee amount.' }
  }

  const currency = (raffle.currency || 'SOL').toUpperCase() as 'SOL' | 'USDC' | 'OWL'
  const connection = getSolanaConnection()
  const escrowPubkey = kp.publicKey
  const creatorPk = new PublicKey(creatorWallet)
  const treasuryPk = new PublicKey(treasury)

  try {
    if (currency === 'SOL') {
      const creatorLamports = Math.round(creatorPayout * LAMPORTS_PER_SOL)
      const feeLamports = Math.round(platformFee * LAMPORTS_PER_SOL)
      if (creatorLamports <= 0 && feeLamports <= 0) {
        return { ok: false, error: 'Nothing to pay out.' }
      }

      const tx = new Transaction()
      if (creatorLamports > 0) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: escrowPubkey,
            toPubkey: creatorPk,
            lamports: creatorLamports,
          })
        )
      }
      if (feeLamports > 0) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: escrowPubkey,
            toPubkey: treasuryPk,
            lamports: feeLamports,
          })
        )
      }

      const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
        commitment: 'confirmed',
        maxRetries: 3,
      })
      return { ok: true, signature: sig }
    }

    const readConn = getSolanaReadConnection()
    const tokenInfo = getTokenInfo(currency)
    if (!tokenInfo.mintAddress) {
      return { ok: false, error: `${currency} mint not configured.` }
    }
    const mint = new PublicKey(tokenInfo.mintAddress)
    const decimals = tokenInfo.decimals
    const programId = await getFundsEscrowTokenProgramForMint(mint, escrowPubkey)
    if (!programId) {
      return {
        ok: false,
        error: `Funds escrow has no ${currency} token account for this mint. Fund the escrow ATA first.`,
      }
    }

    const creatorRaw = BigInt(Math.round(creatorPayout * Math.pow(10, decimals)))
    const feeRaw = BigInt(Math.round(platformFee * Math.pow(10, decimals)))
    if (creatorRaw <= 0n && feeRaw <= 0n) {
      return { ok: false, error: 'Nothing to pay out.' }
    }

    const fromAta = await getAssociatedTokenAddress(
      mint,
      escrowPubkey,
      false,
      programId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )

    const tx = new Transaction()

    const addTokenPayout = async (toOwner: PublicKey, amount: bigint) => {
      if (amount <= 0n) return
      const toAta = await getAssociatedTokenAddress(
        mint,
        toOwner,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      try {
        await getAccount(readConn, toAta, 'confirmed', programId)
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            escrowPubkey,
            toAta,
            toOwner,
            mint,
            programId,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        )
      }
      tx.add(
        createTransferInstruction(
          fromAta,
          toAta,
          escrowPubkey,
          amount,
          [],
          programId
        )
      )
    }

    await addTokenPayout(creatorPk, creatorRaw)
    await addTokenPayout(treasuryPk, feeRaw)

    const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
      commitment: 'confirmed',
      maxRetries: 3,
    })
    return { ok: true, signature: sig }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

/**
 * Refund one entry's gross from funds escrow to the buyer (failed raffle).
 */
export async function refundEntryFromFundsEscrow(
  raffle: Raffle,
  entry: Entry
): Promise<FundsEscrowPayoutResult> {
  const kp = getFundsEscrowKeypair()
  if (!kp) {
    return { ok: false, error: 'Funds escrow is not configured (FUNDS_ESCROW_SECRET_KEY).' }
  }

  const amount = Number(entry.amount_paid ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Invalid entry amount.' }
  }

  const currency = (entry.currency || raffle.currency || 'SOL').toUpperCase() as 'SOL' | 'USDC' | 'OWL'
  const connection = getSolanaConnection()
  const escrowPubkey = kp.publicKey
  const buyerPk = new PublicKey(entry.wallet_address.trim())

  try {
    if (currency === 'SOL') {
      const lamports = Math.round(amount * LAMPORTS_PER_SOL)
      if (lamports <= 0) return { ok: false, error: 'Nothing to refund.' }
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: escrowPubkey,
          toPubkey: buyerPk,
          lamports,
        })
      )
      const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
        commitment: 'confirmed',
        maxRetries: 3,
      })
      return { ok: true, signature: sig }
    }

    const readConn = getSolanaReadConnection()
    const tokenInfo = getTokenInfo(currency)
    if (!tokenInfo.mintAddress) {
      return { ok: false, error: `${currency} mint not configured.` }
    }
    const mint = new PublicKey(tokenInfo.mintAddress)
    const decimals = tokenInfo.decimals
    const programId = await getFundsEscrowTokenProgramForMint(mint, escrowPubkey)
    if (!programId) {
      return {
        ok: false,
        error: `Funds escrow has no ${currency} token account for this mint.`,
      }
    }

    const raw = BigInt(Math.round(amount * Math.pow(10, decimals)))
    if (raw <= 0n) return { ok: false, error: 'Nothing to refund.' }

    const fromAta = await getAssociatedTokenAddress(
      mint,
      escrowPubkey,
      false,
      programId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
    const toAta = await getAssociatedTokenAddress(
      mint,
      buyerPk,
      false,
      programId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )

    const tx = new Transaction()
    try {
      await getAccount(readConn, toAta, 'confirmed', programId)
    } catch {
      tx.add(
        createAssociatedTokenAccountInstruction(
          escrowPubkey,
          toAta,
          buyerPk,
          mint,
          programId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
    }
    tx.add(
      createTransferInstruction(fromAta, toAta, escrowPubkey, raw, [], programId)
    )

    const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
      commitment: 'confirmed',
      maxRetries: 3,
    })
    return { ok: true, signature: sig }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}
