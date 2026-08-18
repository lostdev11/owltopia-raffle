/**
 * Smoke checks for Gen2 milestone edit validation rules used by PATCH.
 * Run: npx tsx scripts/test-gen2-milestone-edit-validation.ts
 */
import { validateGen2Milestone } from '../lib/owl-center/gen2-milestones/validation'
import { gen2MilestoneTargetMints } from '../lib/owl-center/gen2-milestones/target'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

// Self-target excluded from existingTargets → edit that keeps the same target is ok
{
  const selfTarget = 500
  const result = validateGen2Milestone({
    raw: {
      trigger_type: 'absolute_mints',
      trigger_value: 500,
      prize_amount: 1,
      prize_currency: 'SOL',
      winner_mode: 'random',
    },
    totalSupply: 2222,
    mintedCount: 10,
    existingTargets: [250, 750], // self 500 omitted (as PATCH does)
  })
  assert(result.ok, 'same-target self-edit should pass when self excluded')
  if (result.ok) {
    assert(result.target === selfTarget, `expected target ${selfTarget}, got ${result.target}`)
  }
}

// Duplicate against another milestone still rejected
{
  const result = validateGen2Milestone({
    raw: {
      trigger_type: 'absolute_mints',
      trigger_value: 250,
      prize_amount: 1,
      prize_currency: 'SOL',
      winner_mode: 'top_buyer',
    },
    totalSupply: 2222,
    mintedCount: 10,
    existingTargets: [250, 750],
  })
  assert(!result.ok, 'duplicate target against another milestone should fail')
}

// Past / current mint count rejected
{
  const result = validateGen2Milestone({
    raw: {
      trigger_type: 'absolute_mints',
      trigger_value: 10,
      prize_amount: 1,
      prize_currency: 'SOL',
      winner_mode: 'random',
    },
    totalSupply: 2222,
    mintedCount: 10,
    existingTargets: [],
  })
  assert(!result.ok, 'target at/below minted count should fail')
}

// Percent supply target math
{
  const target = gen2MilestoneTargetMints(
    { trigger_type: 'percent_supply', trigger_value: 50 },
    2222
  )
  assert(target === 1111, `expected 1111, got ${target}`)
}

console.log('ok: gen2 milestone edit validation')
