/**
 * Partner (public_simple) Candy Guard plan: on-chain solPayment + per-phase groups.
 * Prices come from mint details (SOL public and/or USDC allowlist/public).
 */

import { getOptionalLamportsQuoteForUsdc } from '@/lib/gen2-presale/pricing'
import {
  resolvePartnerAllowlistPhases,
  resolvePartnerPhaseWalletMintLimit,
} from '@/lib/owl-center/partner-allowlist-phases'
import { publicSimpleSolMintPrice } from '@/lib/owl-center/partner-mint-phase-schedule'
import {
  getPublicSimpleMintOpensAt,
  PUBLIC_SIMPLE_UNSCHEDULED_START_ISO,
  resolvePublicSimpleGuardStartDateIso,
} from '@/lib/owl-center/phase-schedule'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

function clampWalletMintLimit(raw: number | null | undefined): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return 5
  return Math.min(50, Math.max(1, n))
}

export const PUBLIC_SIMPLE_PUBLIC_GROUP_LABEL = 'pub'

/** Candy Guard mintLimit id for public / default (must match mintArgs on mint). */
export const PUBLIC_SIMPLE_PUBLIC_MINT_LIMIT_ID = 1

/** mintLimit ids for allowlist groups: 2 + index (stable while phase order is preserved). */
export function publicSimpleAllowlistMintLimitId(phaseIndex: number): number {
  return Math.min(255, 2 + Math.max(0, Math.floor(phaseIndex)))
}

export type PublicSimpleGuardLaunch = Pick<
  OwlCenterLaunchPublic,
  | 'wallet_mint_limit'
  | 'launch_deadline_at'
  | 'phase_schedule'
  | 'creator_wl_enabled'
  | 'creator_presale_enabled'
  | 'wl_supply'
  | 'presale_supply'
  | 'wl_price_usdc'
  | 'public_price_usdc'
  | 'creator_mint_price'
  | 'creator_mint_currency'
  | 'treasury_wallet'
  | 'creator_wallet'
  | 'partner_allowlist_phases'
>

export type PublicSimpleGuardGroupPlan = {
  key: string
  label: string
  startDateIso: string | null
  endDateIso: string | null
  solLamports: bigint
  /** Per-phase on-chain mintLimit (unique id per group). */
  mintLimitId: number
  walletMintLimit: number
}

export type PublicSimpleGuardPlan = {
  /** Public / default-set wallet mint limit (also used when there are no groups). */
  walletMintLimit: number
  /** Default-set startDate. Null when groups own the windows (must not AND with PUBLIC). */
  defaultStartDateIso: string | null
  defaultSolLamports: bigint
  destination: string | null
  groups: PublicSimpleGuardGroupPlan[]
}

export type PublicSimpleGuardPlanResult =
  | { ok: true; plan: PublicSimpleGuardPlan }
  | { ok: false; error: string }

export function publicSimpleGuardGroupLabel(phaseKey: string): string {
  const k = phaseKey.trim().toLowerCase()
  if (k === 'public' || k === 'pub') return PUBLIC_SIMPLE_PUBLIC_GROUP_LABEL
  if (k === 'whitelist' || k === 'wl') return 'wl'
  const cleaned = k.replace(/[^a-z0-9]/g, '')
  const base = cleaned.slice(0, 6)
  return base || 'phase'
}

export function uniquePublicSimpleGuardGroupLabels(keys: string[]): string[] {
  const used = new Set<string>()
  return keys.map((key) => {
    let label = publicSimpleGuardGroupLabel(key)
    if (!used.has(label)) {
      used.add(label)
      return label
    }
    for (let i = 1; i < 10; i++) {
      const next = `${label.slice(0, 5)}${i}`
      if (!used.has(next)) {
        used.add(next)
        return next
      }
    }
    return label.slice(0, 6)
  })
}

/** Candy Guard solPayment destination — mint proceeds go to creator treasury. */
export function resolvePublicSimplePaymentDestination(
  launch: Pick<OwlCenterLaunchPublic, 'treasury_wallet' | 'creator_wallet'>
): string | null {
  return (
    normalizeSolanaWalletAddress(launch.treasury_wallet ?? '') ??
    normalizeSolanaWalletAddress(launch.creator_wallet ?? '')
  )
}

export function solAmountToLamports(solAmt: number): bigint {
  if (!Number.isFinite(solAmt) || solAmt <= 0) return 0n
  return BigInt(Math.round(solAmt * 1_000_000_000))
}

export function publicSimpleMintGuardGroupLabel(
  launch: Pick<OwlCenterLaunchPublic, 'partner_allowlist_phases' | 'creator_wl_enabled' | 'wl_supply'>,
  activeAllowlistKey?: string | null
): string | null {
  if (resolvePartnerAllowlistPhases(launch).length === 0) return null
  if (activeAllowlistKey) return publicSimpleGuardGroupLabel(activeAllowlistKey)
  return PUBLIC_SIMPLE_PUBLIC_GROUP_LABEL
}

type QuoteUsdc = (priceUsdc: number) => Promise<bigint | null>

async function resolvePhaseLamports(opts: {
  priceUsdc: number | null | undefined
  priceSol: number | null | undefined
  quoteUsdc: QuoteUsdc
  label: string
}): Promise<{ ok: true; lamports: bigint } | { ok: false; error: string }> {
  const solAmt = opts.priceSol
  if (solAmt != null && Number.isFinite(solAmt) && solAmt > 0) {
    return { ok: true, lamports: solAmountToLamports(solAmt) }
  }
  const usdc = opts.priceUsdc
  if (usdc != null && Number.isFinite(usdc) && usdc > 0) {
    const quoted = await opts.quoteUsdc(usdc)
    if (quoted == null || quoted <= 0n) {
      return { ok: false, error: `Could not quote ${opts.label} price ($${usdc} USDC) to SOL` }
    }
    return { ok: true, lamports: quoted }
  }
  return { ok: true, lamports: 0n }
}

function parkedStart(iso: string | null | undefined): string {
  const t = iso?.trim()
  return t || PUBLIC_SIMPLE_UNSCHEDULED_START_ISO
}

export async function buildPublicSimpleGuardPlan(
  launch: PublicSimpleGuardLaunch,
  opts?: { quoteUsdc?: QuoteUsdc }
): Promise<PublicSimpleGuardPlanResult> {
  const quoteUsdc: QuoteUsdc =
    opts?.quoteUsdc ??
    (async (priceUsdc) => {
      const q = await getOptionalLamportsQuoteForUsdc(priceUsdc)
      return q?.unitLamports ?? null
    })

  const destination = resolvePublicSimplePaymentDestination(launch)
  const walletMintLimit = clampWalletMintLimit(launch.wallet_mint_limit)
  const allowlists = resolvePartnerAllowlistPhases(launch)
  const publicStart = getPublicSimpleMintOpensAt(launch)
  const publicSol = publicSimpleSolMintPrice(launch)

  if (allowlists.length > 0) {
    const keys = [...allowlists.map((p) => p.key), 'public']
    const labels = uniquePublicSimpleGuardGroupLabels(keys)
    const groups: PublicSimpleGuardGroupPlan[] = []

    for (let i = 0; i < allowlists.length; i++) {
      const phase = allowlists[i]!
      const next = allowlists[i + 1]
      const priced = await resolvePhaseLamports({
        priceUsdc: phase.price_usdc,
        priceSol: null,
        quoteUsdc,
        label: phase.label,
      })
      if (!priced.ok) return priced
      groups.push({
        key: phase.key,
        label: labels[i]!,
        startDateIso: parkedStart(phase.starts_at),
        endDateIso: next?.starts_at ?? publicStart,
        solLamports: priced.lamports,
        mintLimitId: publicSimpleAllowlistMintLimitId(i),
        walletMintLimit: resolvePartnerPhaseWalletMintLimit(phase, walletMintLimit),
      })
    }

    const pubPriced = await resolvePhaseLamports({
      priceUsdc: launch.public_price_usdc,
      priceSol: publicSol,
      quoteUsdc,
      label: 'Public',
    })
    if (!pubPriced.ok) return pubPriced
    groups.push({
      key: 'public',
      label: labels[labels.length - 1]!,
      startDateIso: parkedStart(publicStart),
      endDateIso: null,
      solLamports: pubPriced.lamports,
      mintLimitId: PUBLIC_SIMPLE_PUBLIC_MINT_LIMIT_ID,
      walletMintLimit,
    })

    const paid = groups.some((g) => g.solLamports > 0n)
    if (paid && !destination) {
      return { ok: false, error: 'Set a treasury or creator wallet to collect on-chain mint proceeds' }
    }

    return {
      ok: true,
      plan: {
        walletMintLimit,
        defaultStartDateIso: null,
        defaultSolLamports: 0n,
        destination,
        groups,
      },
    }
  }

  const pubPriced = await resolvePhaseLamports({
    priceUsdc: launch.public_price_usdc,
    priceSol: publicSol,
    quoteUsdc,
    label: 'Public',
  })
  if (!pubPriced.ok) return pubPriced
  if (pubPriced.lamports > 0n && !destination) {
    return { ok: false, error: 'Set a treasury or creator wallet to collect on-chain mint proceeds' }
  }

  return {
    ok: true,
    plan: {
      walletMintLimit,
      defaultStartDateIso: resolvePublicSimpleGuardStartDateIso(launch),
      defaultSolLamports: pubPriced.lamports,
      destination,
      groups: [],
    },
  }
}
