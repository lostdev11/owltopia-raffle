/**
 * OwlSend SOL affordability — token airdrops pay Owl fee + ATA rent per new
 * destination account. Under-counting rent is what drains wallets mid-send.
 */

import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { OWL_SEND_ATA_RENT_SOL } from '@/lib/owl-send/constants'
import {
  buildOwlSendCostEstimate,
  type OwlSendCostEstimate,
} from '@/lib/owl-send/cost-estimate'
import { formatOwlSendFeeSol } from '@/lib/owl-send/fee'
import { parseInsufficientLamports } from '@/lib/packs/pack-purchase-errors'

/** Leave a little SOL in the wallet after the last approval (fees / dust). */
export const OWL_SEND_SOL_DUST_BUFFER_SOL = 0.005

const PRESIM_FAIL_PREFIX_RE =
  /^(?:This send|Transaction) would fail on-chain before wallet approval\.?\s*/i

/**
 * Per-batch new-ATA counts after adaptive packing.
 * `needsCreateAta` must be in the same recipient order as the flat line list
 * that was packed into `batches`.
 */
export function owlSendTokenScatterAtaCountsPerBatch(
  batches: Array<{ length: number }>,
  needsCreateAta: boolean[]
): number[] {
  let offset = 0
  const out: number[] = []
  for (const batch of batches) {
    const end = offset + batch.length
    if (end > needsCreateAta.length) {
      throw new Error('owlSendTokenScatterAtaCountsPerBatch: needsCreateAta shorter than packed lines')
    }
    let n = 0
    for (let i = offset; i < end; i++) {
      if (needsCreateAta[i]) n += 1
    }
    out.push(n)
    offset = end
  }
  if (offset !== needsCreateAta.length) {
    throw new Error('owlSendTokenScatterAtaCountsPerBatch: needsCreateAta longer than packed lines')
  }
  return out
}

export function sumOwlSendCountsFromIndex(counts: number[], fromIndex: number): number {
  const start = Math.max(0, Math.floor(fromIndex))
  let sum = 0
  for (let i = start; i < counts.length; i++) sum += counts[i] ?? 0
  return sum
}

/** Full session cost for a packed token-scatter plan (known ATA probe). */
export function buildOwlSendTokenScatterCostEstimate(params: {
  lineCount: number
  batchCount: number
  newAtaCount: number
  discountBps?: number
}): OwlSendCostEstimate | null {
  return buildOwlSendCostEstimate({
    nftCount: params.lineCount,
    batchCount: params.batchCount,
    newAtaCount: params.newAtaCount,
    discountBps: params.discountBps,
  })
}

/**
 * SOL still required from `fromBatchIndex` onward (Owl fee + rent + network + dust).
 * Returns null when there is nothing left to send.
 */
export function estimateOwlSendRemainingTokenScatterSol(params: {
  batchLineCounts: number[]
  batchAtaCounts: number[]
  fromBatchIndex: number
  discountBps?: number
}): number | null {
  const { batchLineCounts, batchAtaCounts, fromBatchIndex } = params
  if (batchLineCounts.length !== batchAtaCounts.length) {
    throw new Error('estimateOwlSendRemainingTokenScatterSol: batch count mismatch')
  }
  const remainingLines = sumOwlSendCountsFromIndex(batchLineCounts, fromBatchIndex)
  if (remainingLines < 1) return null
  const remainingAta = sumOwlSendCountsFromIndex(batchAtaCounts, fromBatchIndex)
  const remainingBatches = Math.max(0, batchLineCounts.length - Math.max(0, fromBatchIndex))
  const cost = buildOwlSendCostEstimate({
    nftCount: remainingLines,
    batchCount: Math.max(1, remainingBatches),
    newAtaCount: remainingAta,
    discountBps: params.discountBps,
  })
  if (!cost || cost.totalSolKnown == null) return null
  return cost.totalSolKnown + OWL_SEND_SOL_DUST_BUFFER_SOL
}

export function owlSendSolShortfallMessage(params: {
  needSol: number
  haveSol: number
  newAtaCount?: number
  /** When retrying mid-airdrop. */
  fromApproval?: number
  totalApprovals?: number
}): string {
  const need = formatOwlSendFeeSol(Math.max(0, params.needSol))
  const have = formatOwlSendFeeSol(Math.max(0, params.haveSol))
  const rentNote =
    params.newAtaCount != null && params.newAtaCount > 0
      ? ` Includes ~${formatOwlSendFeeSol(OWL_SEND_ATA_RENT_SOL * params.newAtaCount)} rent for ${params.newAtaCount} new token account${params.newAtaCount === 1 ? '' : 's'} (≈${formatOwlSendFeeSol(OWL_SEND_ATA_RENT_SOL)} each) plus Owl fee.`
      : ' Includes Owl fee and any new token-account rent (~0.002 SOL each).'
  const retry =
    params.fromApproval != null && params.totalApprovals != null
      ? ` Add SOL, then Retry from ${params.fromApproval} of ${params.totalApprovals}.`
      : ' Add SOL and try again.'
  return `Not enough SOL for this OwlSend. Need about ${need} but this wallet has ~${have}.${rentNote}${retry}`
}

/**
 * Rewrite simulation / send failures that are really "wallet out of SOL for
 * fee or ATA rent" into short actionable copy (hides program log spam).
 */
export function friendlyOwlSendInsufficientSolError(
  err: unknown,
  context?: {
    estimatedNeedSol?: number
    balanceSol?: number
    remainingNewAtaCount?: number
    fromApproval?: number
    totalApprovals?: number
  }
): string | null {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const message = raw.replace(PRESIM_FAIL_PREFIX_RE, '').trim() || raw
  const parsed = parseInsufficientLamports(message)
  const mentionsInsufficient =
    !!parsed ||
    /insufficient lamports/i.test(message) ||
    /insufficient funds/i.test(message) ||
    /insufficient sol/i.test(message)
  if (!mentionsInsufficient) return null

  const haveSol =
    context?.balanceSol != null && Number.isFinite(context.balanceSol)
      ? context.balanceSol
      : parsed
        ? parsed.haveLamports / LAMPORTS_PER_SOL
        : 0
  const needFromContext =
    context?.estimatedNeedSol != null && context.estimatedNeedSol > 0
      ? context.estimatedNeedSol
      : null
  const needFromSim = parsed ? parsed.needLamports / LAMPORTS_PER_SOL : null
  // Prefer session estimate (fee + all remaining rent) over the single failing transfer.
  const needSol = Math.max(needFromContext ?? 0, needFromSim ?? 0, haveSol + 0.001)

  return owlSendSolShortfallMessage({
    needSol,
    haveSol,
    newAtaCount: context?.remainingNewAtaCount,
    fromApproval: context?.fromApproval,
    totalApprovals: context?.totalApprovals,
  })
}
