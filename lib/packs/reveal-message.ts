import type { PackPrizeCategory } from '@/lib/packs/config'

/** User-facing copy on the pack reveal screen (all prize types). */
export function packRevealMessage(input: {
  category: PackPrizeCategory | string
  prizeLabel: string
  isJackpotWin?: boolean
  /** True when vault payout is still in flight (Open unlocks before confirm). */
  payoutPending?: boolean
}): string {
  if (input.isJackpotWin || input.category === 'jackpot') {
    return `You won the ${input.prizeLabel}!`
  }
  if (input.category === 'owl') {
    return input.payoutPending
      ? `You won ${input.prizeLabel} — sending to your wallet`
      : `You won ${input.prizeLabel} — sent to your wallet`
  }
  return `You won ${input.prizeLabel}`
}
