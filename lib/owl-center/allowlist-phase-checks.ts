/**
 * Soft-allowlist membership per phase for buyer checkmarks.
 * Pure helpers — safe to unit-test without Solana RPC deps.
 */

import {
  normalizePhaseKey,
  partnerPhaseHasHolderGate,
  partnerPhaseHasRedeemTokenBurn,
  type PartnerAllowlistPhase,
} from '@/lib/owl-center/partner-allowlist-phases'
import type { SimpleMintAllowlistPhaseCheck } from '@/lib/owl-center/types'

/** Soft-WL membership per allowlist phase for buyer checkmarks (works before phase opens). */
export function buildAllowlistPhaseChecks(
  phases: PartnerAllowlistPhase[],
  wlRowsByPhaseKey: Map<string, { allowed_mints: number; used_mints: number }>
): SimpleMintAllowlistPhaseCheck[] {
  return phases.map((phase) => {
    const key = phase.key
    const label = phase.label
    if (partnerPhaseHasRedeemTokenBurn(phase) || partnerPhaseHasHolderGate(phase)) {
      return { key, label, on_list: null, allowed_mints: null, used_mints: null }
    }
    const pk = normalizePhaseKey(key) || key
    const row = wlRowsByPhaseKey.get(pk)
    if (!row) {
      return { key, label, on_list: false, allowed_mints: null, used_mints: null }
    }
    return {
      key,
      label,
      on_list: true,
      allowed_mints: Math.max(0, Math.floor(Number(row.allowed_mints) || 0)),
      used_mints: Math.max(0, Math.floor(Number(row.used_mints) || 0)),
    }
  })
}
