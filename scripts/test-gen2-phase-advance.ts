/**
 * Unit checks for the Gen2 sequential phase-advance decision.
 *
 * Launch model (fixed clock + airdrop backstop), offsets from base = 16:00 UTC:
 * - 16:00–16:25 AIRDROP (Gen1, free)       — 25-min window or sellout
 * - 16:25–16:50 PRESALE (free, prepaid)    — 25-min window or sellout
 * - 16:50–17:00 PRESALE_OVERAGE (+13, free)— 10-min window or sellout
 * - 17:00–18:00 WHITELIST ($30)            — +1h open floor, 1h window or sellout
 * - 18:00+      PUBLIC ($40)               — +2h open floor, terminal (SOLD_OUT via mint RPC)
 *
 * Run: npx --yes tsx scripts/test-gen2-phase-advance.ts
 */
import {
  decideGen2PhaseTransition,
  gen2PhaseOpenFloorOffsetMs,
  gen2PhasePoolCap,
  gen2PhaseWindowMs,
} from '@/lib/owl-center/gen2-phase-advance'

let failures = 0
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok  - ${name}`)
  } else {
    failures++
    console.error(`  FAIL - ${name}`)
  }
}

const T0 = Date.UTC(2026, 5, 26, 16, 0, 0) // June 26 16:00 UTC (launch base)
const MIN = 60 * 1000
const HOUR = 60 * MIN
const WL_FLOOR = T0 + HOUR // 17:00 UTC
const PUBLIC_FLOOR = T0 + 2 * HOUR // 18:00 UTC

console.log('Per-phase windows & floors:')
check('AIRDROP window = 25 min', gen2PhaseWindowMs('AIRDROP') === 25 * MIN)
check('PRESALE window = 25 min', gen2PhaseWindowMs('PRESALE') === 25 * MIN)
check('PRESALE_OVERAGE window = 10 min', gen2PhaseWindowMs('PRESALE_OVERAGE') === 10 * MIN)
check('WHITELIST window = 1 hour', gen2PhaseWindowMs('WHITELIST') === HOUR)
check('PUBLIC window = Infinity (never window-advances)', gen2PhaseWindowMs('PUBLIC') === Number.POSITIVE_INFINITY)
check('early windows cascade to 60 min', gen2PhaseWindowMs('AIRDROP') + gen2PhaseWindowMs('PRESALE') + gen2PhaseWindowMs('PRESALE_OVERAGE') === HOUR)
check('AIRDROP has no open floor', gen2PhaseOpenFloorOffsetMs('AIRDROP') === null)
check('PRESALE has no open floor', gen2PhaseOpenFloorOffsetMs('PRESALE') === null)
check('PRESALE_OVERAGE has no open floor', gen2PhaseOpenFloorOffsetMs('PRESALE_OVERAGE') === null)
check('WHITELIST open floor = +1h', gen2PhaseOpenFloorOffsetMs('WHITELIST') === HOUR)
check('PUBLIC open floor = +2h', gen2PhaseOpenFloorOffsetMs('PUBLIC') === 2 * HOUR)

console.log('Gen2 phase-advance decision:')

// Before a phase starts: never advance.
check(
  'AIRDROP not started yet → hold',
  decideGen2PhaseTransition({ currentPhase: 'AIRDROP', activationMs: T0, mintedInPhase: 0, poolCap: 343, nowMs: T0 - 1 }).advance === false
)

// Within the 25-min window, not sold out → hold.
check(
  'AIRDROP within 25-min window, partial mint → hold',
  decideGen2PhaseTransition({ currentPhase: 'AIRDROP', activationMs: T0, mintedInPhase: 100, poolCap: 343, nowMs: T0 + 10 * MIN }).advance === false
)

// Sold out early → advance immediately to PRESALE (no floor on PRESALE).
{
  const d = decideGen2PhaseTransition({ currentPhase: 'AIRDROP', activationMs: T0, mintedInPhase: 343, poolCap: 343, nowMs: T0 + 5 * MIN })
  check('AIRDROP sold out → advance to PRESALE immediately (sold_out)', d.advance === true && d.to === 'PRESALE' && d.trigger === 'sold_out')
}

// 25-min window elapses, not sold out → advance to PRESALE (window_elapsed).
{
  const d = decideGen2PhaseTransition({ currentPhase: 'AIRDROP', activationMs: T0, mintedInPhase: 200, poolCap: 343, nowMs: T0 + 25 * MIN })
  check('AIRDROP 25-min window elapsed → advance to PRESALE (window_elapsed)', d.advance === true && d.to === 'PRESALE' && d.trigger === 'window_elapsed')
}

// PRESALE window elapses (16:25 → 16:50) → advance to PRESALE_OVERAGE.
{
  const d = decideGen2PhaseTransition({ currentPhase: 'PRESALE', activationMs: T0 + 25 * MIN, mintedInPhase: 600, poolCap: 657, nowMs: T0 + 50 * MIN })
  check('PRESALE 25-min window elapsed → advance to PRESALE_OVERAGE', d.advance === true && d.to === 'PRESALE_OVERAGE' && d.trigger === 'window_elapsed')
}

// PRESALE_OVERAGE sold out before 17:00 → hold for WL floor.
check(
  'PRESALE_OVERAGE sold out before 17:00 → hold for WL floor',
  decideGen2PhaseTransition({ currentPhase: 'PRESALE_OVERAGE', activationMs: T0 + 50 * MIN, mintedInPhase: 13, poolCap: 13, nowMs: T0 + 55 * MIN, nextFloorMs: WL_FLOOR }).advance === false
)

// PRESALE_OVERAGE window elapses at 17:00 and WL floor reached → advance to WHITELIST.
{
  const d = decideGen2PhaseTransition({ currentPhase: 'PRESALE_OVERAGE', activationMs: T0 + 50 * MIN, mintedInPhase: 5, poolCap: 13, nowMs: WL_FLOOR, nextFloorMs: WL_FLOOR })
  check('PRESALE_OVERAGE done + WL floor (17:00) → advance to WHITELIST', d.advance === true && d.to === 'WHITELIST' && d.trigger === 'window_elapsed')
}

// WHITELIST sold out before 18:00 → hold for PUBLIC floor.
check(
  'WHITELIST sold out before 18:00 → hold for PUBLIC floor',
  decideGen2PhaseTransition({ currentPhase: 'WHITELIST', activationMs: WL_FLOOR, mintedInPhase: 800, poolCap: 800, nowMs: WL_FLOOR + 30 * MIN, nextFloorMs: PUBLIC_FLOOR }).advance === false
)

// WHITELIST 1h window + 18:00 floor → advance to PUBLIC.
{
  const d = decideGen2PhaseTransition({ currentPhase: 'WHITELIST', activationMs: WL_FLOOR, mintedInPhase: 10, poolCap: 800, nowMs: PUBLIC_FLOOR, nextFloorMs: PUBLIC_FLOOR })
  check('WHITELIST 1h window + 18:00 floor → advance to PUBLIC', d.advance === true && d.to === 'PUBLIC' && d.trigger === 'window_elapsed')
}

// PUBLIC is terminal for this logic (SOLD_OUT handled by mint RPC on total supply).
check(
  'PUBLIC never auto-advances here',
  decideGen2PhaseTransition({ currentPhase: 'PUBLIC', activationMs: T0, mintedInPhase: 200, poolCap: 200, nowMs: T0 + 10 * HOUR }).advance === false
)

// Missing activation time → hold (safety).
check(
  'no activation time → hold',
  decideGen2PhaseTransition({ currentPhase: 'PRESALE', activationMs: null, mintedInPhase: 0, poolCap: 657, nowMs: T0 }).advance === false
)

// Pool cap mapping.
const launch = { airdrop_supply: 343, presale_supply: 657, presale_overage_supply: 13, wl_supply: 800, public_supply: 200 }
console.log('Pool cap mapping:')
check('AIRDROP cap = 343', gen2PhasePoolCap(launch, 'AIRDROP') === 343)
check('PRESALE cap = 657', gen2PhasePoolCap(launch, 'PRESALE') === 657)
check('PRESALE_OVERAGE cap = 13', gen2PhasePoolCap(launch, 'PRESALE_OVERAGE') === 13)
check('WHITELIST cap = 800', gen2PhasePoolCap(launch, 'WHITELIST') === 800)
check('PUBLIC cap = 200', gen2PhasePoolCap(launch, 'PUBLIC') === 200)

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll checks passed.')
