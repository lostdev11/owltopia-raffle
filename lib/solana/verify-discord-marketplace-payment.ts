/**
 * Verify SOL or OWL payment for Discord marketplace NFT purchases (memo OWLSHOP:…).
 */
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction,
} from '@solana/web3.js'
import { getSolanaConnection } from '@/lib/solana/connection'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'
import type { NftListingCurrency } from '@/lib/db/discord-marketplace-nfts'

function transactionContainsExactMemo(tx: ParsedTransactionWithMeta, memo: string): boolean {
  if (!memo) return false
  return JSON.stringify(tx).includes(memo)
}

export function extractOwlShopMemosFromParsedTx(tx: ParsedTransactionWithMeta): string[] {
  const s = JSON.stringify(tx)
  const re = /OWLSHOP:[A-F0-9]+/g
  return [...new Set(s.match(re) ?? [])]
}

function tokenDeltaForOwnerMint(
  meta: NonNullable<ParsedTransactionWithMeta['meta']>,
  ownerB58: string,
  mintB58: string
): bigint {
  const pre = meta.preTokenBalances ?? []
  const post = meta.postTokenBalances ?? []
  const preB = pre.find((b) => b.mint === mintB58 && b.owner === ownerB58)
  const postB = post.find((b) => b.mint === mintB58 && b.owner === ownerB58)
  const preAmt = preB?.uiTokenAmount?.amount != null ? BigInt(preB.uiTokenAmount.amount) : 0n
  const postAmt = postB?.uiTokenAmount?.amount != null ? BigInt(postB.uiTokenAmount.amount) : 0n
  return postAmt - preAmt
}

function isParsed(ix: ParsedInstruction | PartiallyDecodedInstruction): ix is ParsedInstruction {
  return 'parsed' in ix && ix.parsed !== undefined
}

function solTransferDeltaToTreasury(
  tx: ParsedTransactionWithMeta,
  treasuryB58: string,
  payerB58: string
): bigint {
  let delta = 0n
  const visit = (ix: ParsedInstruction | PartiallyDecodedInstruction) => {
    if (!isParsed(ix) || !ix.programId.equals(SystemProgram.programId)) return
    const p = ix.parsed as {
      type?: string
      info?: { source?: string; destination?: string; lamports?: number }
    }
    if (p.type !== 'transfer') return
    if (p.info?.source !== payerB58 || p.info?.destination !== treasuryB58) return
    const lamports = p.info?.lamports
    if (typeof lamports === 'number' && Number.isFinite(lamports)) {
      delta += BigInt(Math.floor(lamports))
    }
  }

  for (const ix of tx.transaction.message.instructions as (
    | ParsedInstruction
    | PartiallyDecodedInstruction
  )[]) {
    visit(ix)
  }
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions as (ParsedInstruction | PartiallyDecodedInstruction)[]) {
      visit(ix)
    }
  }
  return delta
}

export type VerifyMarketplaceNftPaymentResult = { ok: true } | { ok: false; error: string }

export async function verifyDiscordMarketplaceNftPayment(params: {
  signature: string
  currency: NftListingCurrency
  expectedAmount: number
  expectedMemo: string
  payerWallet: string
  parsedTransaction?: ParsedTransactionWithMeta | null
}): Promise<VerifyMarketplaceNftPaymentResult> {
  const sig = params.signature.trim()
  if (!sig) return { ok: false, error: 'Missing signature' }

  const treasuryWallet = getRaffleTreasuryWalletAddress()
  if (!treasuryWallet) {
    return { ok: false, error: 'Payment treasury not configured (RAFFLE_RECIPIENT_WALLET)' }
  }

  let payer: PublicKey
  try {
    payer = new PublicKey(params.payerWallet.trim())
  } catch {
    return { ok: false, error: 'Invalid payer wallet' }
  }

  const connection = getSolanaConnection()
  const tx =
    params.parsedTransaction ??
    (await connection.getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    }))

  if (!tx?.meta || tx.meta.err) {
    return { ok: false, error: 'Transaction not found or failed on-chain' }
  }

  if (!transactionContainsExactMemo(tx, params.expectedMemo)) {
    return {
      ok: false,
      error: `Memo "${params.expectedMemo}" not found. Include it in the same transaction as your ${params.currency} payment.`,
    }
  }

  const treasuryB58 = treasuryWallet
  const payerB58 = payer.toBase58()
  const tolerance = 1n

  if (params.currency === 'SOL') {
    const expectedLamports = BigInt(Math.round(params.expectedAmount * LAMPORTS_PER_SOL))
    if (expectedLamports <= 0n) return { ok: false, error: 'Invalid expected SOL amount' }
    const received = solTransferDeltaToTreasury(tx, treasuryB58, payerB58)
    if (received < expectedLamports - tolerance || received > expectedLamports + tolerance) {
      return {
        ok: false,
        error: `SOL amount mismatch: expected ${params.expectedAmount} SOL to treasury, observed ${Number(received) / LAMPORTS_PER_SOL} SOL`,
      }
    }
    return { ok: true }
  }

  if (!isOwlEnabled()) {
    return { ok: false, error: 'OWL token is not configured on this deployment' }
  }
  const owlInfo = getTokenInfo('OWL')
  if (!owlInfo.mintAddress) return { ok: false, error: 'OWL mint not configured' }

  const mintB58 = owlInfo.mintAddress
  const expectedRaw = BigInt(Math.round(params.expectedAmount * Math.pow(10, owlInfo.decimals)))
  if (expectedRaw <= 0n) return { ok: false, error: 'Invalid expected OWL amount' }

  const treasuryDelta = tokenDeltaForOwnerMint(tx.meta, treasuryB58, mintB58)
  const payerDelta = tokenDeltaForOwnerMint(tx.meta, payerB58, mintB58)

  if (treasuryDelta < expectedRaw - tolerance || treasuryDelta > expectedRaw + tolerance) {
    return {
      ok: false,
      error: `OWL amount mismatch: expected ${params.expectedAmount} OWL to treasury`,
    }
  }
  if (payerDelta > -expectedRaw + tolerance || payerDelta < -expectedRaw - tolerance) {
    return {
      ok: false,
      error: 'OWL debit from your wallet does not match the treasury credit',
    }
  }

  return { ok: true }
}
