import { isOwlCenterLaunchMintEndedForRebate } from '@/lib/owl-center/platform-fee-rebate'

/**
 * Creator Enable trading is soft-gated until sell-out.
 * Admin thaw routes skip this gate for emergencies.
 */
export function isCreatorCoreThawAllowed(launch: {
  active_phase?: string | null
  status?: string | null
  minted_count?: number | null
  total_supply?: number | null
  freeze_status?: string | null
}): { ok: true } | { ok: false; error: string } {
  if (launch.freeze_status === 'thawed') {
    return { ok: false, error: 'Trading is already enabled for this collection.' }
  }
  if (!isOwlCenterLaunchMintEndedForRebate(launch)) {
    return {
      ok: false,
      error:
        'Enable trading is available after the collection sells out. Planned unlock date is a reminder only and does not auto-unlock.',
    }
  }
  return { ok: true }
}
