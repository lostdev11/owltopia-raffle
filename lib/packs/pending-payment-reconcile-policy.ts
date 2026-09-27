import type { PackOpenRow } from '@/lib/packs/types'

/** Do not match orphans until the row is at least this old (client confirm grace). */
export const PACK_OPEN_PENDING_PAYMENT_MIN_AGE_MS = 5 * 60 * 1000
/** Stop scanning very old abandoned `pending_payment` rows (left unchanged in DB). */
export const PACK_OPEN_PENDING_PAYMENT_MAX_AGE_MS = 24 * 60 * 60 * 1000

export const PACK_OPEN_PENDING_PAYMENT_RECONCILE_BATCH_LIMIT = 8
export const PACK_OPEN_PENDING_PAYMENT_SIG_PAGE_LIMIT = 20
/** Allow clock skew / indexing lag between DB `created_at` and on-chain `blockTime`. */
export const PACK_OPEN_PENDING_PAYMENT_BLOCKTIME_SLACK_SEC = 120

export type SignatureTimeInfo = {
  signature: string
  blockTime?: number | null
  err?: unknown
}

export function pendingPaymentReconcileWindowBounds(nowMs = Date.now()): {
  minCreatedIso: string
  maxCreatedIso: string
} {
  const minCreatedMs = nowMs - PACK_OPEN_PENDING_PAYMENT_MAX_AGE_MS
  const maxCreatedMs = nowMs - PACK_OPEN_PENDING_PAYMENT_MIN_AGE_MS
  return {
    minCreatedIso: new Date(minCreatedMs).toISOString(),
    maxCreatedIso: new Date(maxCreatedMs).toISOString(),
  }
}

/** Rows in window, newest checkout first (orphan paid txs are usually recent). */
export function sortPendingPaymentOpensNewestFirst(opens: PackOpenRow[]): PackOpenRow[] {
  return [...opens].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

export function openCreatedAtSec(open: PackOpenRow): number {
  return Math.floor(new Date(open.created_at).getTime() / 1000)
}

export function signatureBlockTimeSec(info: SignatureTimeInfo): number | null {
  return typeof info.blockTime === 'number' && Number.isFinite(info.blockTime)
    ? info.blockTime
    : null
}

/** True when the buyer wallet has at least one sig at/after open creation (cheap pre-filter). */
export function buyerHasSignaturesAfterOpenCreated(
  sigInfos: SignatureTimeInfo[],
  openCreatedSec: number,
  slackSec = PACK_OPEN_PENDING_PAYMENT_BLOCKTIME_SLACK_SEC
): boolean {
  const cutoff = openCreatedSec - slackSec
  return sigInfos.some((info) => {
    const bt = signatureBlockTimeSec(info)
    return bt != null && bt >= cutoff
  })
}

/**
 * When scanning newest-first, stop paging once signatures are older than the earliest
 * open we care about in this buyer batch.
 */
export function shouldStopSignatureScanForBuyerBatch(
  info: SignatureTimeInfo,
  earliestOpenCreatedSec: number,
  slackSec = PACK_OPEN_PENDING_PAYMENT_BLOCKTIME_SLACK_SEC
): boolean {
  const bt = signatureBlockTimeSec(info)
  if (bt == null) return false
  return bt < earliestOpenCreatedSec - slackSec
}

export function filterSignaturesForOpen(
  sigInfos: SignatureTimeInfo[],
  openCreatedSec: number,
  slackSec = PACK_OPEN_PENDING_PAYMENT_BLOCKTIME_SLACK_SEC
): SignatureTimeInfo[] {
  const cutoff = openCreatedSec - slackSec
  return sigInfos.filter((info) => {
    if (info.err) return false
    const bt = signatureBlockTimeSec(info)
    return bt != null && bt >= cutoff
  })
}

/** Among opens with the same quote match, pick the one created closest before payment. */
export function pickPendingOpenForOnChainPayment(
  candidates: PackOpenRow[],
  paymentBlockTimeSec: number,
  slackSec = PACK_OPEN_PENDING_PAYMENT_BLOCKTIME_SLACK_SEC
): PackOpenRow | null {
  if (candidates.length === 0) return null
  const paymentSec = paymentBlockTimeSec
  const eligible = candidates.filter((open) => {
    const createdSec = openCreatedAtSec(open)
    return createdSec <= paymentSec + slackSec
  })
  if (eligible.length === 0) return null
  eligible.sort((a, b) => {
    const da = paymentSec - openCreatedAtSec(a)
    const db = paymentSec - openCreatedAtSec(b)
    return da - db
  })
  return eligible[0] ?? null
}

export function groupPackOpensByBuyer(opens: PackOpenRow[]): Map<string, PackOpenRow[]> {
  const map = new Map<string, PackOpenRow[]>()
  for (const open of opens) {
    const key = open.buyer_wallet.trim().toLowerCase()
    const list = map.get(key) ?? []
    list.push(open)
    map.set(key, list)
  }
  return map
}
