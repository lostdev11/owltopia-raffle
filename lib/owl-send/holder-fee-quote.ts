/**
 * Server-only: resolve OwlSend platform fee after Owltopia holder discount.
 */

import { getOwlSendFeeLamports, getOwlSendFeeLamportsForCount } from '@/lib/owl-send/fee'
import {
  quoteOwlSendHolderDiscount,
  type OwlSendHolderDiscountQuote,
} from '@/lib/owl-send/holder-discount'
import { getOwlSendNestedHolderCounts } from '@/lib/owl-send/nested-holder-counts'

export type OwlSendHolderFeeQuote = OwlSendHolderDiscountQuote & {
  baseFeeLamportsPerLine: number
  feeLamportsPerLine: number
  lineCount: number
  feeLamportsTotal: number
  checkAvailable: boolean
}

export async function resolveOwlSendHolderFeeQuote(params: {
  wallet: string
  lineCount: number
  /** Ledger verify: bypass in-memory cache for fresher counts. */
  skipCache?: boolean
}): Promise<OwlSendHolderFeeQuote> {
  const lineCount = Math.max(0, Math.floor(params.lineCount))
  // Discounts require active Gen1/Gen2 nests (not wallet hold alone).
  const counts = await getOwlSendNestedHolderCounts(params.wallet)
  void params.skipCache
  const discount = quoteOwlSendHolderDiscount({
    gen1Count: counts.gen1Count,
    gen2Count: counts.gen2Count,
  })
  const baseFeeLamportsPerLine = getOwlSendFeeLamports()
  const feeLamportsTotal = getOwlSendFeeLamportsForCount(lineCount, discount.discountBps)
  const feeLamportsPerLine =
    lineCount > 0 ? Math.floor(feeLamportsTotal / lineCount) : getOwlSendFeeLamportsForCount(1, discount.discountBps)

  return {
    ...discount,
    baseFeeLamportsPerLine,
    feeLamportsPerLine,
    lineCount,
    feeLamportsTotal,
    checkAvailable: counts.checkAvailable,
  }
}
