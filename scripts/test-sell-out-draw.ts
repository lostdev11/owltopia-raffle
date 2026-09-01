import assert from 'node:assert/strict'
import { getSellOutDrawSkipReason } from '../lib/raffles/sell-out-draw'
import { canDrawOnSellOut } from '../lib/raffles/sell-out-eligibility'
import type { Entry } from '@/lib/types'

function check(label: string, ok: boolean) {
  if (!ok) {
    console.error('FAIL:', label)
    process.exitCode = 1
  } else {
    console.log('OK:', label)
  }
}

const base = {
  max_tickets: 10,
  status: 'live',
  winner_wallet: null,
  winner_selected_at: null,
  confirmedTickets: 10,
  canDraw: true,
  prizeRequiresEscrow: true,
  prizeDeposited: true,
}

check('eligible when sold out at max', getSellOutDrawSkipReason(base) === null)
check(
  'not sold out below max',
  getSellOutDrawSkipReason({ ...base, confirmedTickets: 9 }) === 'not_sold_out'
)
check(
  'no max skips',
  getSellOutDrawSkipReason({ ...base, max_tickets: null }) === 'no_max'
)
check(
  'already drawn skips',
  getSellOutDrawSkipReason({ ...base, winner_wallet: 'abc' }) === 'already_drawn'
)
check(
  'wrong status skips',
  getSellOutDrawSkipReason({ ...base, status: 'completed' }) === 'wrong_status'
)
check(
  'ready_to_draw eligible',
  getSellOutDrawSkipReason({ ...base, status: 'ready_to_draw' }) === null
)
check(
  'threshold not met skips when canDraw false',
  getSellOutDrawSkipReason({ ...base, canDraw: false }) === 'threshold_not_met'
)
check(
  'legacy sold out below min still draws when canDraw true',
  getSellOutDrawSkipReason({ ...base, canDraw: true, confirmedTickets: 10 }) === null
)
check(
  'prize not deposited skips when escrow required',
  getSellOutDrawSkipReason({ ...base, prizeDeposited: false }) === 'prize_not_deposited'
)
check(
  'legacy nft no escrow required when prize not deposited',
  getSellOutDrawSkipReason({ ...base, prizeRequiresEscrow: false, prizeDeposited: false }) === null
)

const legacyEntries = [
  {
    status: 'confirmed',
    ticket_quantity: 10,
    refunded_at: null,
  },
] as Entry[]

const legacyBelowMinRaffle = {
  max_tickets: 10,
  min_tickets: 50,
  prize_type: 'crypto',
} as import('@/lib/types').Raffle

check(
  'canDrawOnSellOut true when sold out below stored min (legacy cap)',
  canDrawOnSellOut(legacyBelowMinRaffle, legacyEntries)
)
check(
  'canDrawOnSellOut false when no confirmed tickets',
  !canDrawOnSellOut({ max_tickets: 10, prize_type: 'crypto' } as import('@/lib/types').Raffle, [])
)

assert.equal(process.exitCode ?? 0, 0, 'one or more checks failed')
console.log('All sell-out draw precondition tests passed.')
