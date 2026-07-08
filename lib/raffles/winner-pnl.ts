import {
  normalizeRaffleTicketCurrency,
  type RaffleCurrency,
} from '@/lib/raffle-profit'
import { lenientParseNftFloorAmount } from '@/lib/raffles/nft-raffle-economics'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export type WinnerPnlDisplay = {
  amountSpent: number
  prizeValue: number
  currency: RaffleCurrency
  /** Listed NFT floor vs explicit crypto/SPL prize amount. */
  prizeValueKind: 'floor' | 'prize'
  netProfit: number
  /** Null when the win was free (no ticket spend). */
  roiPercent: number | null
  isFreeWin: boolean
}

export type WinnerPnlRaffleLike = {
  prize_type?: string | null
  prize_amount?: number | null
  prize_currency?: string | null
  floor_price?: string | null
  currency?: string | null
}

export type WinnerSpendEntryLike = {
  amount_paid?: number | null
  currency?: string | null
  status?: string | null
  wallet_address?: string | null
}

function roundForCurrency(n: number, currency: RaffleCurrency): number {
  const decimals = currency === 'USDC' ? 2 : 4
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

/** Prize value shown on winner P&L cards (NFT floor or crypto prize). */
export function getWinnerPrizeDisplayValue(
  raffle: WinnerPnlRaffleLike
): { value: number; currency: RaffleCurrency; kind: 'floor' | 'prize' } | null {
  if ((raffle.prize_type || '').toLowerCase() === 'nft') {
    const floorN = lenientParseNftFloorAmount(raffle.floor_price)
    if (floorN == null || floorN <= 0) return null
    return {
      value: floorN,
      currency: normalizeRaffleTicketCurrency(raffle.currency),
      kind: 'floor',
    }
  }

  const amount = raffle.prize_amount != null ? Number(raffle.prize_amount) : NaN
  const currency = normalizeRaffleTicketCurrency(raffle.prize_currency || raffle.currency)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return { value: amount, currency, kind: 'prize' }
}

export function sumConfirmedSpendForWallet(
  entries: WinnerSpendEntryLike[],
  wallet: string,
  targetCurrency: RaffleCurrency
): number {
  const w = wallet.trim()
  if (!w) return 0
  let total = 0
  for (const e of entries) {
    if ((e.status || '').toLowerCase() !== 'confirmed') continue
    const entryWallet = e.wallet_address?.trim()
    if (entryWallet && !walletsEqualSolana(entryWallet, w)) continue
    const cur = normalizeRaffleTicketCurrency(e.currency)
    if (cur !== targetCurrency) continue
    const amt = Number(e.amount_paid)
    if (Number.isFinite(amt) && amt > 0) total += amt
  }
  return roundForCurrency(total, targetCurrency)
}

export function computeWinnerPnlDisplay(
  raffle: WinnerPnlRaffleLike,
  entries: WinnerSpendEntryLike[],
  winnerWallet: string
): WinnerPnlDisplay | null {
  const prize = getWinnerPrizeDisplayValue(raffle)
  if (!prize) return null

  const spent = sumConfirmedSpendForWallet(entries, winnerWallet, prize.currency)
  const isFreeWin = spent <= 0
  const netProfit = roundForCurrency(
    isFreeWin ? prize.value : prize.value - spent,
    prize.currency
  )

  let roiPercent: number | null = null
  if (!isFreeWin && spent > 0) {
    const raw = ((prize.value - spent) / spent) * 100
    roiPercent = Math.round(raw * 10) / 10
  }

  return {
    amountSpent: spent,
    prizeValue: prize.value,
    currency: prize.currency,
    prizeValueKind: prize.kind,
    netProfit,
    roiPercent,
    isFreeWin,
  }
}

export function formatWinnerPnlAmount(value: number, currency: RaffleCurrency): string {
  const decimals = currency === 'USDC' ? 2 : 4
  return `${value.toFixed(decimals)} ${currency}`
}

export function formatWinnerPnlRoi(roiPercent: number): string {
  const sign = roiPercent >= 0 ? '+' : ''
  const abs = Math.abs(roiPercent)
  const text = abs >= 100 ? abs.toFixed(0) : abs.toFixed(1)
  return `${sign}${text}% ROI`
}
