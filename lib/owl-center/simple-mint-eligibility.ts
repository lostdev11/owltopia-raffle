import { Connection, PublicKey } from '@solana/web3.js'

import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { getLaunchWlWallet, sumLaunchWlPhaseUsedMints } from '@/lib/db/owl-center-launch-wl-wallets'
import { getOptionalLamportsQuoteForUsdc } from '@/lib/gen2-presale/pricing'
import { getLaunchPriceLamportsQuotes } from '@/lib/owl-center/launch-price-quotes'
import { launchScheduledPublicReason } from '@/lib/owl-center/launch-mint-open'
import { resolvePartnerMintUnitPrice, publicSimpleSolMintLamports } from '@/lib/owl-center/partner-mint-phase-schedule'
import { resolvePartnerPhaseWalletMintLimit } from '@/lib/owl-center/partner-allowlist-phases'
import {
  formatAllowlistOpensReason,
  getLaunchActiveAllowlistPhase,
  isLaunchWaitingForWhitelist,
  isLaunchWhitelistWindowOpen,
} from '@/lib/owl-center/launch-wl-window'
import { buildOwlCenterMintControls, isOwlCenterMintGloballyDisabled } from '@/lib/owl-center/mint-policy'
import { publicSimpleMintClosedInfo, isPhaseOpenBySchedule } from '@/lib/owl-center/phase-schedule'
import { OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS, isOwlCenterPlatformMintFeeEnabled, owlCenterPlatformMintFeeUsd, formatOwlCenterPlatformMintFeeSolLabel } from '@/lib/owl-center/platform-mint-fee'
import { getOwlCenterPlatformTreasuryWallet } from '@/lib/owl-center/platform-treasury'
import { maybeReconcileLaunchMintsFromChain } from '@/lib/owl-center/reconcile-launch-mints'
import type { SimpleMintEligibilityResponse } from '@/lib/owl-center/types'
import { fetchCandyMachineOnChainSupply } from '@/lib/solana/candy-machine-supply'
import {
  getLaunchCandyMachineId,
  launchMintInfraConfigured,
  resolveLaunchMintNetwork,
  getLaunchSolanaRpcUrl,
} from '@/lib/solana/launch-cm'
import { assertOwlCenterPlatformMintFeeSolBalance, resolveOwlCenterPlatformMintFeeLamports } from '@/lib/solana/owl-center-platform-mint-fee'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { invalidLaunchMintIdReason } from '@/lib/solana/validate-pubkey'

async function walletPublicMintCount(
  launchId: string,
  wallet: string,
  network: 'mainnet' | 'devnet'
): Promise<number> {
  const db = getSupabaseAdmin()
  const { data } = await db
    .from('owl_center_mint_events')
    .select('quantity')
    .eq('launch_id', launchId)
    .eq('wallet_address', wallet)
    .eq('phase', 'PUBLIC')
    .eq('network', network)
  return (data ?? []).reduce((sum, row) => sum + Number((row as { quantity: number }).quantity ?? 0), 0)
}

export async function buildSimpleMintEligibility(
  slug: string,
  walletRaw: string | null,
  opts?: { skipChainReconcile?: boolean }
): Promise<SimpleMintEligibilityResponse | null> {
  let launch = await getOwlCenterLaunchBySlug(slug)
  if (!launch || launch.mint_mode !== 'public_simple') return null

  if (!opts?.skipChainReconcile) {
    await maybeReconcileLaunchMintsFromChain(launch)
    launch = (await getOwlCenterLaunchBySlug(slug)) ?? launch
  }

  const mint_network = resolveLaunchMintNetwork(launch)
  const platform_treasury_wallet = getOwlCenterPlatformTreasuryWallet()
  const platformFeeEnabled = isOwlCenterPlatformMintFeeEnabled()
  const mint_operational =
    !isOwlCenterMintGloballyDisabled(launch.is_paused) &&
    launchMintInfraConfigured(launch) &&
    (!platformFeeEnabled || !!platform_treasury_wallet)

  const dbRemaining = Math.max(0, launch.total_supply - launch.minted_count)
  const cmId = getLaunchCandyMachineId(launch, mint_network)
  const onChainSupply = cmId ? await fetchCandyMachineOnChainSupply(cmId, mint_network) : { ok: false as const }
  const onChainRemaining = onChainSupply.ok ? onChainSupply.remaining : null
  const remaining =
    onChainRemaining != null ? Math.min(dbRemaining, onChainRemaining) : dbRemaining
  const onChainSoldOut = onChainRemaining === 0 && dbRemaining > 0
  const wallet = walletRaw?.trim() ? normalizeSolanaWalletAddress(walletRaw.trim()) : null
  const wallet_minted = wallet ? await walletPublicMintCount(launch.id, wallet, mint_network) : 0
  const allowlistOpen = isLaunchWhitelistWindowOpen(launch)
  const activeAllowlistPhase = allowlistOpen ? getLaunchActiveAllowlistPhase(launch) : null
  const effectiveWalletLimit = allowlistOpen
    ? resolvePartnerPhaseWalletMintLimit(activeAllowlistPhase, launch.wallet_mint_limit)
    : Math.max(1, Math.floor(Number(launch.wallet_mint_limit) || 1))
  // During allowlist, per-wallet progress is WL used_mints (below); public uses mint_events count.
  const walletRemainingPublic = Math.max(0, effectiveWalletLimit - wallet_minted)
  const scheduleClosed = publicSimpleMintClosedInfo(launch)
  const mint_window_open = allowlistOpen || scheduleClosed == null

  const prices_lamports = await getLaunchPriceLamportsQuotes(launch)
  const unitPrice = resolvePartnerMintUnitPrice(launch)
  const price_usdc = unitPrice.price_usdc
  let unit_lamports_estimate: string | null = prices_lamports.public
  if (unitPrice.from_allowlist) {
    if (unitPrice.price_sol != null && unitPrice.price_sol > 0) {
      unit_lamports_estimate = String(Math.round(unitPrice.price_sol * 1_000_000_000))
    } else if (price_usdc != null && price_usdc > 0) {
      const q = await getOptionalLamportsQuoteForUsdc(price_usdc)
      unit_lamports_estimate = q ? q.unitLamports.toString() : null
    } else {
      // Free allowlist phase (price 0 or unset treated as free for quote).
      unit_lamports_estimate = null
    }
  } else if (unitPrice.price_sol != null) {
    unit_lamports_estimate = publicSimpleSolMintLamports(launch)
  } else if (price_usdc != null && price_usdc <= 0) {
    unit_lamports_estimate = null
  }
  const platformFeeQuote = platformFeeEnabled ? await resolveOwlCenterPlatformMintFeeLamports() : null
  const platform_mint_fee_lamports_estimate =
    platformFeeQuote?.ok === true ? platformFeeQuote.lamports.toString() : null

  let reason: string | null = null
  let is_eligible = false
  let max_mintable = 0
  let reported_wallet_minted = wallet_minted
  let wallet_sol_balance_lamports: string | null = null
  let mint_sol_needed_lamports: string | null = null
  let on_allowlist: boolean | null = null
  let allowlist_spots_remaining: number | null = null

  if (wallet) {
    try {
      const conn = new Connection(getLaunchSolanaRpcUrl(mint_network), 'confirmed')
      wallet_sol_balance_lamports = String(await conn.getBalance(new PublicKey(wallet), 'confirmed'))
    } catch {
      wallet_sol_balance_lamports = null
    }
  }

  if (platformFeeEnabled && platformFeeQuote?.ok === true) {
    const priceLamports = unit_lamports_estimate != null ? BigInt(unit_lamports_estimate) : 0n
    mint_sol_needed_lamports = String(
      platformFeeQuote.lamports + OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS + priceLamports
    )
  } else if (unit_lamports_estimate != null) {
    mint_sol_needed_lamports = String(
      OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS + BigInt(unit_lamports_estimate)
    )
  }

  const prefetchedBalance =
    wallet_sol_balance_lamports != null ? BigInt(wallet_sol_balance_lamports) : null

  const invalidMintIds =
    invalidLaunchMintIdReason(launch.candy_machine_id, launch.collection_mint) ??
    invalidLaunchMintIdReason(launch.devnet_candy_machine_id, launch.devnet_collection_mint)

  if (buildOwlCenterMintControls(launch.is_paused).disabled) {
    reason = 'Mint is paused'
  } else if (invalidMintIds) {
    reason = invalidMintIds
  } else if (!mint_operational) {
    reason = platformFeeEnabled && !platform_treasury_wallet
      ? 'Platform treasury not configured — contact support'
      : 'Candy Machine not configured — admin must set CM + collection mint'
  } else if (launch.active_phase === 'SOLD_OUT' || launch.active_phase === 'TRADING_ACTIVE' || remaining <= 0) {
    reason = onChainSoldOut
      ? 'Sold out on-chain — supply counter is catching up. Refresh the page.'
      : 'Sold out'
  } else if (launch.active_phase !== 'PUBLIC') {
    reason = `Mint opens during PUBLIC phase (current: ${launch.active_phase})`
  } else if (isLaunchWaitingForWhitelist(launch)) {
    reason = formatAllowlistOpensReason(launch)
  } else if (!isLaunchWhitelistWindowOpen(launch) && scheduleClosed) {
    reason = scheduleClosed.reason
  } else if (!isLaunchWhitelistWindowOpen(launch) && !isPhaseOpenBySchedule(launch, 'PUBLIC')) {
    // No early allowlist window — honor scheduled PUBLIC open (#110).
    reason = launchScheduledPublicReason(launch) ?? 'Public mint is not open yet'
  } else if (!wallet) {
    reason = allowlistOpen && activeAllowlistPhase
      ? `${activeAllowlistPhase.label} is live — connect wallet to check if you’re on the list`
      : 'Connect wallet to mint'
  } else if (!allowlistOpen && walletRemainingPublic <= 0) {
    reason = `Wallet limit reached (${effectiveWalletLimit} per wallet)`
  } else {
    max_mintable = Math.min(allowlistOpen ? effectiveWalletLimit : walletRemainingPublic, remaining)

    if (allowlistOpen) {
      const activePhase = activeAllowlistPhase
      const phaseKey = activePhase?.key ?? 'wl'
      const phaseSupply = Math.max(0, Math.floor(Number(activePhase?.supply ?? 0) || 0))
      const phaseUsed = await sumLaunchWlPhaseUsedMints(launch.id, phaseKey)
      const phaseRemaining = phaseSupply > 0 ? Math.max(0, phaseSupply - phaseUsed) : 0

      if (phaseSupply < 1) {
        max_mintable = 0
        reason = activePhase
          ? `${activePhase.label} supply is not set — creator must set phase supply in Mint details`
          : 'Allowlist phase supply is not set'
      } else if (phaseRemaining <= 0) {
        max_mintable = 0
        reason = `${activePhase?.label ?? 'Allowlist'} phase is sold out (${phaseUsed}/${phaseSupply})`
      } else {
        const wlRow = await getLaunchWlWallet(launch.id, wallet, phaseKey)
        if (!wlRow) {
          on_allowlist = false
          allowlist_spots_remaining = 0
          max_mintable = 0
          reason = activePhase
            ? `Not on the ${activePhase.label} list — wait for the next phase or public`
            : 'Wallet is not on this collection whitelist'
        } else {
          on_allowlist = true
          reported_wallet_minted = wlRow.used_mints
          const phaseWalletRemaining = Math.max(0, effectiveWalletLimit - wlRow.used_mints)
          const wlRemaining = Math.max(0, wlRow.allowed_mints - wlRow.used_mints)
          allowlist_spots_remaining = Math.min(wlRemaining, phaseWalletRemaining, phaseRemaining)
          if (phaseWalletRemaining <= 0) {
            max_mintable = 0
            reason = `Wallet limit reached (${effectiveWalletLimit} per wallet for ${activePhase?.label ?? 'this phase'})`
          } else if (wlRemaining <= 0) {
            max_mintable = 0
            reason = `${activePhase?.label ?? 'Whitelist'} mint allocation exhausted`
          } else {
            max_mintable = Math.min(max_mintable, wlRemaining, phaseWalletRemaining, phaseRemaining)
            reason = `Eligible for ${activePhase?.label ?? 'allowlist'} · up to ${max_mintable} mint${max_mintable === 1 ? '' : 's'}`
          }
        }
      }
    }

    is_eligible = max_mintable > 0
    if (is_eligible && !allowlistOpen && !reason) {
      reason = `Eligible for public · up to ${max_mintable} mint${max_mintable === 1 ? '' : 's'}`
    }
    if (is_eligible && platformFeeEnabled && wallet && platformFeeQuote?.ok) {
      const feeBal = await assertOwlCenterPlatformMintFeeSolBalance(
        wallet,
        mint_network,
        platformFeeQuote.lamports,
        getLaunchSolanaRpcUrl(mint_network),
        1,
        prefetchedBalance,
        unit_lamports_estimate != null ? BigInt(unit_lamports_estimate) : 0n
      )
      if (!feeBal.ok) {
        is_eligible = false
        reason = feeBal.error
        max_mintable = 0
      }
    }
    if (!is_eligible && !reason) reason = 'Not eligible'
  }

  return {
    active_phase: launch.active_phase,
    status: launch.status,
    is_paused: launch.is_paused,
    is_eligible,
    max_mintable,
    reason,
    wallet_minted: reported_wallet_minted,
    wallet_mint_limit: effectiveWalletLimit,
    unit_lamports_estimate,
    sol_usd_price: null,
    price_usdc,
    price_sol: unitPrice.price_sol,
    active_allowlist_key: unitPrice.allowlist_key,
    active_allowlist_label: unitPrice.allowlist_label,
    platform_mint_fee_usdc: owlCenterPlatformMintFeeUsd(),
    platform_mint_fee_lamports_estimate,
    platform_mint_fee_label: formatOwlCenterPlatformMintFeeSolLabel(
      platform_mint_fee_lamports_estimate != null ? BigInt(platform_mint_fee_lamports_estimate) : null
    ),
    wallet_sol_balance_lamports,
    mint_sol_needed_lamports,
    platform_treasury_wallet,
    mint_network,
    mint_operational,
    mint_window_open,
    phase_starts_at: scheduleClosed?.opensAt ?? null,
    on_allowlist,
    allowlist_spots_remaining,
  }
}
