import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import type { SimpleMintEligibilityResponse } from '@/lib/owl-center/types'
import { scaleOwlCenterMintSolNeededLamports } from '@/lib/owl-center/mint-sol-budget'

function formatSolLamports(lamports: bigint | string | null | undefined, digits = 3): string | null {
  if (lamports == null) return null
  const n = typeof lamports === 'bigint' ? lamports : BigInt(lamports)
  if (n < 0n) return null
  const sol = Number(n) / LAMPORTS_PER_SOL
  return sol >= 0.01 ? sol.toFixed(digits) : sol.toFixed(4)
}

/** Per-NFT and (when qty > 1) total SOL needed for the selected batch. */
export function collectionMintSolHint(
  elig: SimpleMintEligibilityResponse | null,
  quantity = 1
): string | null {
  if (!elig?.wallet_sol_balance_lamports || !elig.mint_sol_needed_lamports) return null
  const balance = formatSolLamports(elig.wallet_sol_balance_lamports)
  const qty = Math.max(1, Math.floor(quantity))
  const totalNeeded = scaleOwlCenterMintSolNeededLamports(elig.mint_sol_needed_lamports, qty)
  const needed = formatSolLamports(totalNeeded)
  if (!balance || !needed) return null
  if (qty > 1) {
    const per = formatSolLamports(elig.mint_sol_needed_lamports)
    return per
      ? `Wallet balance: ~${balance} SOL · ~${needed} SOL for ${qty} mints (${per} SOL each: price + fee + rent).`
      : `Wallet balance: ~${balance} SOL · ~${needed} SOL for ${qty} mints (price + fee + rent).`
  }
  return `Wallet balance: ~${balance} SOL · ~${needed} SOL per mint (price + platform fee + rent).`
}

export function collectionMintDisabledHint(params: {
  connected: boolean
  eligLoading: boolean
  elig: SimpleMintEligibilityResponse | null
  eligError: string | null
  cmConfigured: boolean
  quantity?: number
}): string | null {
  const { connected, eligLoading, elig, eligError, cmConfigured, quantity = 1 } = params

  if (!connected) return 'Connect your wallet in the header to mint.'
  if (eligLoading && !elig) return null
  if (eligError) return 'Could not verify eligibility — check WiFi or mobile data, then tap Refresh.'
  if (!cmConfigured) return 'Mint is not configured yet — check back soon.'
  if (!elig) return 'Eligibility unavailable — tap Refresh below to retry.'
  if (elig.is_eligible) return collectionMintSolHint(elig, quantity)
  if (elig.reason?.toLowerCase().includes('need ~') && elig.wallet_sol_balance_lamports) {
    const balance = formatSolLamports(elig.wallet_sol_balance_lamports)
    if (balance) return `${elig.reason} (Your wallet shows ~${balance} SOL — refresh if that looks wrong.)`
  }
  return null
}
