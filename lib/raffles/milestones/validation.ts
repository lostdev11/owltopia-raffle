import type { Raffle, RaffleMilestoneCreateInput } from '@/lib/types'
import { getEffectiveDrawThresholdTickets } from '@/lib/raffles/nft-raffle-economics'
import {
  MILESTONE_MAX_PER_RAFFLE,
  MILESTONE_MAX_PRIZE_SOL,
  milestoneMaxPrizeUsdc,
} from '@/lib/raffles/milestones/constants'

export type RaffleForMilestoneTarget = Pick<
  Raffle,
  'max_tickets' | 'min_tickets' | 'prize_type' | 'floor_price' | 'ticket_price'
>

export type MilestoneValidationResult = { ok: true } | { ok: false; error: string }

function parseMilestonesInput(raw: unknown): RaffleMilestoneCreateInput[] {
  if (!Array.isArray(raw)) return []
  const out: RaffleMilestoneCreateInput[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const trigger_type = o.trigger_type
    const winner_mode = o.winner_mode
    const prize_type = o.prize_type
    if (
      trigger_type !== 'percent_max' &&
      trigger_type !== 'absolute_tickets' &&
      trigger_type !== 'draw_threshold'
    ) {
      continue
    }
    if (
      winner_mode !== 'random' &&
      winner_mode !== 'top_buyer' &&
      winner_mode !== 'creator_initiated_pull'
    ) {
      continue
    }
    if (prize_type !== 'crypto' && prize_type !== 'nft') continue
    const trigger_value =
      typeof o.trigger_value === 'number'
        ? o.trigger_value
        : parseFloat(String(o.trigger_value ?? ''))
    if (!Number.isFinite(trigger_value) || trigger_value <= 0) continue
    if (trigger_type === 'percent_max' && trigger_value > 100) continue

    const item: RaffleMilestoneCreateInput = {
      trigger_type,
      trigger_value: trigger_type === 'draw_threshold' ? 1 : trigger_value,
      prize_type,
      winner_mode,
    }
    if (prize_type === 'crypto') {
      const prize_amount =
        typeof o.prize_amount === 'number'
          ? o.prize_amount
          : parseFloat(String(o.prize_amount ?? ''))
      const prize_currency =
        typeof o.prize_currency === 'string' ? o.prize_currency.trim().toUpperCase() : ''
      if (!Number.isFinite(prize_amount) || prize_amount <= 0) continue
      if (prize_currency !== 'SOL' && prize_currency !== 'USDC') continue
      if (prize_currency === 'SOL' && prize_amount > MILESTONE_MAX_PRIZE_SOL) continue
      if (prize_currency === 'USDC' && prize_amount > milestoneMaxPrizeUsdc()) continue
      item.prize_amount = prize_amount
      item.prize_currency = prize_currency
    } else {
      const mint =
        typeof o.nft_mint_address === 'string' && o.nft_mint_address.trim()
          ? o.nft_mint_address.trim()
          : null
      const tokenId =
        typeof o.nft_token_id === 'string' && o.nft_token_id.trim()
          ? o.nft_token_id.trim()
          : null
      if (!mint && !tokenId) continue
      item.nft_mint_address = mint
      item.nft_token_id = tokenId
    }
    out.push(item)
  }
  return out
}

export function validateMilestonesForRaffle(
  raffle: Pick<Raffle, 'max_tickets' | 'min_tickets'>,
  raw: unknown
): { ok: true; milestones: RaffleMilestoneCreateInput[] } | { ok: false; error: string } {
  const milestones = parseMilestonesInput(raw)
  if (milestones.length === 0) {
    return { ok: true, milestones: [] }
  }
  if (milestones.length > MILESTONE_MAX_PER_RAFFLE) {
    return { ok: false, error: `At most ${MILESTONE_MAX_PER_RAFFLE} milestones per raffle.` }
  }

  const maxTickets = raffle.max_tickets != null ? Number(raffle.max_tickets) : null
  const minTickets = raffle.min_tickets != null ? Number(raffle.min_tickets) : null
  const drawThreshold = getEffectiveDrawThresholdTickets(raffle as Raffle)

  const triggerKeys = new Set<string>()
  for (const m of milestones) {
    if (m.prize_type === 'nft') {
      return { ok: false, error: 'NFT milestone prizes are not enabled yet. Use SOL or USDC for now.' }
    }
    if (m.trigger_type === 'draw_threshold') {
      if (drawThreshold == null || drawThreshold <= 0) {
        return {
          ok: false,
          error: 'Set a valid draw goal (floor ÷ ticket or min tickets) before using “at draw goal” milestones.',
        }
      }
      const key = 'draw_threshold'
      if (triggerKeys.has(key)) {
        return { ok: false, error: 'Only one “at draw goal” milestone is allowed.' }
      }
      triggerKeys.add(key)
      continue
    }
    if (m.trigger_type === 'percent_max') {
      if (maxTickets == null || maxTickets <= 0) {
        return {
          ok: false,
          error: 'Percent milestones require max tickets to be set on the raffle.',
        }
      }
      const target = Math.ceil((maxTickets * m.trigger_value) / 100)
      if (minTickets != null && minTickets > 0 && target < minTickets) {
        return {
          ok: false,
          error: `Milestone at ${m.trigger_value}% (${target} tickets) is below the draw threshold (${minTickets}).`,
        }
      }
    } else {
      if (minTickets != null && minTickets > 0 && m.trigger_value < minTickets) {
        return {
          ok: false,
          error: `Milestone at ${m.trigger_value} tickets is below the draw threshold (${minTickets}).`,
        }
      }
      if (maxTickets != null && maxTickets > 0 && m.trigger_value > maxTickets) {
        return {
          ok: false,
          error: `Milestone ticket target (${m.trigger_value}) exceeds max tickets (${maxTickets}).`,
        }
      }
    }
    const key = `${m.trigger_type}:${m.trigger_value}`
    if (triggerKeys.has(key)) {
      return { ok: false, error: 'Duplicate milestone triggers are not allowed.' }
    }
    triggerKeys.add(key)
  }

  const sorted = [...milestones].sort((a, b) => {
    const ta = triggerToComparable(raffle, a)
    const tb = triggerToComparable(raffle, b)
    return ta - tb
  })

  return { ok: true, milestones: sorted }
}

export function triggerToComparable(
  raffle: RaffleForMilestoneTarget,
  m: Pick<RaffleMilestoneCreateInput, 'trigger_type' | 'trigger_value'>
): number {
  if (m.trigger_type === 'draw_threshold') {
    return milestoneTriggerTicketTarget(raffle, m)
  }
  if (m.trigger_type === 'absolute_tickets') return m.trigger_value
  const max = raffle.max_tickets != null ? Number(raffle.max_tickets) : 0
  if (max <= 0) return m.trigger_value
  return Math.ceil((max * m.trigger_value) / 100)
}

export function milestoneTriggerTicketTarget(
  raffle: RaffleForMilestoneTarget,
  m: Pick<RaffleMilestoneCreateInput, 'trigger_type' | 'trigger_value'>
): number {
  if (m.trigger_type === 'draw_threshold') {
    const t = getEffectiveDrawThresholdTickets(raffle as Raffle)
    return t != null && t > 0 ? t : 1
  }
  if (m.trigger_type === 'absolute_tickets') return Math.floor(m.trigger_value)
  const max = raffle.max_tickets != null ? Number(raffle.max_tickets) : 0
  if (max <= 0) return Math.ceil(m.trigger_value)
  return Math.ceil((max * m.trigger_value) / 100)
}
