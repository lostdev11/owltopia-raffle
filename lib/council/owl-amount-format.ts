/**
 * Format SPL raw token amount (bigint) as a decimal string for Postgres NUMERIC / UI (avoids float for the stored value).
 */
/** Convert human OWL amount to raw units (for withdrawals / UI → chain). */
export function owlUiToRawBigint(uiAmount: number, decimals: number): bigint {
  if (!Number.isFinite(uiAmount) || uiAmount <= 0) return 0n
  return BigInt(Math.round(uiAmount * Math.pow(10, decimals)))
}

export function owlRawToDecimalString(totalRaw: bigint, decimals: number): string {
  if (decimals === 0) return totalRaw.toString()
  if (totalRaw === 0n) return '0'

  const neg = totalRaw < 0n
  const v = neg ? -totalRaw : totalRaw
  const base = BigInt(10) ** BigInt(decimals)
  const whole = v / base
  const frac = v % base
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  const s = fracStr.length ? `${whole}.${fracStr}` : `${whole}`
  return neg ? `-${s}` : s
}
