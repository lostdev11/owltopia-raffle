/**
 * Cart batch checkout: merged payout lines must fully allocate every line's gross (`amount_paid`).
 * If these diverge, the wallet could pay an amount that does not match what entries expect — block early.
 */

export class CartBatchPaymentTotalMismatchError extends Error {
  readonly sumLineGross: number
  readonly sumMergedAmounts: number

  constructor(sumLineGross: number, sumMergedAmounts: number) {
    super(
      `cart batch payout totals mismatch: sum(amount_paid)=${sumLineGross} vs sum(merged split)=${sumMergedAmounts}`
    )
    this.name = 'CartBatchPaymentTotalMismatchError'
    this.sumLineGross = sumLineGross
    this.sumMergedAmounts = sumMergedAmounts
  }
}

function sumFinite(nums: readonly number[]): number {
  let s = 0
  for (const n of nums) {
    if (!Number.isFinite(n)) return Number.NaN
    s += n
  }
  return s
}

/**
 * @param lineGrossAmounts — one positive gross per cart line (matches `entries.amount_paid`).
 * @param mergedSplit — output of `mergeBatchPayoutLines` (sum of `amount` across recipients).
 * @param toleranceAbs — absolute lamports/UI float slack (SOL/USDC/OWL all use UI floats here).
 */
export function assertCartBatchGrossMatchesMergedSplit(args: {
  lineGrossAmounts: readonly number[]
  mergedSplit: readonly { amount: number }[]
  toleranceAbs?: number
}): void {
  const sumLines = sumFinite(args.lineGrossAmounts)
  const sumSplit = sumFinite(args.mergedSplit.map(s => s.amount))

  if (!Number.isFinite(sumLines) || !Number.isFinite(sumSplit) || sumLines <= 0 || sumSplit <= 0) {
    throw new CartBatchPaymentTotalMismatchError(sumLines, sumSplit)
  }

  const tol =
    args.toleranceAbs ??
    Math.max(1e-9, sumLines * 1e-12 * Math.max(1, args.lineGrossAmounts.length))

  if (Math.abs(sumLines - sumSplit) > tol) {
    throw new CartBatchPaymentTotalMismatchError(sumLines, sumSplit)
  }
}
