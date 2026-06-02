import type {
  RaffleMilestone,
  RaffleMilestoneWinnerMode,
  RaffleMilestoneWinnerSelectionMode,
} from '@/lib/types'
import { MILESTONE_MAX_PRIZE_SOL, milestoneMaxPrizeUsdc } from '@/lib/raffles/milestones/constants'

/** Shown on create form, raffle detail, and How it works while milestones are in beta. */
export const MILESTONE_BETA_NOTICE =
  'Bonus milestones are in beta: SOL or USDC side prizes only (no NFT bonuses yet). Rules and UI may change.'

export function milestoneWinnerModeLabel(mode: RaffleMilestoneWinnerMode): string {
  switch (mode) {
    case 'random':
      return 'Random (ticket-weighted)'
    case 'top_buyer':
      return 'Top buyer'
    case 'creator_initiated_pull':
      return 'Creator starts random draw'
    default:
      return mode
  }
}

export function milestoneSelectionModeLabel(
  mode: RaffleMilestoneWinnerSelectionMode | null | undefined
): string {
  switch (mode) {
    case 'creator_triggered_random':
      return 'Creator-triggered random draw'
    case 'auto_random':
      return 'Automatic random draw'
    case 'auto_top_buyer':
      return 'Automatic top buyer'
    default:
      return 'Pending'
  }
}

export function formatMilestonePrize(m: Pick<RaffleMilestone, 'prize_type' | 'prize_amount' | 'prize_currency'>): string {
  if (m.prize_type === 'crypto') {
    const amt = Number(m.prize_amount ?? 0)
    const cur = m.prize_currency ?? 'SOL'
    return `${amt} ${cur}`
  }
  return 'NFT bonus'
}

export function formatMilestoneTrigger(
  m: Pick<RaffleMilestone, 'trigger_type' | 'trigger_value'>,
  maxTickets: number | null | undefined,
  drawThresholdTickets?: number | null
): string {
  if (m.trigger_type === 'draw_threshold') {
    const n = drawThresholdTickets != null && drawThresholdTickets > 0 ? drawThresholdTickets : null
    return n != null ? `draw goal reached (${n} tickets)` : 'draw goal reached'
  }
  if (m.trigger_type === 'percent_max') {
    const pct = Math.round(Number(m.trigger_value))
    if (maxTickets != null && maxTickets > 0) {
      const target = Math.ceil((maxTickets * pct) / 100)
      return `${pct}% sold (${target} tickets)`
    }
    return `${pct}% of max tickets`
  }
  return `${Math.floor(Number(m.trigger_value))} tickets sold`
}

/** Fixed bonus rules copy shown on raffle detail and create form. */
export function buildMilestoneBonusRulesCopy(): readonly string[] {
  return [
    MILESTONE_BETA_NOTICE,
    'Bonus prizes are separate from the main raffle prize and are prefunded in escrow before the raffle goes live.',
    'A milestone unlocks when ticket sales cross its target. It only pays out if the raffle succeeds (draw threshold met and a main winner is drawn).',
    'If the raffle fails to meet its draw goal, bonus deposits return to the creator; buyers are not charged for bonuses.',
    'Milestone winners are always chosen by the platform — creators can start an early random draw but never pick a wallet.',
    'The main prize winner cannot also win the same milestone. Each milestone winner must be a unique wallet.',
    `Crypto bonuses are capped at ${MILESTONE_MAX_PRIZE_SOL} SOL (or ${milestoneMaxPrizeUsdc()} USDC equivalent) per milestone.`,
  ] as const
}

export function buildSingleMilestoneRuleLine(
  m: Pick<
    RaffleMilestone,
    'trigger_type' | 'trigger_value' | 'prize_type' | 'prize_amount' | 'prize_currency' | 'winner_mode'
  >,
  maxTickets: number | null | undefined,
  drawThresholdTickets?: number | null
): string {
  const prize = formatMilestonePrize(m)
  const trigger = formatMilestoneTrigger(m, maxTickets, drawThresholdTickets)
  const mode = milestoneWinnerModeLabel(m.winner_mode)
  return `When ${trigger}, ${prize} bonus — ${mode}.`
}
