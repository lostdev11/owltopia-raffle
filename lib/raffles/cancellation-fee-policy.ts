import type { Raffle } from '@/lib/types'

/**
 * After the raffle's scheduled `start_time`, a creator who requests cancellation must pay the
 * cancellation fee in SOL to treasury before the request is complete and admin can accept.
 */
export function raffleRequiresCancellationFee(raffle: Pick<Raffle, 'start_time'>, now: Date = new Date()): boolean {
  const startMs = new Date(raffle.start_time).getTime()
  if (Number.isNaN(startMs)) return false
  return now.getTime() >= startMs
}

export function canCompleteCancellationForAdmin(
  raffle: Pick<Raffle, 'start_time' | 'cancellation_fee_paid_at'>
): boolean {
  if (!raffleRequiresCancellationFee(raffle)) return true
  return !!raffle.cancellation_fee_paid_at
}

export function canCreatorClaimNftBackAfterCancel(
  raffle: Pick<Raffle, 'start_time' | 'status' | 'cancellation_fee_paid_at'>
): boolean {
  if (raffle.status !== 'cancelled') return false
  if (!raffleRequiresCancellationFee(raffle)) return true
  return !!raffle.cancellation_fee_paid_at
}
