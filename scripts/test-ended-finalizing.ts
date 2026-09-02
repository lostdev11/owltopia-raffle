/**
 * Run: npx tsx scripts/test-ended-finalizing.ts
 */
import assert from 'node:assert/strict'
import { classifyEndedNoWinnerRaffle } from '@/lib/raffles/ended-finalizing'
import type { Entry, Raffle } from '@/lib/types'

const now = Date.parse('2026-09-02T12:00:00.000Z')

const baseRaffle = {
  id: 'r1',
  slug: 'owl-175',
  title: 'OWL #175',
  winner_wallet: null,
  winner_selected_at: null,
  status: 'live' as const,
  end_time: '2026-09-02T06:23:00.000Z',
  prize_type: 'nft' as const,
  prize_deposited_at: '2026-08-24T06:24:56.000Z',
  prize_currency: null,
  max_tickets: 100,
  min_tickets: 50,
  floor_price: '0.6',
  ticket_price: 0.012,
} satisfies Partial<Raffle> as Pick<
  Raffle,
  | 'id'
  | 'winner_wallet'
  | 'winner_selected_at'
  | 'status'
  | 'end_time'
  | 'prize_type'
  | 'prize_deposited_at'
  | 'prize_currency'
  | 'max_tickets'
  | 'min_tickets'
  | 'floor_price'
  | 'ticket_price'
>

function entry(tickets: number): Entry {
  return {
    id: `e-${tickets}`,
    raffle_id: 'r1',
    wallet_address: 'Wallet111111111111111111111111111111111',
    ticket_quantity: tickets,
    amount_paid: tickets * 0.012,
    currency: 'SOL',
    status: 'confirmed',
    transaction_signature: null,
    created_at: '2026-08-25T00:00:00.000Z',
    refunded_at: null,
  } as Entry
}

assert.equal(
  classifyEndedNoWinnerRaffle(baseRaffle, [entry(68)], now),
  'awaiting_draw',
  'OWL#175-style: min met → draw'
)

assert.equal(
  classifyEndedNoWinnerRaffle(baseRaffle, [entry(10)], now),
  'awaiting_extension_or_refund',
  'below min → extension/refund'
)

assert.equal(
  classifyEndedNoWinnerRaffle(
    { ...baseRaffle, winner_wallet: 'Winner1111111111111111111111111111111' },
    [entry(68)],
    now
  ),
  null,
  'already has winner'
)

assert.equal(
  classifyEndedNoWinnerRaffle(
    { ...baseRaffle, end_time: '2026-09-03T06:23:00.000Z' },
    [entry(68)],
    now
  ),
  null,
  'not ended yet'
)

assert.equal(
  classifyEndedNoWinnerRaffle(
    { ...baseRaffle, prize_deposited_at: null },
    [entry(68)],
    now
  ),
  null,
  'nft without deposit'
)

assert.equal(
  classifyEndedNoWinnerRaffle(
    { ...baseRaffle, status: 'ready_to_draw', max_tickets: 20, min_tickets: 50 },
    [entry(20)],
    now
  ),
  'awaiting_draw',
  'sold out at max below stored min still draws'
)

console.log('test-ended-finalizing: ok')
