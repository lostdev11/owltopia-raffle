import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { getLaunchPriceLamportsQuotes } from '@/lib/owl-center/launch-price-quotes'
import { buildOwlCenterMintControls, isOwlCenterMintGloballyDisabled } from '@/lib/owl-center/mint-policy'
import { owlCenterPlatformMintFeeUsdc } from '@/lib/owl-center/platform-mint-fee'
import type { SimpleMintEligibilityResponse } from '@/lib/owl-center/types'
import { launchMintInfraConfigured, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

async function walletPublicMintCount(launchId: string, wallet: string): Promise<number> {
  const db = getSupabaseAdmin()
  const { data } = await db
    .from('owl_center_mint_events')
    .select('quantity')
    .eq('launch_id', launchId)
    .eq('wallet_address', wallet)
    .eq('phase', 'PUBLIC')
  return (data ?? []).reduce((sum, row) => sum + Number((row as { quantity: number }).quantity ?? 0), 0)
}

export async function buildSimpleMintEligibility(
  slug: string,
  walletRaw: string | null
): Promise<SimpleMintEligibilityResponse | null> {
  const launch = await getOwlCenterLaunchBySlug(slug)
  if (!launch || launch.mint_mode !== 'public_simple') return null

  const mint_network = resolveLaunchMintNetwork(launch)
  const mint_operational =
    !isOwlCenterMintGloballyDisabled(launch.is_paused) && launchMintInfraConfigured(launch)

  const remaining = Math.max(0, launch.total_supply - launch.minted_count)
  const wallet = walletRaw?.trim() ? normalizeSolanaWalletAddress(walletRaw.trim()) : null
  const wallet_minted = wallet ? await walletPublicMintCount(launch.id, wallet) : 0
  const walletRemaining = Math.max(0, launch.wallet_mint_limit - wallet_minted)

  const prices_lamports = await getLaunchPriceLamportsQuotes(launch)
  const unit_lamports_estimate = prices_lamports.public

  let reason: string | null = null
  let is_eligible = false
  let max_mintable = 0

  if (buildOwlCenterMintControls(launch.is_paused).disabled) {
    reason = 'Mint is paused'
  } else if (!mint_operational) {
    reason = 'Candy Machine not configured — admin must set CM + collection mint'
  } else if (launch.active_phase === 'SOLD_OUT' || launch.active_phase === 'TRADING_ACTIVE' || remaining <= 0) {
    reason = 'Sold out'
  } else if (launch.active_phase !== 'PUBLIC') {
    reason = `Mint opens during PUBLIC phase (current: ${launch.active_phase})`
  } else if (!wallet) {
    reason = 'Connect wallet to mint'
  } else if (walletRemaining <= 0) {
    reason = `Wallet limit reached (${launch.wallet_mint_limit} per wallet)`
  } else {
    max_mintable = Math.min(walletRemaining, remaining, 10)
    is_eligible = max_mintable > 0
    if (!is_eligible) reason = 'Not eligible'
  }

  return {
    active_phase: launch.active_phase,
    status: launch.status,
    is_paused: launch.is_paused,
    is_eligible,
    max_mintable,
    reason,
    wallet_minted,
    wallet_mint_limit: launch.wallet_mint_limit,
    unit_lamports_estimate,
    sol_usd_price: null,
    price_usdc: launch.public_price_usdc,
    platform_mint_fee_usdc: owlCenterPlatformMintFeeUsdc(),
    mint_network,
    mint_operational,
  }
}
