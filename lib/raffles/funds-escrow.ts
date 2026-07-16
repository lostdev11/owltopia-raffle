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
import type { Entry, Raffle, RaffleOffer } from '@/lib/types'

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

/** Buffer for the network fee when checking the escrow's SOL balance. */
const SOL_FEE_BUFFER_LAMPORTS = 15_000

function formatRawTokenAmount(raw: bigint, decimals: number): string {
  return (Number(raw) / Math.pow(10, decimals)).toString()
}

function logFundsEscrowFailure(context: string, details: Record<string, unknown>, error?: unknown): void {
  if (error !== undefined) {
    console.error(`[funds-escrow] ${context}`, details, error)
  } else {
    console.error(`[funds-escrow] ${context}`, details)
  }
}

/**
 * Preflight: escrow token account must hold at least `requiredRaw`. Returns a friendly
 * error message when short; null when it holds enough or when the balance could not be
 * read (an RPC failure never blocks the payout — send/simulation still catches a real
 * shortfall).
 */
async function findEscrowTokenShortfall(params: {
  context: string
  currency: string
  decimals: number
  mint: PublicKey
  programId: typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID
  escrowPubkey: PublicKey
  fromAta: PublicKey
  requiredRaw: bigint
}): Promise<string | null> {
  const { context, currency, decimals, mint, programId, escrowPubkey, fromAta, requiredRaw } = params
  let balanceRaw: bigint
  try {
    const acct = await getAccount(getSolanaReadConnection(), fromAta, 'confirmed', programId)
    balanceRaw = acct.amount
  } catch {
    return null
  }
  if (balanceRaw >= requiredRaw) return null
  logFundsEscrowFailure(`${context}: escrow ${currency} balance is short`, {
    escrow: escrowPubkey.toBase58(),
    tokenAccount: fromAta.toBase58(),
    mint: mint.toBase58(),
    decimals,
    requiredRaw: requiredRaw.toString(),
    balanceRaw: balanceRaw.toString(),
  })
  return (
    `Funds escrow is short of ${currency} for this payout: it needs ` +
    `${formatRawTokenAmount(requiredRaw, decimals)} ${currency} but holds ` +
    `${formatRawTokenAmount(balanceRaw, decimals)}. Please contact support to top up the escrow, then try again.`
  )
}

/**
 * Preflight: escrow wallet must hold the SOL being paid out plus a small fee buffer.
 * Same best-effort contract as {@link findEscrowTokenShortfall}.
 */
async function findEscrowSolShortfall(params: {
  context: string
  escrowPubkey: PublicKey
  requiredLamports: number
}): Promise<string | null> {
  const { context, escrowPubkey, requiredLamports } = params
  let balance: number
  try {
    balance = await getSolanaReadConnection().getBalance(escrowPubkey, 'confirmed')
  } catch {
    return null
  }
  const needed = requiredLamports + SOL_FEE_BUFFER_LAMPORTS
  if (balance >= needed) return null
  logFundsEscrowFailure(`${context}: escrow SOL balance is short`, {
    escrow: escrowPubkey.toBase58(),
    requiredLamports: needed,
    balanceLamports: balance,
  })
  return (
    `Funds escrow is short of SOL for this payout: it needs about ` +
    `${(needed / LAMPORTS_PER_SOL).toFixed(5)} SOL (incl. network fee) but holds ` +
    `${(balance / LAMPORTS_PER_SOL).toFixed(5)}. Please contact support to top up the escrow, then try again.`
  )
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

      const solShortfall = await findEscrowSolShortfall({
        context: 'claim-proceeds',
        escrowPubkey,
        requiredLamports: creatorLamports + feeLamports,
      })
      if (solShortfall) return { ok: false, error: solShortfall }

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

    const tokenShortfall = await findEscrowTokenShortfall({
      context: 'claim-proceeds',
      currency,
      decimals,
      mint,
      programId,
      escrowPubkey,
      fromAta,
      requiredRaw: creatorRaw + feeRaw,
    })
    if (tokenShortfall) return { ok: false, error: tokenShortfall }

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
    logFundsEscrowFailure(
      'claim-proceeds payout failed',
      { escrow: escrowPubkey.toBase58(), currency, creatorPayout, platformFee },
      e
    )
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

  const currency = (entry.currency || raffle.currency || 'SOL').toUpperCase() as
    | 'SOL'
    | 'USDC'
    | 'OWL'
    | 'BAMBOO'
  const connection = getSolanaConnection()
  const escrowPubkey = kp.publicKey
  const buyerPk = new PublicKey(entry.wallet_address.trim())

  try {
    if (currency === 'SOL') {
      const lamports = Math.round(amount * LAMPORTS_PER_SOL)
      if (lamports <= 0) return { ok: false, error: 'Nothing to refund.' }

      const solShortfall = await findEscrowSolShortfall({
        context: 'entry-refund',
        escrowPubkey,
        requiredLamports: lamports,
      })
      if (solShortfall) return { ok: false, error: solShortfall }

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

    const tokenShortfall = await findEscrowTokenShortfall({
      context: 'entry-refund',
      currency,
      decimals,
      mint,
      programId,
      escrowPubkey,
      fromAta,
      requiredRaw: raw,
    })
    if (tokenShortfall) return { ok: false, error: tokenShortfall }

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
    logFundsEscrowFailure(
      'entry-refund payout failed',
      { escrow: escrowPubkey.toBase58(), currency, amount },
      e
    )
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

/** Send SOL or USDC from funds escrow to any wallet (milestone winner / creator return). */
export async function payoutCryptoFromFundsEscrow(params: {
  recipientWallet: string
  amount: number
  currency: 'SOL' | 'USDC'
}): Promise<FundsEscrowPayoutResult> {
  const kp = getFundsEscrowKeypair()
  if (!kp) {
    return { ok: false, error: 'Funds escrow is not configured (FUNDS_ESCROW_SECRET_KEY).' }
  }

  const amount = Number(params.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Invalid payout amount.' }
  }

  const connection = getSolanaConnection()
  const escrowPubkey = kp.publicKey
  const recipientPk = new PublicKey(params.recipientWallet.trim())

  try {
    if (params.currency === 'SOL') {
      const lamports = Math.round(amount * LAMPORTS_PER_SOL)
      if (lamports <= 0) return { ok: false, error: 'Nothing to pay.' }

      const solShortfall = await findEscrowSolShortfall({
        context: 'crypto-payout',
        escrowPubkey,
        requiredLamports: lamports,
      })
      if (solShortfall) return { ok: false, error: solShortfall }

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: escrowPubkey,
          toPubkey: recipientPk,
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
    const tokenInfo = getTokenInfo('USDC')
    if (!tokenInfo.mintAddress) {
      return { ok: false, error: 'USDC mint not configured.' }
    }
    const mint = new PublicKey(tokenInfo.mintAddress)
    const decimals = tokenInfo.decimals
    const programId = await getFundsEscrowTokenProgramForMint(mint, escrowPubkey)
    if (!programId) {
      return { ok: false, error: 'Funds escrow has no USDC token account for this mint.' }
    }

    const raw = BigInt(Math.round(amount * Math.pow(10, decimals)))
    if (raw <= 0n) return { ok: false, error: 'Nothing to pay.' }

    const fromAta = await getAssociatedTokenAddress(
      mint,
      escrowPubkey,
      false,
      programId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
    const toAta = await getAssociatedTokenAddress(
      mint,
      recipientPk,
      false,
      programId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )

    const tokenShortfall = await findEscrowTokenShortfall({
      context: 'crypto-payout',
      currency: 'USDC',
      decimals,
      mint,
      programId,
      escrowPubkey,
      fromAta,
      requiredRaw: raw,
    })
    if (tokenShortfall) return { ok: false, error: tokenShortfall }

    const tx = new Transaction()
    try {
      await getAccount(readConn, toAta, 'confirmed', programId)
    } catch {
      tx.add(
        createAssociatedTokenAccountInstruction(
          escrowPubkey,
          toAta,
          recipientPk,
          mint,
          programId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
    }
    tx.add(createTransferInstruction(fromAta, toAta, escrowPubkey, raw, [], programId))

    const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
      commitment: 'confirmed',
      maxRetries: 3,
    })
    return { ok: true, signature: sig }
  } catch (e) {
    logFundsEscrowFailure(
      'crypto-payout failed',
      { escrow: escrowPubkey.toBase58(), currency: params.currency, amount },
      e
    )
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

/** Refund an expired/superseded NFT buyout bid held in funds escrow. */
export async function refundBuyoutOfferFromFundsEscrow(offer: {
  bidder_wallet: string
  amount: number
  currency: 'SOL' | 'USDC'
}): Promise<FundsEscrowPayoutResult> {
  return refundOfferBidFromFundsEscrow({
    buyer_wallet: offer.bidder_wallet,
    amount: offer.amount,
    currency: offer.currency,
  })
}

/**
 * Pay winner net from funds escrow; send platform fee to raffle treasury in the same transaction.
 */
export async function payoutBuyoutAcceptanceFromFundsEscrow(params: {
  winnerWallet: string
  winnerNet: number
  treasuryFee: number
  currency: 'SOL' | 'USDC'
}): Promise<FundsEscrowPayoutResult> {
  const kp = getFundsEscrowKeypair()
  if (!kp) {
    return { ok: false, error: 'Funds escrow is not configured (FUNDS_ESCROW_SECRET_KEY).' }
  }

  const treasury = treasuryWalletFromEnv()
  if (!treasury) {
    return { ok: false, error: 'Treasury wallet not configured (RAFFLE_RECIPIENT_WALLET).' }
  }

  const winnerNet = Number(params.winnerNet)
  const treasuryFee = Number(params.treasuryFee)
  if (!Number.isFinite(winnerNet) || winnerNet < 0 || !Number.isFinite(treasuryFee) || treasuryFee < 0) {
    return { ok: false, error: 'Invalid buyout payout amounts.' }
  }
  if (winnerNet <= 0) {
    return { ok: false, error: 'Nothing to pay winner.' }
  }

  const connection = getSolanaConnection()
  const escrowPubkey = kp.publicKey
  const winnerPk = new PublicKey(params.winnerWallet.trim())
  const treasuryPk = new PublicKey(treasury)

  try {
    if (params.currency === 'SOL') {
      const winnerLamports = Math.round(winnerNet * LAMPORTS_PER_SOL)
      const feeLamports = Math.round(treasuryFee * LAMPORTS_PER_SOL)
      if (winnerLamports <= 0) return { ok: false, error: 'Invalid SOL payout amount.' }

      const solShortfall = await findEscrowSolShortfall({
        context: 'buyout-payout',
        escrowPubkey,
        requiredLamports: winnerLamports + Math.max(feeLamports, 0),
      })
      if (solShortfall) return { ok: false, error: solShortfall }

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: escrowPubkey,
          toPubkey: winnerPk,
          lamports: winnerLamports,
        }),
      )
      if (feeLamports > 0) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: escrowPubkey,
            toPubkey: treasuryPk,
            lamports: feeLamports,
          }),
        )
      }

      const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
        commitment: 'confirmed',
        maxRetries: 3,
      })
      return { ok: true, signature: sig }
    }

    if (params.currency === 'USDC') {
      const readConn = getSolanaReadConnection()
      const tokenInfo = getTokenInfo('USDC')
      if (!tokenInfo.mintAddress) {
        return { ok: false, error: 'USDC mint not configured.' }
      }
      const mint = new PublicKey(tokenInfo.mintAddress)
      const decimals = tokenInfo.decimals
      const programId = await getFundsEscrowTokenProgramForMint(mint, escrowPubkey)
      if (!programId) {
        return { ok: false, error: 'Funds escrow has no USDC token account for buyout payout.' }
      }

      const winnerRaw = BigInt(Math.round(winnerNet * Math.pow(10, decimals)))
      const feeRaw = BigInt(Math.round(treasuryFee * Math.pow(10, decimals)))
      if (winnerRaw <= 0n) return { ok: false, error: 'Invalid USDC payout amount.' }

      const fromAta = await getAssociatedTokenAddress(
        mint,
        escrowPubkey,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )

      const tokenShortfall = await findEscrowTokenShortfall({
        context: 'buyout-payout',
        currency: 'USDC',
        decimals,
        mint,
        programId,
        escrowPubkey,
        fromAta,
        requiredRaw: winnerRaw + (feeRaw > 0n ? feeRaw : 0n),
      })
      if (tokenShortfall) return { ok: false, error: tokenShortfall }

      const tx = new Transaction()

      const addTokenPayout = async (toOwner: PublicKey, amount: bigint) => {
        if (amount <= 0n) return
        const toAta = await getAssociatedTokenAddress(
          mint,
          toOwner,
          false,
          programId,
          ASSOCIATED_TOKEN_PROGRAM_ID,
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
              ASSOCIATED_TOKEN_PROGRAM_ID,
            ),
          )
        }
        tx.add(createTransferInstruction(fromAta, toAta, escrowPubkey, amount, [], programId))
      }

      await addTokenPayout(winnerPk, winnerRaw)
      await addTokenPayout(treasuryPk, feeRaw)

      const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
        commitment: 'confirmed',
        maxRetries: 3,
      })
      return { ok: true, signature: sig }
    }

    return { ok: false, error: 'Unsupported offer currency.' }
  } catch (e) {
    logFundsEscrowFailure(
      'buyout-payout failed',
      { escrow: escrowPubkey.toBase58(), currency: params.currency, winnerNet, treasuryFee },
      e
    )
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

/**
 * Refund one unaccepted raffle offer amount from funds escrow back to the offer buyer.
 */
export async function refundOfferBidFromFundsEscrow(
  offer: Pick<RaffleOffer, 'buyer_wallet' | 'amount' | 'currency'>
): Promise<FundsEscrowPayoutResult> {
  const kp = getFundsEscrowKeypair()
  if (!kp) {
    return { ok: false, error: 'Funds escrow is not configured (FUNDS_ESCROW_SECRET_KEY).' }
  }

  const amount = Number(offer.amount ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Invalid offer refund amount.' }
  }

  const currency = (offer.currency || 'SOL').toUpperCase() as 'SOL' | 'USDC' | 'OWL'
  const connection = getSolanaConnection()
  const escrowPubkey = kp.publicKey
  const buyerPk = new PublicKey(String(offer.buyer_wallet ?? '').trim())

  try {
    if (currency === 'SOL') {
      const lamports = Math.round(amount * LAMPORTS_PER_SOL)
      if (lamports <= 0) return { ok: false, error: 'Nothing to refund.' }

      const solShortfall = await findEscrowSolShortfall({
        context: 'offer-refund',
        escrowPubkey,
        requiredLamports: lamports,
      })
      if (solShortfall) return { ok: false, error: solShortfall }

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

    const tokenShortfall = await findEscrowTokenShortfall({
      context: 'offer-refund',
      currency,
      decimals,
      mint,
      programId,
      escrowPubkey,
      fromAta,
      requiredRaw: raw,
    })
    if (tokenShortfall) return { ok: false, error: tokenShortfall }

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
    logFundsEscrowFailure(
      'offer-refund failed',
      { escrow: escrowPubkey.toBase58(), currency, amount },
      e
    )
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}
