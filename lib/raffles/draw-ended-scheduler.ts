/**
 * Fair scheduling for cron draw-ended-raffles when multiple VRF raffles are due.
 * Pure helpers — easy to unit test without hitting Supabase / Switchboard.
 */
import type { Raffle } from '@/lib/types'
import { raffleUsesDrawVrf } from '@/lib/raffles/draw/config'

/** Soft wall-clock budget inside the 120s serverless maxDuration. */
export const DRAW_ENDED_CRON_SOFT_BUDGET_MS = 110_000

/** Do not start a full VRF commit+reveal unless at least this much budget remains. */
export const DRAW_ENDED_MIN_MS_FOR_FULL_VRF = 90_000

/** Short resume / deferred-skip floor. */
export const DRAW_ENDED_MIN_MS_FOR_ANY_WORK = 5_000

/** Aligns with vercel.json draw-ended-raffles cron (every 15 minutes). */
export const DRAW_ENDED_CRON_INTERVAL_MS = 15 * 60_000

export const MAX_FULL_VRF_ATTEMPTS_PER_TICK = 1

export type EndedRaffleWorkKind = 'fast' | 'vrf_resume' | 'vrf_full'

export function raffleLikelyNeedsVrfDraw(raffle: {
  id: string
  draw_algo?: string | null
  draw_commit_hash?: string | null
}): boolean {
  return raffleUsesDrawVrf(raffle) && !(raffle.draw_commit_hash ?? '').trim()
}

export function classifyEndedRaffleWork(raffle: {
  id: string
  draw_algo?: string | null
  draw_commit_hash?: string | null
  draw_vrf_account?: string | null
  draw_vrf_status?: string | null
}): EndedRaffleWorkKind {
  if (!raffleLikelyNeedsVrfDraw(raffle)) return 'fast'
  const account = (raffle.draw_vrf_account ?? '').trim()
  const status = (raffle.draw_vrf_status ?? '').trim()
  if (account && (status === 'pending' || status === 'failed')) return 'vrf_resume'
  return 'vrf_full'
}

/** Stable 32-bit hash for rotation (not crypto). */
export function hashCronRotationKey(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function cronRotationRank(
  raffleId: string,
  nowMs: number,
  intervalMs: number = DRAW_ENDED_CRON_INTERVAL_MS
): number {
  const slot = Math.floor(nowMs / Math.max(1, intervalMs))
  return hashCronRotationKey(`${slot}:${raffleId}`)
}

export function endedRaffleDueSortKey(raffle: {
  end_time?: string | null
  draw_vrf_requested_at?: string | null
  status?: string | null
}): number {
  const vrfAt = Date.parse((raffle.draw_vrf_requested_at ?? '').trim())
  if (Number.isFinite(vrfAt)) return vrfAt
  const end = Date.parse((raffle.end_time ?? '').trim())
  if (Number.isFinite(end)) return end
  // ready_to_draw without timestamps — treat as oldest so it is not starved
  if ((raffle.status ?? '').trim() === 'ready_to_draw') return 0
  return Number.MAX_SAFE_INTEGER
}

/**
 * Fast (non-VRF) work first (stable by due age), then VRF candidates rotated
 * per cron slot so the same raffle is not always first.
 */
export function orderEndedRafflesForCron(
  raffles: Raffle[],
  nowMs: number = Date.now()
): Raffle[] {
  const fast: Raffle[] = []
  const vrf: Raffle[] = []
  for (const r of raffles) {
    if (raffleLikelyNeedsVrfDraw(r)) vrf.push(r)
    else fast.push(r)
  }

  fast.sort((a, b) => {
    const due = endedRaffleDueSortKey(a) - endedRaffleDueSortKey(b)
    if (due !== 0) return due
    return a.id.localeCompare(b.id)
  })

  vrf.sort((a, b) => {
    const rot = cronRotationRank(a.id, nowMs) - cronRotationRank(b.id, nowMs)
    if (rot !== 0) return rot
    const due = endedRaffleDueSortKey(a) - endedRaffleDueSortKey(b)
    if (due !== 0) return due
    return a.id.localeCompare(b.id)
  })

  return [...fast, ...vrf]
}

export function remainingDrawCronBudgetMs(params: {
  startedAtMs: number
  softBudgetMs?: number
  nowMs?: number
}): number {
  const budget = params.softBudgetMs ?? DRAW_ENDED_CRON_SOFT_BUDGET_MS
  const now = params.nowMs ?? Date.now()
  return budget - (now - params.startedAtMs)
}

export function shouldStartFullVrfAttempt(params: {
  fullVrfAttemptsSoFar: number
  remainingMs: number
  maxFullAttempts?: number
  minMsForFullVrf?: number
}): boolean {
  const maxAttempts = params.maxFullAttempts ?? MAX_FULL_VRF_ATTEMPTS_PER_TICK
  if (params.fullVrfAttemptsSoFar >= maxAttempts) return false
  const minMs = params.minMsForFullVrf ?? DRAW_ENDED_MIN_MS_FOR_FULL_VRF
  return params.remainingMs >= minMs
}

export function shouldStartVrfResumeAttempt(params: {
  remainingMs: number
  minMs?: number
}): boolean {
  return params.remainingMs >= (params.minMs ?? 15_000)
}

export function resolveRevealWaitMsForCronBudget(remainingMs: number): number {
  // Leave ~15s for performDraw + DB writes after reveal.
  return Math.max(10_000, Math.min(75_000, remainingMs - 15_000))
}
