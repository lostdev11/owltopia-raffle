/**
 * Unit checks for Gen2 / CM remaining capping (DB ledger vs on-chain Candy Machine).
 *
 * Run: npx --yes tsx scripts/test-effective-cm-remaining.ts
 */
import { computeEffectiveCmRemaining } from '@/lib/owl-center/effective-cm-remaining'

let failures = 0
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok  - ${name}`)
  } else {
    failures++
    console.error(`  FAIL - ${name}`)
  }
}

console.log('Effective CM remaining:')

{
  const r = computeEffectiveCmRemaining(2000, 1998, null)
  check('no CM snapshot → DB remaining', r.remaining === 2 && !r.onChainSoldOut)
}

{
  const r = computeEffectiveCmRemaining(2000, 1998, { ok: false })
  check('CM fetch failed → DB remaining (fail open)', r.remaining === 2 && !r.onChainSoldOut)
}

{
  // The bug from prod: DB says 2 left, CM is empty → must not advertise leftovers.
  const r = computeEffectiveCmRemaining(2000, 1998, {
    ok: true,
    itemsLoaded: 2000,
    itemsRedeemed: 2000,
    remaining: 0,
  })
  check('CM empty + DB leftovers → remaining 0', r.remaining === 0)
  check('CM empty + DB leftovers → onChainSoldOut', r.onChainSoldOut === true)
  check('team backstop max would be 0', Math.min(25, r.remaining) === 0)
}

{
  const r = computeEffectiveCmRemaining(2000, 1990, {
    ok: true,
    itemsLoaded: 2000,
    itemsRedeemed: 1995,
    remaining: 5,
  })
  check('mins DB and CM when both have supply', r.remaining === 5)
  check('not on-chain sold out while CM has items', r.onChainSoldOut === false)
}

{
  const r = computeEffectiveCmRemaining(2000, 1998, {
    ok: true,
    itemsLoaded: 2000,
    itemsRedeemed: 1997,
    remaining: 3,
  })
  check('DB lag behind CM → use lower DB remaining', r.remaining === 2)
}

{
  // Unloaded / empty CM account should not force sold-out (itemsLoaded = 0).
  const r = computeEffectiveCmRemaining(2000, 0, {
    ok: true,
    itemsLoaded: 0,
    itemsRedeemed: 0,
    remaining: 0,
  })
  check('itemsLoaded 0 → remaining 0 but not onChainSoldOut', r.remaining === 0 && !r.onChainSoldOut)
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll effective-cm-remaining checks passed.')
