import type { PackPrizeCategory } from '@/lib/packs/config'

/** User-facing copy on the pack reveal screen (all prize types). */
export function packRevealMessage(input: {
  category: PackPrizeCategory | string
  prizeLabel: string
  isJackpotWin?: boolean
}): string {
  if (input.isJackpotWin || input.category === 'jackpot') {
    return `You won the ${input.prizeLabel}!`
  }
  if (input.category === 'owl') {
    return `You won ${input.prizeLabel} — sent to your wallet`
  }
  return `You won ${input.prizeLabel}`
}
