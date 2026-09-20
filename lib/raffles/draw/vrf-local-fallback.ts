/**
 * When Switchboard VRF cannot fulfill, decide whether to settle with a local seed.
 * Used by selectWinner / force-draw so raffles are not stuck forever on gateway 503s.
 */
import {
  isRetryableVrfRevealError,
  isSwitchboardGatewayTransientError,
  isSwitchboardOracleFleetUnavailableError,
  isVrfRevealTimeoutError,
  vrfRequestAgeMs,
  VRF_STALE_REQUEST_MS,
} from '@/lib/raffles/draw/vrf-retry-policy'

export function isSwitchboardRevealPathDead(error: string | null | undefined): boolean {
  const msg = (error ?? '').trim()
  if (!msg) return false
  return (
    isSwitchboardOracleFleetUnavailableError(msg) ||
    isSwitchboardGatewayTransientError(msg) ||
    isVrfRevealTimeoutError(msg) ||
    /Gateway\.fetchRandomnessReveal failed/i.test(msg) ||
    /oracle gateway flaky/i.test(msg)
  )
}

/**
 * Prefer skipping another long Switchboard attempt when the raffle already
 * failed on a dead gateway / oracle fleet (admin Force draw should finish).
 */
export function shouldPreferLocalSeedOverVrfAttempt(raffle: {
  draw_vrf_status?: string | null
  draw_vrf_error?: string | null
  draw_vrf_account?: string | null
  draw_vrf_requested_at?: string | null
}): boolean {
  const status = (raffle.draw_vrf_status ?? '').trim()
  if (status !== 'failed' && status !== 'pending') return false
  const err = (raffle.draw_vrf_error ?? '').trim()
  if (!isSwitchboardRevealPathDead(err)) return false
  // Account may exist (commit succeeded) while reveal gateways are 503 — still prefer local seed.
  const age = vrfRequestAgeMs(raffle.draw_vrf_requested_at)
  // Immediate prefer when failed with dead path; pending only after short stale window.
  if (status === 'failed') return true
  return age != null && age >= Math.min(60_000, VRF_STALE_REQUEST_MS)
}

export function shouldFallbackVrfToLocalSeed(params: {
  error: string | null | undefined
  randomnessAccount?: string | null
  allowLocalSeedFallback?: boolean
  preferLocalSeedFallback?: boolean
}): boolean {
  const err = (params.error ?? '').trim()
  if (!err && !params.preferLocalSeedFallback) return false

  // Commit never created an account — oracle fleet unavailable.
  if (
    isSwitchboardOracleFleetUnavailableError(err) &&
    !(params.randomnessAccount ?? '').trim()
  ) {
    return true
  }

  if (params.preferLocalSeedFallback && isSwitchboardRevealPathDead(err || params.error)) {
    return true
  }

  // Explicit admin / recovery path: any retryable VRF failure after an attempt.
  if (params.allowLocalSeedFallback && isRetryableVrfRevealError(err)) {
    return true
  }

  return false
}
