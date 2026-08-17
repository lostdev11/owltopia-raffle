import assert from 'node:assert/strict'
import {
  isLaunchPublicMintOpenNow,
  launchCollectionCtaLabel,
  launchPublicPhaseBadgeLabel,
  launchScheduledPublicReason,
} from '@/lib/owl-center/launch-mint-open'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
const past = new Date(Date.now() - 60_000).toISOString()

const scheduled = {
  active_phase: 'PUBLIC',
  active_phases: [],
  status: 'PUBLIC',
  is_paused: false,
  phase_schedule: { PUBLIC: future },
  launch_deadline_at: future,
  slug: 'bopper',
} as Pick<
  OwlCenterLaunchPublic,
  | 'active_phase'
  | 'active_phases'
  | 'status'
  | 'is_paused'
  | 'phase_schedule'
  | 'launch_deadline_at'
  | 'slug'
>

assert.equal(isLaunchPublicMintOpenNow(scheduled), false)
assert.match(launchCollectionCtaLabel(scheduled), /^Opens /)
assert.match(String(launchPublicPhaseBadgeLabel(scheduled)), /opens/i)
assert.match(String(launchScheduledPublicReason(scheduled)), /opens/i)

const open = {
  ...scheduled,
  phase_schedule: { PUBLIC: past },
  launch_deadline_at: past,
}
assert.equal(isLaunchPublicMintOpenNow(open), true)
assert.equal(launchCollectionCtaLabel(open), 'Mint Now')
assert.equal(launchPublicPhaseBadgeLabel(open), null)

console.log('ok: scheduled public mint stays closed until open time')
