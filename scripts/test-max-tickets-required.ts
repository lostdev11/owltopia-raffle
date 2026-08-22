import assert from 'node:assert/strict'
import {
  isRaffleSoldOutAtMax,
  parseMaxTicketsUpdateInput,
  parseRequiredMaxTickets,
  MAX_TICKETS_CANNOT_CLEAR_MESSAGE,
  MAX_TICKETS_REQUIRED_MESSAGE,
} from '../lib/raffles/max-tickets'
import { validateNftMaxTickets } from '../lib/raffles/nft-raffle-economics'
import { raffleSoldOutButtonLabel, raffleSoldOutDetailMessage } from '../lib/raffles/sold-out-copy'

function check(label: string, ok: boolean) {
  if (!ok) {
    console.error('FAIL:', label)
    process.exitCode = 1
  } else {
    console.log('OK:', label)
  }
}

const missing = parseRequiredMaxTickets('')
check('missing max rejected', !missing.ok && missing.error === MAX_TICKETS_REQUIRED_MESSAGE)

const valid = parseRequiredMaxTickets('200')
check('valid max parsed', valid.ok && valid.value === 200)

const clear = parseMaxTicketsUpdateInput(null)
check('clear max rejected', !clear.ok && clear.error === MAX_TICKETS_CANNOT_CLEAR_MESSAGE)

const belowGoal = validateNftMaxTickets(10, 50)
check(
  'below draw goal rejected',
  !belowGoal.ok && !String(belowGoal.error).includes('unlimited')
)

check('sold out at max', isRaffleSoldOutAtMax({ max_tickets: 50 }, 50))
check('not sold out below max', !isRaffleSoldOutAtMax({ max_tickets: 50 }, 49))
check('unlimited never sold out', !isRaffleSoldOutAtMax({ max_tickets: null }, 9999))

const soldOutLabel = raffleSoldOutButtonLabel(
  { max_tickets: 10, status: 'live', winner_wallet: null, winner_selected_at: null },
  0
)
check('sold out label mentions draw', soldOutLabel.includes('Draw Pending'))

const soldOutMsg = raffleSoldOutDetailMessage(
  { max_tickets: 10, status: 'live', winner_wallet: null, winner_selected_at: null },
  0
)
check('sold out detail mentions early draw', soldOutMsg.includes('end time'))

assert.equal(process.exitCode ?? 0, 0, 'one or more checks failed')
console.log('All max-tickets tests passed.')
