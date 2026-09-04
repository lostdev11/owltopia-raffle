/**
 * public_simple mint window: dates and earlier phases must actually close PUBLIC.
 *
 * Run: npx --yes tsx scripts/test-public-simple-mint-schedule.ts
 */
import {
  getPublicSimpleMintOpensAt,
  isPublicSimpleMintOpen,
  launchHasQueuedMintPhases,
  publicSimpleMintClosedInfo,
  resolvePublicSimpleGuardStartDateIso,
  PUBLIC_SIMPLE_UNSCHEDULED_START_ISO,
} from '@/lib/owl-center/phase-schedule'

let failures = 0
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok  - ${name}`)
  } else {
    failures++
    console.error(`  FAIL - ${name}`)
  }
}

const NOW = Date.UTC(2026, 7, 17, 19, 0, 0) // Aug 17 2026 19:00 UTC
const FUTURE = '2026-08-24T15:46:00.000Z'
const PAST = '2026-08-10T15:46:00.000Z'
const PUBLIC_LATER = '2026-08-26T15:46:00.000Z'

const base = {
  launch_deadline_at: null as string | null,
  phase_schedule: {} as Record<string, string>,
  creator_wl_enabled: false,
  creator_presale_enabled: false,
  wl_supply: 0,
  presale_supply: 0,
}

console.log('Single-phase (no WL/presale):')
check('no dates → open', isPublicSimpleMintOpen(base, NOW) === true)
check('no dates → no on-chain startDate', resolvePublicSimpleGuardStartDateIso(base) === null)
{
  const withKickoff = { ...base, launch_deadline_at: FUTURE }
  check('future mint-opens → closed', isPublicSimpleMintOpen(withKickoff, NOW) === false)
  check('future mint-opens → opens at kickoff', getPublicSimpleMintOpensAt(withKickoff) === FUTURE)
  const info = publicSimpleMintClosedInfo(withKickoff, NOW)
  check('future mint-opens reason mentions Mint', Boolean(info?.reason.startsWith('Mint opens')))
}
{
  const live = { ...base, launch_deadline_at: PAST }
  check('past mint-opens → open', isPublicSimpleMintOpen(live, NOW) === true)
}
{
  const leftoverPublic = '2026-08-26T15:46:00.000Z'
  const movedBack = {
    ...base,
    launch_deadline_at: PAST,
    phase_schedule: { PUBLIC: leftoverPublic },
  }
  check(
    'simple mint: moving mint opens back wins over leftover later PUBLIC',
    getPublicSimpleMintOpensAt(movedBack) === PAST
  )
  check(
    'simple mint: earlier kickoff is live even if PUBLIC is still future',
    isPublicSimpleMintOpen(movedBack, NOW) === true
  )
}

console.log('WL configured, PUBLIC date missing (the Discord bug):')
{
  const wlOnly = {
    ...base,
    creator_wl_enabled: true,
    wl_supply: 50,
    launch_deadline_at: FUTURE,
    phase_schedule: { WHITELIST: FUTURE },
  }
  check('queued phases detected', launchHasQueuedMintPhases(wlOnly) === true)
  check('PUBLIC has no start → not open', isPublicSimpleMintOpen(wlOnly, NOW) === false)
  check('PUBLIC has no start → opensAt null', getPublicSimpleMintOpensAt(wlOnly) === null)
  const info = publicSimpleMintClosedInfo(wlOnly, NOW)
  check('reason mentions Whitelist', Boolean(info?.reason.startsWith('Whitelist opens')))
  check(
    'on-chain startDate parked far future',
    resolvePublicSimpleGuardStartDateIso(wlOnly) === PUBLIC_SIMPLE_UNSCHEDULED_START_ISO
  )
}

console.log('WL + explicit PUBLIC start:')
{
  const both = {
    ...base,
    creator_wl_enabled: true,
    wl_supply: 50,
    launch_deadline_at: FUTURE,
    phase_schedule: { WHITELIST: FUTURE, PUBLIC: PUBLIC_LATER },
  }
  check('before WL → closed', isPublicSimpleMintOpen(both, NOW) === false)
  check('opens at PUBLIC (later than kickoff)', getPublicSimpleMintOpensAt(both) === PUBLIC_LATER)
  check(
    'after WL but before PUBLIC → still closed',
    isPublicSimpleMintOpen(both, Date.parse(FUTURE) + 60_000) === false
  )
  check('at PUBLIC start → open', isPublicSimpleMintOpen(both, Date.parse(PUBLIC_LATER)) === true)
}

console.log('PUBLIC start only:')
{
  const pub = { ...base, phase_schedule: { PUBLIC: FUTURE } }
  check('future PUBLIC start → closed', isPublicSimpleMintOpen(pub, NOW) === false)
  check('past PUBLIC start → open', isPublicSimpleMintOpen({ ...pub, phase_schedule: { PUBLIC: PAST } }, NOW) === true)
}

if (failures > 0) {
  console.error(`\n${failures} failed`)
  process.exit(1)
}
console.log('\nAll public_simple mint-window checks passed')
