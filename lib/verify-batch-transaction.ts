/**
 * Validates one on-chain payment against one or more pending raffle entries (cart checkout).
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import type { Entry, Raffle } from '@/lib/types'
import { normalizeRaffleTicketCurrency } from '@/lib/raffle-profit'
import { getTokenInfo } from '@/lib/tokens'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { getTransactionCached } from '@/lib/solana-rpc-transaction-cache'
import { mergeBatchPayoutLines } from '@/lib/entries/batch-payout-lines'
import {
  assertCartBatchGrossMatchesMergedSplit,
  CartBatchPaymentTotalMismatchError,
} from '@/lib/entries/batch-invariants'
import { getFullAccountKeysForTransaction } from '@/lib/verify-transaction'

/** Float merge + RPC balance noise: legacy 12.5µ lamports was too tight for SOL cart batches. */
const SOL_TOLERANCE_LAMPORTS = 150_000n /** ~150k lamports ≈ 0.00015 SOL */
/** Allow modest protocol/fee overrun per batch (mirror single-verify maxExtraFee-ish). */
const SOL_MAX_BATCH_OVER_PER_RECIPIENT_LAMPORTS = BigInt(Math.ceil(0.012 * Number(LAMPORTS_PER_SOL)))

function aggregateLamportDeltas(transaction: NonNullable<Awaited<ReturnType<Connection['getTransaction']>>>): {
  keys: PublicKey[]
  deltas: Map<string, bigint>
} {
  const meta = transaction.meta
  const keysFull = getFullAccountKeysForTransaction({
    transaction: transaction.transaction,
    meta: meta!,
  })
  const pre = meta!.preBalances
  const post = meta!.postBalances
  const deltas = new Map<string, bigint>()
  for (let i = 0; i < keysFull.length; i++) {
    const d = BigInt(post[i]!) - BigInt(pre[i]!)
    const k = keysFull[i]!.toBase58()
    deltas.set(k, (deltas.get(k) ?? 0n) + d)
  }
  return { keys: keysFull, deltas }
}

function expectedRecipientLamportsFromSplit(
  split: readonly { recipient: string; amount: number }[]
): Map<string, bigint> {
  const m = new Map<string, bigint>()
  for (const row of split) {
    const pk = new PublicKey(row.recipient.trim()).toBase58()
    const lamports = BigInt(Math.round(Number(row.amount) * LAMPORTS_PER_SOL))
    m.set(pk, (m.get(pk) ?? 0n) + lamports)
  }
  return m
}

async function expectedOwnerRawFromSplit(
  split: readonly { recipient: string; amount: number }[],
  decimals: number
): Promise<Map<string, bigint>> {
  const m = new Map<string, bigint>()
  const mul = BigInt(Math.pow(10, decimals))
  for (const row of split) {
    const pk = new PublicKey(row.recipient.trim()).toBase58()
    const amt = Number(row.amount)
    if (!Number.isFinite(amt)) continue
    const raw = BigInt(Math.round(amt * Number(mul)))
    m.set(pk, (m.get(pk) ?? 0n) + raw)
  }
  return m
}

async function verifySolBatchAgainstTx(
  transaction: NonNullable<Awaited<ReturnType<Connection['getTransaction']>>>,
  expectedSplit: readonly { recipient: string; amount: number }[],
  payerWalletBase58: string
): Promise<{ valid: boolean; error?: string }> {
  const { deltas } = aggregateLamportDeltas(transaction)
  const payer = new PublicKey(payerWalletBase58.trim()).toBase58()
  const expected = expectedRecipientLamportsFromSplit(expectedSplit)

  let expectedOut = 0n
  for (const lamports of expected.values()) expectedOut += lamports

  for (const [recipient, lamportsNeeded] of expected.entries()) {
    const got = deltas.get(recipient) ?? 0n
    const tolerance =
      SOL_TOLERANCE_LAMPORTS + (lamportsNeeded > 0n ? lamportsNeeded / 25_000n : 0n) /** ~0.004% proportional */
    const minRecv = lamportsNeeded > tolerance ? lamportsNeeded - tolerance : 0n
    if (got < minRecv) {
      return {
        valid: false,
        error: `SOL payout shortfall for recipient ${recipient.slice(0, 8)}… (batch verify)`,
      }
    }
    if (got > lamportsNeeded + SOL_MAX_BATCH_OVER_PER_RECIPIENT_LAMPORTS) {
      return {
        valid: false,
        error: `SOL payout overrun for recipient ${recipient.slice(0, 8)}… (batch verify)`,
      }
    }
  }

  const payerDelta = deltas.get(payer)
  if (payerDelta != null && payerDelta < 0n) {
    const sentApprox = -payerDelta
    const minPaid = expectedOut > SOL_TOLERANCE_LAMPORTS ? expectedOut - SOL_TOLERANCE_LAMPORTS : 0n
    /** Payer SOL drop should cover at least merged gross (+ rent/fees loosened). */
    if (sentApprox + 500_000n < minPaid) {
      return {
        valid: false,
        error: `SOL batch gross mismatch vs payer decrease (possible wrong transaction).`,
      }
    }
  }

  return { valid: true }
}

async function verifySplBatchAgainstTx(
  mintPk: PublicKey,
  decimals: number,
  transaction: NonNullable<Awaited<ReturnType<Connection['getTransaction']>>>,
  expectedSplit: readonly { recipient: string; amount: number }[],
): Promise<{ valid: boolean; error?: string }> {
  const meta = transaction.meta!
  const preTokenBalances = meta.preTokenBalances || []
  const postTokenBalances = meta.postTokenBalances || []
  const keysFull = getFullAccountKeysForTransaction({
    transaction: transaction.transaction,
    meta,
  })

  const expectedByOwner = await expectedOwnerRawFromSplit(expectedSplit, decimals)
  const toleranceRaw = 2n /** small ui rounding × num legs */

  const ataIncreaseForOwnerWallet = async (ownerWallet: string): Promise<bigint | null> => {
    const ownerPk = new PublicKey(ownerWallet.trim())
    const ata = await getAssociatedTokenAddress(mintPk, ownerPk)
    const idx = keysFull.findIndex(key => key.equals(ata))
    if (idx === -1) return null
    const postRow = postTokenBalances.find((b: { accountIndex?: number }) => b.accountIndex === idx)
    const preRow = preTokenBalances.find((b: { accountIndex?: number }) => b.accountIndex === idx)
    if (postRow?.uiTokenAmount?.amount == null) return null
    const postRaw = BigInt(postRow.uiTokenAmount.amount)
    const preRaw = preRow?.uiTokenAmount?.amount != null ? BigInt(preRow.uiTokenAmount.amount) : 0n
    return postRaw - preRaw
  }

  for (const [ownerPk, rawNeeded] of expectedByOwner.entries()) {
    const inc = await ataIncreaseForOwnerWallet(ownerPk)
    if (inc == null || inc + toleranceRaw < rawNeeded) {
      return {
        valid: false,
        error: `${mintPk.toBase58().slice(0, 6)} payout shortfall on batch verification (${ownerPk.slice(0, 6)}…)`,
      }
    }
    if (inc > rawNeeded + toleranceRaw + 3n) {
      /** allow tiny noise but block huge overrun */
      if (inc > rawNeeded + toleranceRaw + BigInt(10 ** Math.max(0, decimals - 4))) {
        return { valid: false, error: 'SPL batch payout overrun (suspicious).' }
      }
    }
  }

  return { valid: true }
}

export async function verifyBatchPaidEntries(
  transactionSignature: string,
  pairs: ReadonlyArray<{ entry: Entry; raffle: Raffle }>,
  options?: { allowExpired?: boolean }
): Promise<{ valid: boolean; error?: string }> {
  try {
    if (pairs.length === 0) {
      return { valid: false, error: 'No entries to verify.' }
    }

    const wallet0 = pairs[0]!.entry.wallet_address.trim()
    for (const { entry } of pairs) {
      if (entry.wallet_address.trim() !== wallet0) {
        return { valid: false, error: 'Wallet mismatch across batch entries.' }
      }
      const st = entry.status.trim()
      if (st !== 'pending') return { valid: false, error: 'Entry not pending for batch verify.' }
      if (entry.referral_complimentary === true || Number(entry.amount_paid) === 0) {
        return { valid: false, error: 'Complimentary tickets cannot use batch verification.' }
      }
    }

    const currencyNorm = normalizeRaffleTicketCurrency(pairs[0]!.entry.currency)
    for (const { entry } of pairs) {
      if (normalizeRaffleTicketCurrency(entry.currency) !== currencyNorm) {
        return { valid: false, error: 'Mixed currencies in batch verify.' }
      }
    }

    const treasuryWallet = process.env.RAFFLE_RECIPIENT_WALLET || process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET
    if (!treasuryWallet) {
      return { valid: false, error: 'Recipient wallet not configured for verification.' }
    }

    const mergedSplit = await mergeBatchPayoutLines({
      treasuryWallet,
      pairs: pairs.map(({ entry, raffle }) => ({
        raffle,
        entry: { amount_paid: Number(entry.amount_paid) },
      })),
    })
    if (mergedSplit.length === 0 || mergedSplit.some(l => !(l.amount > 0) || !l.recipient.trim())) {
      return { valid: false, error: 'Invalid merged payout splits for batch.' }
    }

    try {
      assertCartBatchGrossMatchesMergedSplit({
        lineGrossAmounts: pairs.map(({ entry }) => Number(entry.amount_paid)),
        mergedSplit,
      })
    } catch (e) {
      if (e instanceof CartBatchPaymentTotalMismatchError) {
        console.error('[verifyBatchPaidEntries] payout total mismatch', e.sumLineGross, e.sumMergedAmounts)
        return { valid: false, error: 'Batch payment instructions inconsistent with entries.' }
      }
      throw e
    }

    const rpcUrl = resolveServerSolanaRpcUrl()
    const connection = new Connection(rpcUrl, 'confirmed')

    const transaction = await getTransactionCached(transactionSignature, async () => {
      await new Promise(resolve => setTimeout(resolve, 1000))
      let tx = await connection.getTransaction(transactionSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      })
      if (!tx) {
        tx = await connection.getTransaction(transactionSignature, { commitment: 'confirmed' })
      }
      if (!tx) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        tx = await connection.getTransaction(transactionSignature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        })
      }
      return tx
    })

    if (!transaction) {
      return {
        valid: false,
        error: `Transaction not found: ${transactionSignature}. It may still be confirming.`,
      }
    }

    if (!options?.allowExpired) {
      const txWithBlockTime = transaction as { blockTime?: number | null }
      if (typeof txWithBlockTime.blockTime === 'number') {
        const ageSeconds = Date.now() / 1000 - txWithBlockTime.blockTime
        if (ageSeconds > 3600) {
          return { valid: false, error: 'Transaction too old for batch verification.' }
        }
      }
    }

    if (transaction.meta?.err) {
      return {
        valid: false,
        error: `Transaction failed on-chain: ${JSON.stringify(transaction.meta.err)}`,
      }
    }
    if (!transaction.meta) {
      return { valid: false, error: 'Transaction metadata not available.' }
    }

    const keysResolved = getFullAccountKeysForTransaction({
      transaction: transaction.transaction,
      meta: transaction.meta,
    })
    const feePayerFromTx = keysResolved[0]
    const expectedWalletPubkey = new PublicKey(wallet0)
    if (feePayerFromTx == null || !feePayerFromTx.equals(expectedWalletPubkey)) {
      return {
        valid: false,
        error: 'Batch transaction wallet mismatch: fee payer is not the entry wallet.',
      }
    }

    if (currencyNorm === 'SOL') {
      return verifySolBatchAgainstTx(transaction, mergedSplit, wallet0)
    }

    const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    if (currencyNorm === 'USDC') {
      return verifySplBatchAgainstTx(
        USDC_MINT,
        getTokenInfo('USDC').decimals,
        transaction,
        mergedSplit
      )
    }
    if (currencyNorm === 'OWL') {
      const tokenInfo = getTokenInfo('OWL')
      if (!tokenInfo.mintAddress) {
        return { valid: false, error: 'OWL mint address not configured' }
      }
      return verifySplBatchAgainstTx(
        new PublicKey(tokenInfo.mintAddress),
        tokenInfo.decimals,
        transaction,
        mergedSplit
      )
    }

    return { valid: false, error: `Unsupported currency: ${currencyNorm}` }
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    console.error('verifyBatchPaidEntries:', e)
    return {
      valid: false,
      error: `Verification error: ${errorMessage}. This may be a temporary issue. Please try again.`,
    }
  }
}
