import assert from 'node:assert/strict'
import {
  buildRevShareSchedulePatchBody,
  isRevShareScheduleEditDirty,
  parseRevShareScheduleAmountField,
  revShareScheduleToEditFields,
} from '../lib/admin/rev-share-schedule-form'

assert.equal(parseRevShareScheduleAmountField(''), 0)
assert.equal(parseRevShareScheduleAmountField('   '), 0)
assert.equal(parseRevShareScheduleAmountField('0'), 0)
assert.equal(parseRevShareScheduleAmountField('0.0'), 0)
assert.equal(parseRevShareScheduleAmountField('1.7'), 1.7)
assert.equal(parseRevShareScheduleAmountField('0.8'), 0.8)
assert.equal(parseRevShareScheduleAmountField('-1'), 0)
assert.equal(parseRevShareScheduleAmountField('nope'), 0)

const emptyEdit = {
  gen1_next_date: '31 OCTOBER 2026',
  gen2_next_date: '31 OCTOBER 2026',
  total_sol: '',
  total_usdc: '',
  gen1_total_sol: '',
  gen1_total_usdc: '',
  gen2_total_sol: '',
  gen2_total_usdc: '',
}
const clearedBody = buildRevShareSchedulePatchBody(emptyEdit)
assert.deepEqual(clearedBody, {
  gen1_next_date: '31 OCTOBER 2026',
  gen2_next_date: '31 OCTOBER 2026',
  total_sol: 0,
  total_usdc: 0,
  gen1_total_sol: 0,
  gen1_total_usdc: 0,
  gen2_total_sol: 0,
  gen2_total_usdc: 0,
})

const zeroEdit = {
  ...emptyEdit,
  total_sol: '0',
  gen1_total_sol: '0',
  gen2_total_sol: '0',
}
const zeroBody = buildRevShareSchedulePatchBody(zeroEdit)
assert.equal(zeroBody.total_sol, 0)
assert.equal(zeroBody.gen1_total_sol, 0)
assert.equal(zeroBody.gen2_total_sol, 0)

const amountsEdit = {
  ...emptyEdit,
  total_sol: '2.5',
  gen1_total_sol: '0.8',
  gen2_total_sol: '1.7',
}
const amountsBody = buildRevShareSchedulePatchBody(amountsEdit)
assert.equal(amountsBody.total_sol, 2.5)
assert.equal(amountsBody.gen1_total_sol, 0.8)
assert.equal(amountsBody.gen2_total_sol, 1.7)

const server = {
  next_date: '31 OCTOBER 2026',
  gen1_next_date: '31 OCTOBER 2026',
  gen2_next_date: '31 OCTOBER 2026',
  total_sol: 2.5,
  total_usdc: 0,
  gen1_total_sol: 0.8,
  gen1_total_usdc: 0,
  gen2_total_sol: 1.7,
  gen2_total_usdc: 0,
}
const synced = revShareScheduleToEditFields(server)
assert.equal(synced.gen1_total_sol, '0.8')
assert.equal(synced.gen2_total_sol, '1.7')
assert.equal(isRevShareScheduleEditDirty(synced, server), false)

const clearedGen1 = { ...synced, gen1_total_sol: '' }
assert.equal(isRevShareScheduleEditDirty(clearedGen1, server), true)

const typedZero = { ...synced, gen1_total_sol: '0', gen2_total_sol: '0', total_sol: '0' }
assert.equal(isRevShareScheduleEditDirty(typedZero, server), true)

console.log('test-rev-share-schedule-form: ok')
