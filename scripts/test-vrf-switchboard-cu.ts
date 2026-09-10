/**
 * Switchboard VRF CU budget helpers.
 * Run: npx tsx scripts/test-vrf-switchboard-cu.ts
 *
 * Regression for Jimmy pack open: RandomnessCommit failed with
 * "consumed 8648 of 8648 compute units" under 1.3× sim headroom.
 */
import assert from 'node:assert/strict'
import {
  SWITCHBOARD_TX_CU_LIMIT_MULTIPLE,
  SWITCHBOARD_TX_CU_MAX,
  SWITCHBOARD_TX_CU_MIN,
  isComputeUnitExhaustedError,
  resolveSwitchboardComputeUnitLimit,
} from '../lib/raffles/draw/vrf-switchboard-cu'

function main() {
  assert.equal(SWITCHBOARD_TX_CU_LIMIT_MULTIPLE, 2.5)
  assert.equal(SWITCHBOARD_TX_CU_MIN, 50_000)

  // Prod cliff: Switchboard asV0Tx set limit to 8648 (sim × 1.3) and RandomnessCommit
  // exhausted exactly that budget. Reconstruct a realistic sim that yields 8648 at 1.3×.
  const jimmySimConsumed = 6653 // floor(6653 * 1.3) === 8648
  const oldLimit = Math.floor(jimmySimConsumed * 1.3)
  assert.equal(oldLimit, 8648)

  const fixed = resolveSwitchboardComputeUnitLimit({
    unitsConsumed: jimmySimConsumed,
  })
  assert.ok(fixed >= SWITCHBOARD_TX_CU_MIN)
  assert.ok(fixed > oldLimit)
  assert.equal(
    fixed,
    Math.max(SWITCHBOARD_TX_CU_MIN, Math.floor(jimmySimConsumed * 2.5))
  )

  // Missing / zero sim → floor.
  assert.equal(resolveSwitchboardComputeUnitLimit({ unitsConsumed: undefined }), SWITCHBOARD_TX_CU_MIN)
  assert.equal(resolveSwitchboardComputeUnitLimit({ unitsConsumed: 0 }), SWITCHBOARD_TX_CU_MIN)
  assert.equal(resolveSwitchboardComputeUnitLimit({ unitsConsumed: NaN }), SWITCHBOARD_TX_CU_MIN)

  // High sim still respects max.
  assert.equal(
    resolveSwitchboardComputeUnitLimit({ unitsConsumed: 1_000_000 }),
    SWITCHBOARD_TX_CU_MAX
  )

  // Explicit overrides.
  assert.equal(
    resolveSwitchboardComputeUnitLimit({
      unitsConsumed: 10_000,
      multiple: 1.1,
      minUnits: 5_000,
    }),
    11_000
  )

  assert.equal(isComputeUnitExhaustedError('exceeded CUs meter at BPF instruction'), true)
  assert.equal(
    isComputeUnitExhaustedError(
      'Program SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv failed: exceeded CUs meter'
    ),
    true
  )
  assert.equal(isComputeUnitExhaustedError('InvalidSecpSignature'), false)

  console.log(
    JSON.stringify(
      {
        ok: true,
        jimmySimConsumed,
        oldLimit,
        fixedLimit: fixed,
        multiple: SWITCHBOARD_TX_CU_LIMIT_MULTIPLE,
        min: SWITCHBOARD_TX_CU_MIN,
      },
      null,
      2
    )
  )
}

main()
