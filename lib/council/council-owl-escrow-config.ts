import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'
import { owlUiToRawBigint } from '@/lib/council/owl-amount-format'

/** Minimum deposit (human OWL). Override with `COUNCIL_ESCROW_MIN_DEPOSIT_UI`. */
export function getCouncilEscrowMinDepositUi(): number {
  const raw = process.env.COUNCIL_ESCROW_MIN_DEPOSIT_UI?.trim()
  const n = raw ? Number.parseFloat(raw) : 1
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function getCouncilEscrowMinDepositRaw(): bigint {
  if (!isOwlEnabled()) return 1n
  const decimals = getTokenInfo('OWL').decimals
  return owlUiToRawBigint(getCouncilEscrowMinDepositUi(), decimals)
}
