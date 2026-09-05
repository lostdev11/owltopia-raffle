/** Lamports reserved for the simple SystemProgram.transfer fee (+ small buffer). */
export const PACK_PAYMENT_FEE_BUFFER_LAMPORTS = 20_000

const LAMPORTS_PER_SOL = 1_000_000_000

/** Matches Solana system transfer logs: "Transfer: insufficient lamports X, need Y" */
const INSUFFICIENT_LAMPORTS_RE =
  /insufficient lamports\s+(\d+)\s*,\s*need\s+(\d+)/i

/**
 * Matches DEFAULT_PHANTOM_PRESIM_FAIL_PREFIX from phantom-presimulate.ts
 * ("Transaction would fail on-chain before wallet approval.")
 */
const PRESIM_FAIL_PREFIX_RE =
  /^Transaction would fail on-chain before wallet approval\.?\s*/i

export function formatPackSolAmount(sol: number, digits = 4): string {
  if (!Number.isFinite(sol) || sol < 0) return '0'
  if (sol === 0) return '0'
  if (sol >= 1) return sol.toFixed(Math.min(digits, 4)).replace(/\.?0+$/, '')
  if (sol >= 0.01) return sol.toFixed(Math.min(digits, 4)).replace(/\.?0+$/, '')
  return sol.toFixed(Math.max(digits, 5)).replace(/\.?0+$/, '')
}

export function packPaymentLamportsNeeded(priceSol: number): number {
  const priceLamports = Math.round(priceSol * LAMPORTS_PER_SOL)
  return priceLamports + PACK_PAYMENT_FEE_BUFFER_LAMPORTS
}

export function parseInsufficientLamports(message: string): {
  haveLamports: number
  needLamports: number
} | null {
  const m = message.match(INSUFFICIENT_LAMPORTS_RE)
  if (!m) return null
  const haveLamports = Number(m[1])
  const needLamports = Number(m[2])
  if (!Number.isFinite(haveLamports) || !Number.isFinite(needLamports)) return null
  return { haveLamports, needLamports }
}

export function insufficientPackSolMessage(input: {
  priceSol: number
  balanceLamports: number
  /** When known from the failed transfer simulation (often equals price only). */
  needLamports?: number
}): string {
  const haveSol = input.balanceLamports / LAMPORTS_PER_SOL
  const priceSol = input.priceSol > 0 ? input.priceSol : 0
  const needFromSim =
    input.needLamports != null && input.needLamports > 0
      ? input.needLamports / LAMPORTS_PER_SOL
      : null
  // Prefer the larger of pack price+fee vs simulated need so fee shortfall is covered in copy.
  const needSol = Math.max(
    priceSol,
    needFromSim ?? 0,
    packPaymentLamportsNeeded(priceSol) / LAMPORTS_PER_SOL
  )
  return (
    `Not enough SOL to claim this pack. ` +
    `You need about ${formatPackSolAmount(needSol)} SOL (pack + network fee) ` +
    `but this wallet has ~${formatPackSolAmount(haveSol)} SOL. Add SOL and try again.`
  )
}

export function packPriceMismatchMessage(expectedSol: number, chargedSol: number): string {
  return (
    `Pack price changed (page showed ${formatPackSolAmount(expectedSol)} SOL, ` +
    `checkout needs ${formatPackSolAmount(chargedSol)} SOL). Refresh the page and try again.`
  )
}

/** True when charged price diverges from the UI price enough that the user should reconfirm. */
export function isPackPriceMismatch(expectedSol: number, chargedSol: number): boolean {
  if (!(expectedSol > 0) || !(chargedSol > 0)) return false
  const abs = Math.abs(chargedSol - expectedSol)
  const rel = abs / expectedSol
  return abs >= 0.001 || rel >= 0.02
}

export function isWalletUserRejection(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('user rejected') ||
    m.includes('user denied') ||
    m.includes('rejected the request') ||
    m.includes('user cancel') ||
    /\bcancell?ed\b/.test(m)
  )
}

/** Soft amber hint for the claim panel when the connected wallet cannot cover pack + fee. */
export function softPackFundHint(input: {
  priceSol: number
  balanceLamports: number
}): string {
  return insufficientPackSolMessage(input)
}

/**
 * Map raw wallet / simulation / RPC payment failures into short claim-panel copy.
 * Pass `priceSol` + optional `balanceLamports` when known so insufficient-funds stays specific.
 */
export function friendlyPackPaymentError(
  err: unknown,
  context?: { priceSol?: number; balanceLamports?: number }
): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  let message = raw.trim() || 'Payment cancelled'
  message = message.replace(PRESIM_FAIL_PREFIX_RE, '').trim() || message

  if (isWalletUserRejection(message)) {
    return 'Payment cancelled in wallet.'
  }

  const parsed = parseInsufficientLamports(message)
  const mentionsInsufficient =
    !!parsed ||
    /insufficient lamports/i.test(message) ||
    /insufficient funds/i.test(message) ||
    /insufficient sol/i.test(message)

  if (mentionsInsufficient) {
    const priceSol =
      context?.priceSol && context.priceSol > 0
        ? context.priceSol
        : parsed
          ? parsed.needLamports / LAMPORTS_PER_SOL
          : 0.1
    const balanceLamports =
      context?.balanceLamports != null
        ? context.balanceLamports
        : parsed
          ? parsed.haveLamports
          : 0
    return insufficientPackSolMessage({
      priceSol,
      balanceLamports,
      needLamports: parsed?.needLamports,
    })
  }

  // Keep short actionable lines; avoid dumping full Solana program logs in the UI.
  if (message.length > 180 || /Program \w+ invoke/i.test(message)) {
    return 'Payment could not be sent. Check your SOL balance and wallet connection, then try again.'
  }

  return message
}
