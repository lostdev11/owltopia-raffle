/**
 * Unit checks for CM ↔ ledger integrity gates (Gen2 lag + partner stranded slots).
 *
 * Run: npx --yes tsx scripts/test-cm-supply-integrity.ts
 */
import {
  computeCmSupplyIntegrity,
  evaluateSelloutMarketplacePrepGate,
  isLaunchMarketplaceListingUnlockedWithCm,
  shouldReconcileOrphanMints,
} from '@/lib/owl-center/cm-supply-integrity'
let failures = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  - ${name}`)
  else {
    failures++
    console.error(`  FAIL - ${name}`)
  }
}

console.log('CM supply integrity:')

check('reconcile when chain ahead of DB', shouldReconcileOrphanMints(2000, 1998))
check('reconcile even after would-be SOLD_OUT', shouldReconcileOrphanMints(222, 220))
check('no reconcile when caught up', !shouldReconcileOrphanMints(220, 220))

{
  const r = computeCmSupplyIntegrity(2000, 1998, {
    ok: true,
    itemsLoaded: 2000,
    itemsRedeemed: 2000,
    remaining: 0,
  })
  check('gen2 displayMinted prefers chain', r.displayMinted === 2000)
  check('gen2 ledgerLag is 2', r.ledgerLag === 2)
  check('gen2 cmFullyRedeemed', r.cmFullyRedeemed)
  check('gen2 supplyMismatch', r.supplyMismatch)
}

{
  const r = computeCmSupplyIntegrity(222, 220, {
    ok: true,
    itemsLoaded: 222,
    itemsRedeemed: 220,
    remaining: 2,
  })
  check('breppe displayMinted is 220', r.displayMinted === 220)
  check('breppe displayRemaining is 2', r.displayRemaining === 2)
  check('breppe cmHasUnminted', r.cmHasUnminted)
  check('breppe not fully redeemed', !r.cmFullyRedeemed)
}

{
  const gate = evaluateSelloutMarketplacePrepGate({
    dbOrPhaseSoldOut: true,
    cmFullyRedeemed: false,
    hashListCount: 220,
    itemsRedeemed: 220,
  })
  check('block sellout prep while CM has slots', !gate.ok && gate.reason === 'cm_not_empty')
}

{
  const gate = evaluateSelloutMarketplacePrepGate({
    dbOrPhaseSoldOut: true,
    cmFullyRedeemed: true,
    hashListCount: 1998,
    itemsRedeemed: 2000,
  })
  check('block sellout prep when hash list short', !gate.ok && gate.reason === 'hash_list_incomplete')
}

{
  const gate = evaluateSelloutMarketplacePrepGate({
    dbOrPhaseSoldOut: true,
    cmFullyRedeemed: true,
    hashListCount: 2000,
    itemsRedeemed: 2000,
  })
  check('allow sellout prep when CM empty and hash complete', gate.ok)
}

check(
  'marketplace unlock blocked while CM has slots',
  !isLaunchMarketplaceListingUnlockedWithCm(true, false)
)
check(
  'marketplace unlock allowed when CM empty',
  isLaunchMarketplaceListingUnlockedWithCm(true, true)
)
check(
  'marketplace unlock fail-open when CM unread',
  isLaunchMarketplaceListingUnlockedWithCm(true, null)
)

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll cm-supply-integrity checks passed.')
