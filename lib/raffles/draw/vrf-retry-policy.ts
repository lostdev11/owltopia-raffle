/**
 * Pure helpers for Switchboard VRF reveal resilience.
 *
 * Transient gateway 503 / ERR_BAD_RESPONSE is the common failure mode: commit
 * lands on-chain, then revealIx cannot fetch the signed value from the oracle
 * gateway within the serverless budget. Admins should not have to babysit —
 * resume first, then auto-recommit against the frozen ledger when stale.
 */

/** Default reveal poll budget (ms). Overridable via DRAW_VRF_REVEAL_WAIT_MS. */
export const DEFAULT_VRF_REVEAL_WAIT_MS = 75_000

/**
 * After a failed/pending VRF request this old, prefer a fresh Switchboard commit
 * (same frozen ticket ledger) instead of only resuming the stale account.
 */
export const VRF_STALE_REQUEST_MS = 3 * 60_000

/** Quick on-chain read before admin/cron abandons a prior randomness account. */
export const ADMIN_VRF_RECOVERY_WAIT_MS = 10_000

export function resolveVrfRevealWaitMs(overrideMs?: number): number {
  if (typeof overrideMs === 'number' && Number.isFinite(overrideMs) && overrideMs > 0) {
    return Math.floor(overrideMs)
  }
  const raw = (process.env.DRAW_VRF_REVEAL_WAIT_MS || '').trim()
  if (raw) {
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 10_000) return Math.floor(n)
  }
  return DEFAULT_VRF_REVEAL_WAIT_MS
}

/** True when the error looks like a Switchboard oracle gateway outage / bad response. */
export function isSwitchboardGatewayTransientError(error: string | null | undefined): boolean {
  const msg = (error ?? '').trim()
  if (!msg) return false
  return (
    /fetchRandomnessReveal/i.test(msg) ||
    /Gateway:\s*fetchRandomnessReveal/i.test(msg) ||
    /GatewayRequestError/i.test(msg) ||
    /\bstatus 503\b/i.test(msg) ||
    /\bERR_BAD_RESPONSE\b/i.test(msg) ||
    /\bstatus 502\b/i.test(msg) ||
    /\bstatus 504\b/i.test(msg) ||
    /\bECONNRESET\b/i.test(msg) ||
    /\bETIMEDOUT\b/i.test(msg) ||
    /\bENOTFOUND\b/i.test(msg)
  )
}

export function isVrfRevealTimeoutError(error: string | null | undefined): boolean {
  return /VRF reveal timed out/i.test((error ?? '').trim())
}

/** Transient reveal failures that are safe to auto-retry / re-commit. */
export function isRetryableVrfRevealError(error: string | null | undefined): boolean {
  const msg = (error ?? '').trim()
  if (!msg) return false
  return (
    isVrfRevealTimeoutError(msg) ||
    isSwitchboardGatewayTransientError(msg) ||
    /Randomness not ready/i.test(msg) ||
    /Reveal attempt failed/i.test(msg) ||
    /oracle did not produce/i.test(msg)
  )
}

/**
 * Backoff between revealIx attempts. Gateway 503s benefit from longer pauses
 * (SDK already sleeps ~3s inside revealIx before each gateway call).
 */
export function vrfRevealRetryDelayMs(params: {
  attemptIndex: number
  lastError: string
  baseDelayMs?: number
}): number {
  const base = Math.max(500, params.baseDelayMs ?? 2500)
  const gateway = isSwitchboardGatewayTransientError(params.lastError)
  const step = Math.max(0, params.attemptIndex)
  if (gateway) {
    // 4s, 6s, 8s, 10s… capped
    return Math.min(10_000, 4000 + step * 2000)
  }
  return Math.min(8_000, base + step * 500)
}

export function vrfRequestAgeMs(
  requestedAt: string | null | undefined,
  nowMs: number = Date.now()
): number | null {
  const raw = (requestedAt ?? '').trim()
  if (!raw) return null
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return null
  return Math.max(0, nowMs - t)
}

/**
 * Whether the next VRF attempt should abandon the existing randomness account
 * and commit a new one (ledger freeze stays if already on-chain).
 */
export function shouldAutoForceNewVrfRequest(params: {
  drawVrfStatus?: string | null
  drawVrfAccount?: string | null
  drawVrfError?: string | null
  drawVrfRequestedAt?: string | null
  nowMs?: number
  staleAfterMs?: number
}): boolean {
  const status = (params.drawVrfStatus ?? '').trim()
  if (status !== 'failed' && status !== 'pending') return false
  const account = (params.drawVrfAccount ?? '').trim()
  if (!account) return false

  const err = (params.drawVrfError ?? '').trim()
  const age = vrfRequestAgeMs(params.drawVrfRequestedAt, params.nowMs)
  const staleAfter = params.staleAfterMs ?? VRF_STALE_REQUEST_MS

  // Missing secret / hard failures: always re-request.
  if (/Missing VRF account secret/i.test(err)) return true

  // No error yet and still fresh → resume (another worker may finish reveal).
  if (!err && (age == null || age < staleAfter)) return false

  // Gateway / timeout after the stale window → fresh commit.
  if (isRetryableVrfRevealError(err) && age != null && age >= staleAfter) return true

  // Very old pending with unknown error — do not leave raffles stuck forever.
  if (age != null && age >= staleAfter * 2) return true

  return false
}

/**
 * Whether an admin retry should skip resume and request fresh Switchboard randomness.
 * Always returns false for fresh pending requests so we finish an in-flight reveal first.
 */
export function resolveAdminVrfForceNewRequest(raffle: {
  draw_vrf_account?: string | null
  draw_vrf_status?: string | null
  draw_vrf_error?: string | null
  draw_vrf_requested_at?: string | null
}): boolean {
  const hasAccount = Boolean((raffle.draw_vrf_account ?? '').trim())
  if (!hasAccount) return true

  const status = (raffle.draw_vrf_status ?? '').trim()
  const err = (raffle.draw_vrf_error ?? '').trim()

  if (status === 'failed') {
    if (!err || isRetryableVrfRevealError(err)) return true
    if (/Missing VRF account secret/i.test(err)) return true
    return false
  }

  if (status === 'pending') return false

  return shouldAutoForceNewVrfRequest({
    drawVrfStatus: raffle.draw_vrf_status,
    drawVrfAccount: raffle.draw_vrf_account,
    drawVrfError: raffle.draw_vrf_error,
    drawVrfRequestedAt: raffle.draw_vrf_requested_at,
  })
}
