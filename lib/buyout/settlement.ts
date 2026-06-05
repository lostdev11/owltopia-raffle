import {
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
import { getTreasurySigningKeypair } from '@/lib/solana/treasury-signing'
import {
  payoutBuyoutAcceptanceFromFundsEscrow,
  refundBuyoutOfferFromFundsEscrow,
} from '@/lib/raffles/funds-escrow'
import { resolveBuyoutDepositSource } from '@/lib/buyout/deposit-source'
import type { RaffleBuyoutOffer } from '@/lib/types'
import { BUYOUT_TREASURY_FEE_BPS } from '@/lib/buyout/constants'

export type SettlementResult = { ok: true; signature: string } | { ok: false; error: string }

function splitBuyoutAmounts(gross: number, feeBps: number): { winnerNet: number; fee: number } {
  const bps = Number.isFinite(feeBps) ? Math.min(10_000, Math.max(0, Math.floor(feeBps))) : BUYOUT_TREASURY_FEE_BPS
  const fee = Math.round(gross * (bps / 10_000) * 1e9) / 1e9
  const winnerNet = Math.round((gross - fee) * 1e9) / 1e9
  return { winnerNet: Math.max(0, winnerNet), fee: Math.max(0, fee) }
}

export function computeBuyoutSettlement(offer: Pick<RaffleBuyoutOffer, 'amount' | 'treasury_fee_bps'>): {
  winnerNet: number
  treasuryFee: number
} {
  const gross = Number(offer.amount)
  if (!Number.isFinite(gross) || gross <= 0) return { winnerNet: 0, treasuryFee: 0 }
  const { winnerNet, fee } = splitBuyoutAmounts(gross, offer.treasury_fee_bps ?? BUYOUT_TREASURY_FEE_BPS)
  return { winnerNet, treasuryFee: fee }
}

function toSettlementResult(
  r: { ok: true; signature: string } | { ok: false; error: string },
): SettlementResult {
  return r
}

async function getTreasuryTokenProgramForMint(
  mint: PublicKey,
  treasuryPubkey: PublicKey,
): Promise<PublicKey | null> {
  const readConn = getSolanaReadConnection()
  for (const pid of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const ata = await getAssociatedTokenAddress(mint, treasuryPubkey, false, pid, ASSOCIATED_TOKEN_PROGRAM_ID)
      await getAccount(readConn, ata, 'confirmed', pid)
      return pid
    } catch {
      continue
    }
  }
  return null
}

/** Legacy: pay winner net from treasury when the bid was deposited to RAFFLE_RECIPIENT_WALLET. */
async function payoutBuyoutAcceptanceFromTreasury(params: {
  offer: RaffleBuyoutOffer
  winnerWallet: string
}): Promise<SettlementResult> {
  const kp = getTreasurySigningKeypair()
  if (!kp) {
    return {
      ok: false,
      error:
        'Legacy buyout payout requires RAFFLE_RECIPIENT_SECRET_KEY (bid was deposited to treasury before funds-escrow routing).',
    }
  }

  const { winnerNet } = computeBuyoutSettlement(params.offer)
  if (winnerNet <= 0) {
    return { ok: false, error: 'Nothing to pay winner.' }
  }

  const winnerPk = new PublicKey(params.winnerWallet.trim())
  const treasuryPk = kp.publicKey
  const connection = getSolanaConnection()

  try {
    if (params.offer.currency === 'SOL') {
      const lamports = Math.round(winnerNet * LAMPORTS_PER_SOL)
      if (lamports <= 0) return { ok: false, error: 'Invalid SOL payout amount.' }
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: treasuryPk,
          toPubkey: winnerPk,
          lamports,
        }),
      )
      const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
        commitment: 'confirmed',
        maxRetries: 3,
      })
      return { ok: true, signature: sig }
    }

    if (params.offer.currency === 'USDC') {
      const tokenInfo = getTokenInfo('USDC')
      if (!tokenInfo.mintAddress) {
        return { ok: false, error: 'USDC mint not configured.' }
      }
      const mint = new PublicKey(tokenInfo.mintAddress)
      const decimals = tokenInfo.decimals
      const programId = await getTreasuryTokenProgramForMint(mint, treasuryPk)
      if (!programId) {
        return { ok: false, error: 'Treasury has no USDC token account for buyout payout.' }
      }

      const raw = BigInt(Math.round(winnerNet * Math.pow(10, decimals)))
      if (raw <= 0n) return { ok: false, error: 'Invalid USDC payout amount.' }

      const fromAta = await getAssociatedTokenAddress(
        mint,
        treasuryPk,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )
      const toAta = await getAssociatedTokenAddress(
        mint,
        winnerPk,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )

      const tx = new Transaction()
      try {
        await getAccount(getSolanaReadConnection(), toAta, 'confirmed', programId)
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            treasuryPk,
            toAta,
            winnerPk,
            mint,
            programId,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        )
      }
      tx.add(createTransferInstruction(fromAta, toAta, treasuryPk, raw, [], programId))

      const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
        commitment: 'confirmed',
        maxRetries: 3,
      })
      return { ok: true, signature: sig }
    }

    return { ok: false, error: 'Unsupported offer currency.' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

/** Legacy: full refund from treasury when the bid was deposited to RAFFLE_RECIPIENT_WALLET. */
async function refundBuyoutFromTreasury(offer: RaffleBuyoutOffer): Promise<SettlementResult> {
  const kp = getTreasurySigningKeypair()
  if (!kp) {
    return {
      ok: false,
      error:
        'This bid was deposited to the fee treasury before buyouts used funds escrow. Send the refund from RAFFLE_RECIPIENT_WALLET, then record it in Owl Vision admin (Legacy buyout refund).',
    }
  }

  const gross = Number(offer.amount)
  if (!Number.isFinite(gross) || gross <= 0) {
    return { ok: false, error: 'Invalid offer amount.' }
  }

  const bidderPk = new PublicKey(offer.bidder_wallet.trim())
  const treasuryPk = kp.publicKey
  const connection = getSolanaConnection()

  try {
    if (offer.currency === 'SOL') {
      const lamports = Math.round(gross * LAMPORTS_PER_SOL)
      if (lamports <= 0) return { ok: false, error: 'Nothing to refund.' }
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: treasuryPk,
          toPubkey: bidderPk,
          lamports,
        }),
      )
      const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
        commitment: 'confirmed',
        maxRetries: 3,
      })
      return { ok: true, signature: sig }
    }

    if (offer.currency === 'USDC') {
      const tokenInfo = getTokenInfo('USDC')
      if (!tokenInfo.mintAddress) {
        return { ok: false, error: 'USDC mint not configured.' }
      }
      const mint = new PublicKey(tokenInfo.mintAddress)
      const decimals = tokenInfo.decimals
      const programId = await getTreasuryTokenProgramForMint(mint, treasuryPk)
      if (!programId) {
        return { ok: false, error: 'Treasury has no USDC token account for refund.' }
      }

      const raw = BigInt(Math.round(gross * Math.pow(10, decimals)))
      if (raw <= 0n) return { ok: false, error: 'Nothing to refund.' }

      const fromAta = await getAssociatedTokenAddress(
        mint,
        treasuryPk,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )
      const toAta = await getAssociatedTokenAddress(
        mint,
        bidderPk,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )

      const tx = new Transaction()
      try {
        await getAccount(getSolanaReadConnection(), toAta, 'confirmed', programId)
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            treasuryPk,
            toAta,
            bidderPk,
            mint,
            programId,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        )
      }
      tx.add(createTransferInstruction(fromAta, toAta, treasuryPk, raw, [], programId))

      const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
        commitment: 'confirmed',
        maxRetries: 3,
      })
      return { ok: true, signature: sig }
    }

    return { ok: false, error: 'Unsupported offer currency.' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

/** Pay winner net from the wallet that held the accepted bid (funds escrow or legacy treasury). */
export async function payoutBuyoutAcceptance(params: {
  offer: RaffleBuyoutOffer
  winnerWallet: string
}): Promise<SettlementResult> {
  const source = await resolveBuyoutDepositSource(params.offer)
  if (!source) {
    return { ok: false, error: 'Could not verify where this buyout deposit was sent on-chain.' }
  }

  if (source === 'funds_escrow') {
    const { winnerNet, treasuryFee } = computeBuyoutSettlement(params.offer)
    return toSettlementResult(
      await payoutBuyoutAcceptanceFromFundsEscrow({
        winnerWallet: params.winnerWallet,
        winnerNet,
        treasuryFee,
        currency: params.offer.currency,
      }),
    )
  }

  return payoutBuyoutAcceptanceFromTreasury(params)
}

/** Full refund of gross bid to bidder from the wallet that received the deposit. */
export async function refundBuyoutToBidder(offer: RaffleBuyoutOffer): Promise<SettlementResult> {
  const source = await resolveBuyoutDepositSource(offer)
  if (!source) {
    return { ok: false, error: 'Could not verify where this buyout deposit was sent on-chain.' }
  }

  if (source === 'funds_escrow') {
    return toSettlementResult(await refundBuyoutOfferFromFundsEscrow(offer))
  }

  return refundBuyoutFromTreasury(offer)
}
