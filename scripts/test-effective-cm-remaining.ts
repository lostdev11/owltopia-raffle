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
  check('CM empty + DB lag → displayMinted prefers chain', r.displayMinted === 2000)
  check('CM empty + DB lag → ledgerLag 2', r.ledgerLag === 2)
  check('CM empty → cmFullyRedeemed', r.cmFullyRedeemed === true)
}

{
  // Partner stranded slots (accurate DB): mintable remaining still follows min(DB, chain).
  const r = computeEffectiveCmRemaining(222, 220, {
    ok: true,
    itemsLoaded: 222,
    itemsRedeemed: 220,
    remaining: 2,
  })
  check('stranded CM slots → remaining 2', r.remaining === 2)
  check('stranded CM slots → cmHasUnminted', r.cmHasUnminted === true)
  check('stranded CM slots → not onChainSoldOut', r.onChainSoldOut === false)
  check('stranded CM slots → displayMinted 220', r.displayMinted === 220)
}

{
  // Partner stranded slots with DB over-count: still show on-chain minted/remaining truth.
  const r = computeEffectiveCmRemaining(222, 222, {
    ok: true,
    itemsLoaded: 222,
    itemsRedeemed: 220,
    remaining: 2,
  })
  check('DB over-count stranded → displayMinted prefers chain 220', r.displayMinted === 220)
  check('DB over-count stranded → cmHasUnminted', r.cmHasUnminted === true)
  check('DB over-count stranded → mintable remaining 0 (DB exhausted)', r.remaining === 0)
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
