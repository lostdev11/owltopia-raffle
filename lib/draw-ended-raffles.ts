/**
 * Process all ended raffles without winners: draw winner when eligible, or extend the deadline when min_tickets not met.
 * Used by admin select-winners API and by cron job so winner selection runs on a schedule.
 *
 * Works for any raffle duration (1 day, 2 days, 3 days, etc.): each raffle has its own start_time/end_time.
 * When end_time has passed and the ticket threshold (min_tickets) is met, a winner is selected; otherwise
 * the raffle may be extended once, then set to failed_refund_available (NFT returned when possible).
 *
 * Cron fairness: fast (non-VRF) work always runs first; at most one full VRF commit+reveal per tick,
 * with rotation so two stuck VRF raffles cannot starve each other across 15-minute cron slots.
 */
import {
  getEndedRafflesWithoutWinner,
  getEntriesByRaffleId,
  getRaffleById,
  selectWinner,
  updateRaffle,
  getRaffleMinimum,
} from '@/lib/db/raffles'
import { hasExhaustedMinThresholdTimeExtensions, raffleSecondRoundEnabled } from '@/lib/raffles/ticket-escrow-policy'
import { buildMinThresholdMissExtensionPatch } from '@/lib/raffles/min-threshold-extension'
import { finalizeMinThresholdTerminalFailure } from '@/lib/raffles/min-threshold-terminal'
import { raffleIsDueForWinnerDraw } from '@/lib/raffles/purchase-window'
import { isRaffleEligibleForWinnerSelection } from '@/lib/raffles/sell-out-eligibility'
import { raffleRequiresPrizeEscrowForDraw } from '@/lib/raffles/visibility'
import {
  DRAW_ENDED_CRON_SOFT_BUDGET_MS,
  DRAW_ENDED_MIN_MS_FOR_ANY_WORK,
  classifyEndedRaffleWork,
  orderEndedRafflesForCron,
  remainingDrawCronBudgetMs,
  resolveRevealWaitMsForCronBudget,
  shouldStartFullVrfAttempt,
  shouldStartVrfResumeAttempt,
} from '@/lib/raffles/draw-ended-scheduler'
import { shouldPreferLocalSeedOverVrfAttempt } from '@/lib/raffles/draw/vrf-local-fallback'
import type { Raffle } from '@/lib/types'

export type DrawResult = {
  raffleId: string
  raffleTitle: string
  success: boolean
  winnerWallet: string | null
  error: string | null
  extended?: boolean
  deferred?: boolean
  drawVrfStatus?: string | null
}

export type ProcessEndedRafflesOptions = {
  softBudgetMs?: number
  nowMs?: number
}

/**
 * Same rules as {@link getEndedRafflesWithoutWinner}: ended, no winner, live/ready_to_draw (or legacy
 * `pending_min_not_met`), NFT deposited when NFT prize.
 * Used so opening the dashboard can advance min-threshold / refunds without relying on cron or a raffle page view.
 */
export async function processEndedRaffleByIdIfApplicable(raffleId: string): Promise<DrawResult | null> {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) return null
  if (raffle.winner_wallet || raffle.winner_selected_at) return null
  if (
    raffle.status !== 'live' &&
    raffle.status !== 'ready_to_draw' &&
    raffle.status !== 'pending_min_not_met'
  ) {
    return null
  }
  // ready_to_draw is due even if end_time was pushed into the future after a failed draw.
  if (!raffleIsDueForWinnerDraw(raffle)) return null
  const needsPrizeEscrow = raffleRequiresPrizeEscrowForDraw(raffle) && !raffle.prize_deposited_at
  if (needsPrizeEscrow) return null
  return processOneEndedRaffle(raffle)
}

export async function processOneEndedRaffle(
  raffle: Raffle,
  opts?: { revealWaitMs?: number }
): Promise<DrawResult> {
  try {
    const entries = await getEntriesByRaffleId(raffle.id)
    const canDraw = isRaffleEligibleForWinnerSelection(raffle, entries)

    // If {@link canSelectWinner} is false (min not hit, or no sales when there's no drawable min),
    // extend once then terminal refund state — do not force `ready_to_draw` while still undrawable.
    if (!canDraw) {
      if (hasExhaustedMinThresholdTimeExtensions(raffle)) {
        await finalizeMinThresholdTerminalFailure(raffle.id)
        const refundReason = raffleSecondRoundEnabled(raffle)
          ? 'Minimum was not met after the deadline extension. Ticket buyers can claim refunds; the escrowed prize is returned to the creator when the on-chain transfer succeeds.'
          : 'Minimum was not met when Round 1 ended (second round disabled). Ticket buyers can claim refunds; the escrowed prize is returned to the creator when the on-chain transfer succeeds.'
        return {
          raffleId: raffle.id,
          raffleTitle: raffle.title,
          success: false,
          winnerWallet: null,
          error: refundReason,
        }
      }
      // Threshold not met (or zero sales): second selling round — extend once by the original raffle duration.
      const patch = buildMinThresholdMissExtensionPatch(raffle)
      const durationMs =
        new Date(patch.end_time).getTime() - new Date(raffle.end_time).getTime()

      await updateRaffle(raffle.id, patch)

      return {
        raffleId: raffle.id,
        raffleTitle: raffle.title,
        success: false,
        winnerWallet: null,
        error: `Minimum ticket threshold not met (min: ${
          getRaffleMinimum(raffle) ?? raffle.min_tickets ?? 'N/A'
        }, sold: ${entries
          .filter((e) => e.status === 'confirmed' && !e.refunded_at)
          .reduce((sum, entry) => sum + Number(entry.ticket_quantity ?? 0), 0)}). Extended by ${
          durationMs / (24 * 60 * 60 * 1000)
        } days.`,
        extended: true,
      }
    }

    const winnerWallet = await selectWinner(raffle.id, false, {
      revealWaitMs: opts?.revealWaitMs,
      // Cron: if Switchboard gateways already failed this raffle, settle with local seed
      // instead of burning another 75s reveal poll every 15 minutes.
      allowLocalSeedFallback: shouldPreferLocalSeedOverVrfAttempt(raffle),
      preferLocalSeedFallback: shouldPreferLocalSeedOverVrfAttempt(raffle),
    })
    if (winnerWallet) {
      return {
        raffleId: raffle.id,
        raffleTitle: raffle.title,
        success: true,
        winnerWallet,
        error: null,
      }
    }
    const latest = await getRaffleById(raffle.id)
    const vrfErr = (latest?.draw_vrf_error ?? '').trim()
    const vrfStatus = (latest?.draw_vrf_status ?? '').trim()
    return {
      raffleId: raffle.id,
      raffleTitle: raffle.title,
      success: false,
      winnerWallet: null,
      drawVrfStatus: vrfStatus || null,
      error:
        vrfStatus === 'failed' || vrfStatus === 'pending'
          ? vrfErr || `VRF draw ${vrfStatus} — will auto-retry on cron; admin can also retry`
          : 'No confirmed entries found or draw did not complete',
    }
  } catch (error) {
    return {
      raffleId: raffle.id,
      raffleTitle: raffle.title,
      success: false,
      winnerWallet: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

function deferredDrawResult(raffle: Raffle, reason: string): DrawResult {
  return {
    raffleId: raffle.id,
    raffleTitle: raffle.title,
    success: false,
    winnerWallet: null,
    deferred: true,
    error: reason,
    drawVrfStatus: (raffle.draw_vrf_status ?? '').trim() || null,
  }
}

export async function processEndedRafflesWithoutWinners(
  opts?: ProcessEndedRafflesOptions
): Promise<DrawResult[]> {
  const startedAtMs = opts?.nowMs ?? Date.now()
  const softBudgetMs = opts?.softBudgetMs ?? DRAW_ENDED_CRON_SOFT_BUDGET_MS
  const endedRaffles = await getEndedRafflesWithoutWinner()

  if (endedRaffles.length === 0) {
    return []
  }

  const ordered = orderEndedRafflesForCron(endedRaffles, startedAtMs)
  const results: DrawResult[] = []
  let fullVrfAttempts = 0

  for (const raffle of ordered) {
    const remainingMs = remainingDrawCronBudgetMs({
      startedAtMs,
      softBudgetMs,
    })

    if (remainingMs < DRAW_ENDED_MIN_MS_FOR_ANY_WORK) {
      results.push(
        deferredDrawResult(
          raffle,
          `Deferred: cron soft budget exhausted (${remainingMs}ms left)`
        )
      )
      continue
    }

    const kind = classifyEndedRaffleWork(raffle)
    // Prior Switchboard gateway failures settle via local seed — treat as fast.
    const settlesLocal =
      kind !== 'fast' && shouldPreferLocalSeedOverVrfAttempt(raffle)

    if (kind === 'fast' || settlesLocal) {
      results.push(
        await processOneEndedRaffle(raffle, {
          revealWaitMs: settlesLocal ? 10_000 : undefined,
        })
      )
      continue
    }

    if (kind === 'vrf_full') {
      if (
        !shouldStartFullVrfAttempt({
          fullVrfAttemptsSoFar: fullVrfAttempts,
          remainingMs,
        })
      ) {
        results.push(
          deferredDrawResult(
            raffle,
            fullVrfAttempts >= 1
              ? 'Deferred: VRF slot used this cron tick — will retry next tick'
              : `Deferred: not enough cron budget for full VRF (${remainingMs}ms left)`
          )
        )
        continue
      }
      const revealWaitMs = resolveRevealWaitMsForCronBudget(remainingMs)
      results.push(await processOneEndedRaffle(raffle, { revealWaitMs }))
      fullVrfAttempts += 1
      continue
    }

    // vrf_resume: short budget OK; still counts as the full-VRF slot once we burn a long poll
    if (!shouldStartVrfResumeAttempt({ remainingMs }) && fullVrfAttempts >= 1) {
      results.push(
        deferredDrawResult(
          raffle,
          'Deferred: VRF slot used this cron tick — pending reveal will retry next tick'
        )
      )
      continue
    }

    if (
      fullVrfAttempts >= 1 &&
      !shouldStartVrfResumeAttempt({ remainingMs })
    ) {
      results.push(
        deferredDrawResult(
          raffle,
          `Deferred: not enough cron budget for VRF resume (${remainingMs}ms left)`
        )
      )
      continue
    }

    const revealWaitMs =
      fullVrfAttempts >= 1
        ? Math.min(15_000, resolveRevealWaitMsForCronBudget(remainingMs))
        : resolveRevealWaitMsForCronBudget(remainingMs)

    results.push(await processOneEndedRaffle(raffle, { revealWaitMs }))
    // First resume in a tick that may burn the long poll counts as the VRF slot.
    if (fullVrfAttempts === 0) fullVrfAttempts += 1
  }

  return results
}
