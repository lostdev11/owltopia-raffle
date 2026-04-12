import { getPartnerPrizeTokenByCurrency } from '@/lib/partner-prize-tokens'

function stripHumanAmount(s: string): string | null {
  const t = s.trim().replace(/,/g, '')
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return null
  return t
}

/**
 * Convert a positive decimal string (e.g. "12.345") to raw token units using fixed decimals.
 * Rejects scientific notation and negative values.
 */
export function humanDecimalStringToRawUnits(amount: string, decimals: number): bigint | null {
  const cleaned = stripHumanAmount(amount)
  if (!cleaned) return null
  const [wholePart, fracPart = ''] = cleaned.split('.')
  const whole = wholePart.replace(/^0+(?=\d)/, '') || '0'
  if (fracPart.length > decimals) return null
  const frac = fracPart.padEnd(decimals, '0').slice(0, decimals)
  const combined = `${whole}${frac}`.replace(/^0+(?=\d)/, '') || '0'
  try {
    const n = BigInt(combined)
    if (n <= 0n) return null
    return n
  } catch {
    return null
  }
}

export function humanPartnerPrizeToRawUnits(
  prizeCurrency: string | null | undefined,
  prizeAmount: unknown
): bigint | null {
  const p = getPartnerPrizeTokenByCurrency(prizeCurrency)
  if (!p) return null
  const rawAmt =
    typeof prizeAmount === 'number'
      ? String(prizeAmount)
      : typeof prizeAmount === 'string'
        ? prizeAmount
        : prizeAmount != null
          ? String(prizeAmount)
          : ''
  return humanDecimalStringToRawUnits(rawAmt, p.decimals)
}

export function rawUnitsToHumanString(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString()
  const neg = amount < 0n
  const a = neg ? -amount : amount
  const base = 10n ** BigInt(decimals)
  const whole = a / base
  const frac = (a % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  const s = frac.length > 0 ? `${whole.toString()}.${frac}` : whole.toString()
  return neg ? `-${s}` : s
}
