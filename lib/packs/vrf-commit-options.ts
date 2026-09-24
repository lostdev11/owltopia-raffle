import {
  PACK_SWITCHBOARD_SEED_WAIT,
  type SwitchboardCommitRandomnessOptions,
} from '@/lib/raffles/draw/vrf-switchboard'

/** Switchboard commit tuning for pack opens (speed without skipping fairness). */
export function resolvePackSwitchboardCommitOptions(): SwitchboardCommitRandomnessOptions {
  return {
    bundleCreateAndCommit: true,
    postCommitSeedWait: PACK_SWITCHBOARD_SEED_WAIT,
    timingScope: 'pack',
  }
}
