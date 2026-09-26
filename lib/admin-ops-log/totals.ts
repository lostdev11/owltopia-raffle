import type { AdminOpsLogAsset } from '@/lib/admin-ops-log/constants'

export type PaymentAmountLine = {
  amount: number | null
  asset: AdminOpsLogAsset | null
}

const ASSET_ORDER: AdminOpsLogAsset[] = ['OWL', 'SOL', 'USDC', 'NFT', 'other']

function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Sum numeric amounts grouped by asset (ignores rows with null amount or asset). */
export function sumPaymentsByAsset(lines: PaymentAmountLine[]): Partial<Record<AdminOpsLogAsset, number>> {
  const out: Partial<Record<AdminOpsLogAsset, number>> = {}
  for (const line of lines) {
    const amount = parseAmount(line.amount)
    if (amount == null || !line.asset) continue
    out[line.asset] = (out[line.asset] ?? 0) + amount
  }
  return out
}

/** Human-readable totals e.g. "80 OWL + 0.033 SOL". */
export function formatPaymentTotalsByAsset(totals: Partial<Record<AdminOpsLogAsset, number>>): string {
  const parts: string[] = []
  for (const asset of ASSET_ORDER) {
    const v = totals[asset]
    if (v == null || v === 0) continue
    const display = Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(12)))
    parts.push(`${display} ${asset}`)
  }
  return parts.length ? parts.join(' + ') : '—'
}

/** Prefer payment lines; fall back to legacy single amount on the entry row. */
export function totalsForOpsLogEntry(
  payments: PaymentAmountLine[],
  legacy: PaymentAmountLine | null
): Partial<Record<AdminOpsLogAsset, number>> {
  const fromPayments = sumPaymentsByAsset(payments)
  if (Object.keys(fromPayments).length > 0) return fromPayments
  if (legacy?.amount != null && legacy.asset) {
    return { [legacy.asset]: legacy.amount }
  }
  return {}
}
