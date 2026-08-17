import assert from 'node:assert/strict'
import {
  parseMaxTicketsPerWalletInput,
  validateMaxTicketsPerWallet,
} from '../lib/raffles/max-tickets-per-wallet'

const okNull = validateMaxTicketsPerWallet(null, 100)
assert.equal(okNull.ok, true)
if (okNull.ok) assert.equal(okNull.value, null)

const okBoth = validateMaxTicketsPerWallet(5, 100)
assert.equal(okBoth.ok, true)
if (okBoth.ok) assert.equal(okBoth.value, 5)

const overMax = validateMaxTicketsPerWallet(50, 10)
assert.equal(overMax.ok, false)

const bad = validateMaxTicketsPerWallet(0, null)
assert.equal(bad.ok, false)

const parsedEmpty = parseMaxTicketsPerWalletInput('')
assert.equal(parsedEmpty.ok, true)
if (parsedEmpty.ok) assert.equal(parsedEmpty.value, null)

const parsedNum = parseMaxTicketsPerWalletInput('3')
assert.equal(parsedNum.ok, true)
if (parsedNum.ok) assert.equal(parsedNum.value, 3)

const parsedUndef = parseMaxTicketsPerWalletInput(undefined)
assert.equal(parsedUndef.ok, true)
if (parsedUndef.ok) assert.equal(parsedUndef.value, null)

console.log('max-tickets-per-wallet validation ok')
