/**
 * OwlSwap simulation mode — admin preview without OWL_SWAP_ESCROW_SECRET_KEY.
 *
 * Enabled when:
 * - OwlSwap is NOT public, AND
 * - OWL_SWAP_SIMULATE is not explicitly false, AND
 * - (OWL_SWAP_SIMULATE / NEXT_PUBLIC_OWL_SWAP_SIMULATE is true) OR escrow key is missing
 *
 * Never enabled when OwlSwap is public (real custody required).
 * Simulated signatures are prefixed with `sim:` and never verified on-chain.
 */

import { isOwlSwapPublic, isOwlSwapPublicClient } from '@/lib/owl-swap/access'

function readBoolean(raw: string | undefined): boolean | null {
  if (raw == null || raw.trim() === '') return null
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no') return false
  return null
}

const SIM_PREFIX = 'sim:'

/** Env presence only — parsing validity is checked when live deposit APIs run. */
function hasOwlSwapEscrowKeyConfigured(): boolean {
  const raw = process.env.OWL_SWAP_ESCROW_SECRET_KEY
  return typeof raw === 'string' && raw.trim() !== ''
}

export function isOwlSwapSimulateSignature(signature: string | null | undefined): boolean {
  return typeof signature === 'string' && signature.startsWith(SIM_PREFIX)
}

export function makeOwlSwapSimulateSignature(
  kind: 'maker-deposit' | 'taker-deposit' | 'settle' | 'reclaim',
  offerId: string
): string {
  const t = Date.now().toString(36)
  return `${SIM_PREFIX}${kind}:${offerId.slice(0, 8)}:${t}`
}

/**
 * Server: whether simulate flows are allowed right now.
 */
export function isOwlSwapSimulateEnabled(): boolean {
  if (typeof process === 'undefined') return false
  if (isOwlSwapPublic()) return false

  const explicit =
    readBoolean(process.env.OWL_SWAP_SIMULATE) ??
    readBoolean(process.env.NEXT_PUBLIC_OWL_SWAP_SIMULATE)

  if (explicit === false) return false
  if (explicit === true) return true

  // Auto: admin-only preview with no escrow key.
  return !hasOwlSwapEscrowKeyConfigured()
}

/** Client-safe: explicit NEXT_PUBLIC flag only (API still authoritative via escrow GET). */
export function isOwlSwapSimulateForcedClient(): boolean {
  if (typeof process === 'undefined') return false
  if (isOwlSwapPublicClient()) return false
  return readBoolean(process.env.NEXT_PUBLIC_OWL_SWAP_SIMULATE) === true
}
