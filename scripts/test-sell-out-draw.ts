import assert from 'node:assert/strict'
import { getSellOutDrawSkipReason } from '../lib/raffles/sell-out-draw'

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
  'threshold not met skips',
  getSellOutDrawSkipReason({ ...base, canDraw: false }) === 'threshold_not_met'
)
check(
  'prize not deposited skips',
  getSellOutDrawSkipReason({ ...base, prizeDeposited: false }) === 'prize_not_deposited'
)
check(
  'crypto prize no escrow required',
  getSellOutDrawSkipReason({ ...base, prizeRequiresEscrow: false, prizeDeposited: false }) === null
)

assert.equal(process.exitCode ?? 0, 0, 'one or more checks failed')
console.log('All sell-out draw precondition tests passed.')
