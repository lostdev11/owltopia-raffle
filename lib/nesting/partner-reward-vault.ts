/**
 * Platform vault that holds partner SPL deposits for Nesting claims.
 * Reuses the OWL reward treasury keypair (separate ATA per reward mint).
 */

import { getNestingOwlRewardTreasuryKeypair } from '@/lib/nesting/reward-treasury-keypair'
import { getNestingRewardTreasuryWallet } from '@/lib/nesting/policy'

/** Public wallet partners send SPL rewards to (ATA owner). */
export function getPartnerNestRewardVaultWallet(): string {
  const fromKey = getNestingOwlRewardTreasuryKeypair()?.publicKey.toBase58()
  if (fromKey) return fromKey
  return getNestingRewardTreasuryWallet().trim()
}

export function getPartnerNestRewardVaultKeypair() {
  return getNestingOwlRewardTreasuryKeypair()
}

export function isPartnerTokenRewardPool(pool: {
  reward_token?: string | null
  reward_mint?: string | null
  partner_project_slug?: string | null
}): boolean {
  const token = (pool.reward_token ?? '').trim().toUpperCase()
  if (!token || token === 'OWL') return false
  return Boolean(pool.reward_mint?.trim() && pool.partner_project_slug?.trim())
}
