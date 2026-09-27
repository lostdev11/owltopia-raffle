import { Connection, PublicKey } from '@solana/web3.js'
import { confirmAndOpenPack } from '@/lib/packs/open-engine'
import {
  getPackOpenById,
  getPackProductById,
  isPackPaymentSignatureClaimed,
  listPackOpensForReconcile,
  listPendingPaymentPackOpensInReconcileWindow,
} from '@/lib/packs/db'
import { PackOpenRetryableError } from '@/lib/packs/pack-open-errors'
import { payoutCommittedPackOpen } from '@/lib/packs/open-payout'
import { PACK_PRICE_OWL, PACK_PRICE_SOL } from '@/lib/packs/config'
import {
  buyerHasSignaturesAfterOpenCreated,
  filterSignaturesForOpen,
  groupPackOpensByBuyer,
  openCreatedAtSec,
  pendingPaymentReconcileWindowBounds,
  pickPendingOpenForOnChainPayment,
  PACK_OPEN_PENDING_PAYMENT_MIN_AGE_MS,
  PACK_OPEN_PENDING_PAYMENT_RECONCILE_BATCH_LIMIT,
  PACK_OPEN_PENDING_PAYMENT_SIG_PAGE_LIMIT,
  PACK_OPEN_PENDING_PAYMENT_BLOCKTIME_SLACK_SEC,
  shouldStopSignatureScanForBuyerBatch,
  signatureBlockTimeSec,
  sortPendingPaymentOpensNewestFirst,
  type SignatureTimeInfo,
} from '@/lib/packs/pending-payment-reconcile-policy'
import { verifyPackOwlPayment, verifyPackPayment } from '@/lib/packs/verify-payment'
import { withPackSolanaRpcRetry } from '@/lib/packs/rpc-retry'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import type { PackOpenRow } from '@/lib/packs/types'

export {
  PACK_OPEN_PENDING_PAYMENT_MIN_AGE_MS,
  pendingPaymentReconcileWindowBounds,
} from '@/lib/packs/pending-payment-reconcile-policy'

export const PACK_OPEN_RECONCILE_PIPELINE_STATUSES = [
  'paying_out',
  'reserved',
  'rolling',
] as const

export const PACK_OPEN_RECONCILE_PIPELINE_MIN_AGE_MS = 60 * 1000

function cutoffIso(minAgeMs: number): string {
  return new Date(Date.now() - minAgeMs).toISOString()
}

async function resumePipelineOpen(open: PackOpenRow): Promise<'completed' | 'retryable' | 'skipped'> {
  if (open.open_seed && open.open_commit_hash && open.category) {
    try {
      await payoutCommittedPackOpen({ open, buyerWallet: open.buyer_wallet })
      return 'completed'
    } catch (e) {
      if (e instanceof PackOpenRetryableError) return 'retryable'
      console.error('[pack-open-reconcile] payout resume failed', open.id, e)
      return 'skipped'
    }
  }

  const paymentSignature = open.payment_signature?.trim()
  if (!paymentSignature) return 'skipped'

  try {
    await confirmAndOpenPack({
      openId: open.id,
      buyerWallet: open.buyer_wallet,
      paymentSignature,
    })
    return 'completed'
  } catch (e) {
    if (e instanceof PackOpenRetryableError) return 'retryable'
    console.error('[pack-open-reconcile] confirm resume failed', open.id, e)
    return 'skipped'
  }
}

async function paymentSignatureMatchesOpenQuote(
  open: PackOpenRow,
  signature: string,
  connection: Connection
): Promise<boolean> {
  const buyer = open.buyer_wallet.trim()
  const product = await getPackProductById(open.product_id)
  const priceSol = Number(product?.price_sol) || PACK_PRICE_SOL
  const currency = open.payment_currency === 'OWL' ? 'OWL' : 'SOL'

  const verified =
    currency === 'OWL'
      ? await verifyPackOwlPayment({
          signature,
          buyerWallet: buyer,
          expectedOwl: Number(open.payment_owl_amount) || PACK_PRICE_OWL,
          expectedFeeSol: Number(open.payment_fee_sol) || 0,
          connection,
          exactQuote: true,
        })
      : await verifyPackPayment({
          signature,
          buyerWallet: buyer,
          expectedSol: priceSol,
          connection,
          exactQuote: true,
        })

  return verified.ok
}

async function reconcilePendingPaymentsForBuyer(
  buyerOpens: PackOpenRow[],
  connection: Connection
): Promise<number> {
  const pending = buyerOpens.filter(
    (o) => o.status === 'pending_payment' && !o.payment_signature?.trim()
  )
  if (pending.length === 0) return 0

  const earliestOpenSec = Math.min(...pending.map(openCreatedAtSec))

  let sigInfos: Awaited<ReturnType<Connection['getSignaturesForAddress']>>
  try {
    sigInfos = await withPackSolanaRpcRetry(() =>
      connection.getSignaturesForAddress(new PublicKey(pending[0]!.buyer_wallet.trim()), {
        limit: PACK_OPEN_PENDING_PAYMENT_SIG_PAGE_LIMIT,
      })
    )
  } catch (e) {
    console.error('[pack-open-reconcile] getSignaturesForAddress failed', pending[0]?.buyer_wallet, e)
    return 0
  }

  if (!buyerHasSignaturesAfterOpenCreated(sigInfos, earliestOpenSec)) {
    return 0
  }

  let completed = 0

  for (const info of sigInfos) {
    if (shouldStopSignatureScanForBuyerBatch(info, earliestOpenSec)) {
      break
    }
    if (info.err) continue

    const blockTimeSec = signatureBlockTimeSec(info)
    if (blockTimeSec == null) continue

    const sig = info.signature
    if (await isPackPaymentSignatureClaimed(sig)) continue

    const timeEligible = pending.filter((open) => {
      const createdSec = openCreatedAtSec(open)
      return createdSec <= blockTimeSec + PACK_OPEN_PENDING_PAYMENT_BLOCKTIME_SLACK_SEC
    })
    if (timeEligible.length === 0) continue

    const quoteMatches: PackOpenRow[] = []
    for (const open of timeEligible) {
      if (await paymentSignatureMatchesOpenQuote(open, sig, connection)) {
        quoteMatches.push(open)
      }
    }
    if (quoteMatches.length === 0) continue

    const target =
      quoteMatches.length === 1
        ? quoteMatches[0]!
        : pickPendingOpenForOnChainPayment(quoteMatches, blockTimeSec)
    if (!target) continue

    if (await isPackPaymentSignatureClaimed(sig, target.id)) continue

    try {
      await confirmAndOpenPack({
        openId: target.id,
        buyerWallet: target.buyer_wallet,
        paymentSignature: sig,
      })
      completed++
      return completed
    } catch (e) {
      if (e instanceof PackOpenRetryableError) return completed
      console.error('[pack-open-reconcile] pending_payment confirm failed', target.id, e)
    }
  }

  return completed
}

export async function reconcilePendingPaymentBatch(
  opens: PackOpenRow[],
  connection: Connection
): Promise<number> {
  const sorted = sortPendingPaymentOpensNewestFirst(opens)
  const byBuyer = groupPackOpensByBuyer(sorted)
  let completed = 0
  for (const [, buyerOpens] of byBuyer) {
    completed += await reconcilePendingPaymentsForBuyer(buyerOpens, connection)
  }
  return completed
}

/** @deprecated Prefer reconcilePendingPaymentBatch — kept for tests importing scan helpers. */
export function filterSignaturesForOpenReconcile(
  sigInfos: SignatureTimeInfo[],
  open: PackOpenRow
): SignatureTimeInfo[] {
  return filterSignaturesForOpen(sigInfos, openCreatedAtSec(open))
}

export async function runPackOpenReconcile(): Promise<{
  pipelineScanned: number
  pipelineCompleted: number
  pipelineRetryable: number
  pendingScanned: number
  pendingCompleted: number
}> {
  const pipelineCutoff = cutoffIso(PACK_OPEN_RECONCILE_PIPELINE_MIN_AGE_MS)
  const pipelineOpens = await listPackOpensForReconcile({
    statuses: [...PACK_OPEN_RECONCILE_PIPELINE_STATUSES],
    updatedBeforeIso: pipelineCutoff,
    limit: 20,
  })

  let pipelineCompleted = 0
  let pipelineRetryable = 0
  for (const open of pipelineOpens) {
    const fresh = (await getPackOpenById(open.id)) ?? open
    if (fresh.status === 'completed') continue
    const outcome = await resumePipelineOpen(fresh)
    if (outcome === 'completed') pipelineCompleted++
    else if (outcome === 'retryable') pipelineRetryable++
  }

  const window = pendingPaymentReconcileWindowBounds()
  const pendingOpens = await listPendingPaymentPackOpensInReconcileWindow({
    minCreatedIso: window.minCreatedIso,
    maxCreatedIso: window.maxCreatedIso,
    limit: PACK_OPEN_PENDING_PAYMENT_RECONCILE_BATCH_LIMIT,
  })

  const connection = new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
  const pendingCompleted = await reconcilePendingPaymentBatch(pendingOpens, connection)

  return {
    pipelineScanned: pipelineOpens.length,
    pipelineCompleted,
    pipelineRetryable,
    pendingScanned: pendingOpens.length,
    pendingCompleted,
  }
}
