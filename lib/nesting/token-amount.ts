export function decimalToRawBigint(value: unknown, decimals: number): bigint {
  const raw = String(value ?? '').trim()
  if (!raw) throw new Error('Amount is required')
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) {
    throw new Error('Invalid token decimals')
  }

  const match = raw.match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) throw new Error('Invalid token amount')

  const whole = match[1]
  const fraction = match[2] ?? ''
  if (fraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places`)
  }

  const scale = 10n ** BigInt(decimals)
  const wholeRaw = BigInt(whole) * scale
  const fractionRaw = BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0')
  return wholeRaw + fractionRaw
}
