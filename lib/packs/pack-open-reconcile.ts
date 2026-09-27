import { Connection, PublicKey } from '@solana/web3.js'
import { confirmAndOpenPack } from '@/lib/packs/open-engine'
import {
  getPackOpenById,
  getPackProductById,
  isPackPaymentSignatureClaimed,
  listPackOpensForReconcile,
  listStalePendingPaymentPackOpens,
} from '@/lib/packs/db'
import { PackOpenRetryableError } from '@/lib/packs/pack-open-errors'
import { payoutCommittedPackOpen } from '@/lib/packs/open-payout'
import { PACK_PRICE_OWL, PACK_PRICE_SOL } from '@/lib/packs/config'
import { verifyPackOwlPayment, verifyPackPayment } from '@/lib/packs/verify-payment'
import { withPackSolanaRpcRetry } from '@/lib/packs/rpc-retry'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import type { PackOpenRow } from '@/lib/packs/types'

export const PACK_OPEN_RECONCILE_PIPELINE_STATUSES = [
  'paying_out',
  'reserved',
  'rolling',
] as const

export const PACK_OPEN_RECONCILE_PIPELINE_MIN_AGE_MS = 3 * 60 * 1000
export const PACK_OPEN_PENDING_PAYMENT_MIN_AGE_MS = 5 * 60 * 1000
const BUYER_SIG_SCAN_LIMIT = 30

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

async function findMatchingPaymentSignatureForOpen(
  open: PackOpenRow,
  connection: Connection
): Promise<string | null> {
  const buyer = open.buyer_wallet.trim()
  let sigInfos: Awaited<ReturnType<Connection['getSignaturesForAddress']>>
  try {
    sigInfos = await withPackSolanaRpcRetry(() =>
      connection.getSignaturesForAddress(new PublicKey(buyer), { limit: BUYER_SIG_SCAN_LIMIT })
    )
  } catch (e) {
    console.error('[pack-open-reconcile] getSignaturesForAddress failed', buyer, e)
    return null
  }

  const product = await getPackProductById(open.product_id)
  const priceSol = Number(product?.price_sol) || PACK_PRICE_SOL
  const currency = open.payment_currency === 'OWL' ? 'OWL' : 'SOL'

  for (const info of sigInfos) {
    if (info.err) continue
    const sig = info.signature
    if (await isPackPaymentSignatureClaimed(sig, open.id)) continue

    const verified =
      currency === 'OWL'
        ? await verifyPackOwlPayment({
            signature: sig,
            buyerWallet: buyer,
            expectedOwl: Number(open.payment_owl_amount) || PACK_PRICE_OWL,
            expectedFeeSol: Number(open.payment_fee_sol) || 0,
            connection,
          })
        : await verifyPackPayment({
            signature: sig,
            buyerWallet: buyer,
            expectedSol: priceSol,
            connection,
          })

    if (verified.ok) {
      return sig
    }
  }
  return null
}

async function reconcileStalePendingPayment(open: PackOpenRow): Promise<'completed' | 'skipped'> {
  const connection = new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
  const sig = await findMatchingPaymentSignatureForOpen(open, connection)
  if (!sig) return 'skipped'

  if (await isPackPaymentSignatureClaimed(sig, open.id)) return 'skipped'

  try {
    await confirmAndOpenPack({
      openId: open.id,
      buyerWallet: open.buyer_wallet,
      paymentSignature: sig,
    })
    return 'completed'
  } catch (e) {
    if (e instanceof PackOpenRetryableError) return 'skipped'
    console.error('[pack-open-reconcile] pending_payment confirm failed', open.id, e)
    return 'skipped'
  }
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

  const pendingCutoff = cutoffIso(PACK_OPEN_PENDING_PAYMENT_MIN_AGE_MS)
  const pendingOpens = await listStalePendingPaymentPackOpens({
    createdBeforeIso: pendingCutoff,
    limit: 10,
  })

  let pendingCompleted = 0
  for (const open of pendingOpens) {
    const fresh = (await getPackOpenById(open.id)) ?? open
    if (fresh.status !== 'pending_payment' || fresh.payment_signature) continue
    const outcome = await reconcileStalePendingPayment(fresh)
    if (outcome === 'completed') pendingCompleted++
  }

  return {
    pipelineScanned: pipelineOpens.length,
    pipelineCompleted,
    pipelineRetryable,
    pendingScanned: pendingOpens.length,
    pendingCompleted,
  }
}
